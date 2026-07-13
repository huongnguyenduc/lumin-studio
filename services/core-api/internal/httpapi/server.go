package httpapi

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/auth"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/modelstore"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/proofstore"
)

// userReader is the slice of the identity repository the auth layer needs: a by-email lookup
// for the login handler (PR-3e-1) and a by-id lookup for the verify middleware (PR-3e-2, which
// resolves a token's `sub` to the authoritative user row). Kept as an interface so both are
// unit-testable with a fake, no live Postgres required (mirrors txBeginner below); *db.Identity
// satisfies it.
type userReader interface {
	UserByEmail(ctx context.Context, email string) (sqlc.User, error)
	UserByID(ctx context.Context, id uuid.UUID) (sqlc.User, error)
}

// Server carries the dependencies every domain handler needs and implements the
// generated api.StrictServerInterface. Handlers stay thin: the strict layer decodes the
// request from the contract, the handler resolves the actor from the request context
// (set by the PR-3e auth middleware), runs withTx over one or more same-tx db seams,
// then assembles the nested DTO. SQL lives in internal/db; money/state in
// internal/order + internal/money. `auth`/`users` arrive with the login handler (PR-3e-1);
// the domain handlers (3g/3h) reach the DB through the internal/db repositories over
// pool/tx, so no raw sqlc.Queries field is needed here.
type Server struct {
	logger *slog.Logger
	pool   *pgxpool.Pool
	nats   NATSStatus
	auth   *auth.Issuer
	users  userReader
	// customerAuth mints/verifies the SEPARATE storefront-customer session cookie (PR-P1-r). It is a
	// distinct Issuer signed with a different secret than `auth`, so an admin token can never validate
	// as a customer session (realm isolation, ADR-030). Nil unless WithCustomerAuth wires it — the
	// customer endpoints are the only ones that touch it, so admin-only call sites leave it nil.
	customerAuth *auth.Issuer
	// lookup is the in-memory per-code token-bucket + lockout guarding the public guest order-lookup
	// (PR-P1-n; conventions §Bảo mật). Constructed here with package-default limits — no constructor
	// param so the existing call sites stay unchanged; tests that exercise the lockout path swap in a
	// tight limiter directly (same package). See ratelimit.go.
	lookup *lookupLimiter
	// proofUploads signs presigned POST policies for payment receipt images (P2-c). Nil means the
	// environment has not wired S3/Garage credentials; the endpoint then fails closed with a 500 rather
	// than issuing a spoofable or partial upload contract. Built once in main.go and shared with the
	// retention sweeper, so the upload host-pin and the delete target share one set of rules.
	proofUploads *proofstore.Store
	// proofUploadLimiter is a small global token bucket for the public upload signer. The edge WAF is
	// still the per-IP layer; this in-process bucket keeps a missing/misconfigured edge rule from
	// turning one unauthenticated endpoint into unlimited valid 10MB upload policies.
	proofUploadLimiter *paymentProofUploadLimiter
	// lostShareLimiter is a small global token bucket for the public finder location-share write (P3-t t-4b),
	// mirroring proofUploadLimiter — an unauthenticated public write with no trusted per-IP signal. Generous
	// limits (ratelimit.go) so a real rescue is never throttled; the edge WAF remains the per-IP layer.
	lostShareLimiter *paymentProofUploadLimiter
	// modelUploads signs presigned POST policies for admin source-model uploads (.glb/.stl/.3mf,
	// P3-j-b/ADR-036) and host-pins the asset-job sourceModelUrl. Nil means the environment has not
	// wired the catalog-asset bucket credentials; the owner-only endpoint then fails closed with a 500.
	// No rate limiter twin: the endpoint is owner-authenticated, not public like proofUploads.
	modelUploads *modelstore.Store
	// tracking mints/verifies the phone-less order-tracking capability token (P2-i, D-P2-8). Never nil:
	// NewServer defaults it to a dev-secret signer so unit tests need no wiring, and WithTrackingSecret
	// (called by main.go with the real TRACKING_SECRET) overrides it. See track.go.
	tracking *trackingSigner
	// printHub is the in-process fan-out for the print-board SSE stream (P3-g, ADR-008). The stage PATCH
	// broadcasts the advanced card; GET /admin/print-queue/stream subscribers push it to the browser.
	// core-api is single-instance (ADR-009) so no NATS is involved. Never nil off NewServer; see print_stream.go.
	printHub *printStreamHub
	// petPageBaseURL is the base for the /t/{shortId} pet-page URL the NFC-encode step burns to a chip
	// (P3-t t-2). Never a secret — NewServer defaults it (defaultPetPageBaseURL); main.go overrides via
	// WithPetPageBaseURL from PET_TAG_BASE_URL. See admin_pettag_encode.go.
	petPageBaseURL string
}

// ServerOption customizes an optional Server dependency without churning every existing
// constructor call site. The admin-only surfaces pass none; the storefront customer realm
// (PR-P1-r) is wired with WithCustomerAuth.
type ServerOption func(*Server)

// WithCustomerAuth wires the storefront-customer session issuer (PR-P1-r). Separate from the admin
// issuer so the two realms sign with different secrets — an admin JWT can never validate as a
// customer session (ADR-030). Optional so the admin-only call sites stay unchanged.
func WithCustomerAuth(issuer *auth.Issuer) ServerOption {
	return func(s *Server) { s.customerAuth = issuer }
}

// WithPaymentProofUploads wires the Garage/S3 signer used by POST /checkout/payment-proof-upload.
// main.go builds the store once (sharing it with the retention sweeper) and passes it here; a nil
// store — invalid/absent S3 config — makes the public endpoint fail closed at request time, while
// main.go still boots because local development may not exercise checkout uploads.
func WithPaymentProofUploads(store *proofstore.Store) ServerOption {
	return func(s *Server) { s.proofUploads = store }
}

// WithModelUploads wires the Garage/S3 signer used by POST /admin/products/{id}/model-upload (P3-j-b).
// main.go builds the store once; a nil store — invalid/absent catalog-asset bucket config — makes the
// owner-only endpoint fail closed at request time, while main.go still boots (local dev may not upload
// models). The same store host-pins the sourceModelUrl an asset-job create references.
func WithModelUploads(store *modelstore.Store) ServerOption {
	return func(s *Server) { s.modelUploads = store }
}

// WithTrackingSecret sets the HMAC key for the phone-less order-tracking token (P2-i, D-P2-8).
// main.go passes the resolved TRACKING_SECRET (having fail-fasted on the forgeable dev value); unit
// tests that don't wire it fall back to NewServer's dev-secret default (track.go), so the signer is
// never nil on either the checkout-201 mint path or the GET /orders/track verify path.
func WithTrackingSecret(secret string) ServerOption {
	return func(s *Server) { s.tracking = newTrackingSigner(secret) }
}

// WithPetPageBaseURL sets the base for the /t/{shortId} pet-page URL the NFC-encode step burns to a chip
// (P3-t t-2). main.go passes the resolved PET_TAG_BASE_URL; unit tests fall back to NewServer's
// defaultPetPageBaseURL. An empty string is ignored so a missing env keeps the default.
func WithPetPageBaseURL(base string) ServerOption {
	return func(s *Server) {
		if base != "" {
			s.petPageBaseURL = base
		}
	}
}

// NewServer builds the handler root. pool/nats may be nil in unit tests that don't
// exercise those dependencies (readiness then skips the corresponding check); auth may be
// nil in tests that don't hit the login handler. opts wire optional dependencies (e.g. the
// customer realm via WithCustomerAuth) without changing the base signature.
func NewServer(logger *slog.Logger, pool *pgxpool.Pool, nats NATSStatus, authIssuer *auth.Issuer, opts ...ServerOption) *Server {
	s := &Server{
		logger:             logger,
		pool:               pool,
		nats:               nats,
		auth:               authIssuer,
		users:              db.NewIdentity(pool),
		lookup:             newLookupLimiter(defaultLookupLimits()),
		proofUploadLimiter: newPaymentProofUploadLimiter(defaultPaymentProofUploadLimits()),
		lostShareLimiter:   newPaymentProofUploadLimiter(defaultLostShareLimits()),
		tracking:           newTrackingSigner(devTrackingSecret),
		printHub:           newPrintStreamHub(),
		petPageBaseURL:     defaultPetPageBaseURL,
	}
	for _, opt := range opts {
		opt(s)
	}
	return s
}

// readiness reports 200 only when every wired dependency is reachable, 503 otherwise — so
// a load balancer drains this instance while Postgres or NATS is unreachable. A nil
// dependency (unit tests that don't exercise it) is skipped; the `dep` field on a 503
// names the failing dependency for ops triage.
func (s *Server) readiness(w http.ResponseWriter, r *http.Request) {
	if s.pool != nil {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		if err := s.pool.Ping(ctx); err != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "unavailable", "dep": "postgres"})
			return
		}
	}
	if s.nats != nil && !s.nats.Reachable() {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "unavailable", "dep": "nats"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// txBeginner is the subset of *pgxpool.Pool that withTx needs. Kept as an interface so
// withTx is unit-testable with a fake, no live Postgres required; *pgxpool.Pool satisfies it.
type txBeginner interface {
	Begin(ctx context.Context) (pgx.Tx, error)
}

// withTx runs fn inside a single transaction: Begin → fn → Commit, rolling back on any
// error or panic. Domain handlers (PR-3g/3h/3k) call one or more same-tx db seams inside
// fn so a status flip and its outbox event commit atomically (publish-on-commit, ADR-006).
// Every DB call inside fn must take ctx so a client disconnect / 30s timeout cancels the tx.
func withTx(ctx context.Context, db txBeginner, fn func(pgx.Tx) error) (err error) {
	tx, err := db.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() {
		if p := recover(); p != nil {
			_ = tx.Rollback(ctx)
			panic(p)
		}
		if err != nil {
			_ = tx.Rollback(ctx)
		}
	}()
	if err = fn(tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
