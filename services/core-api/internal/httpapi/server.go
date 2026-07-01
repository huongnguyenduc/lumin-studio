package httpapi

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/auth"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
)

// userReader is the slice of the identity repository the login handler needs: a single
// by-email lookup. Kept as an interface so LoginUser is unit-testable with a fake, no live
// Postgres required (mirrors txBeginner below); *db.Identity satisfies it.
type userReader interface {
	UserByEmail(ctx context.Context, email string) (sqlc.User, error)
}

// Server carries the dependencies every domain handler needs and implements the
// generated api.StrictServerInterface. Handlers stay thin: the strict layer decodes the
// request from the contract, the handler resolves the actor from the request context
// (set by the PR-3e auth middleware), runs withTx over one or more same-tx db seams,
// then assembles the nested DTO. SQL lives in internal/db; money/state in
// internal/order + internal/money. `auth`/`users` arrive with the login handler (PR-3e-1);
// a `queries` field for the write handlers joins when 3g first consumes it (added then to
// keep the unused-field gate green).
type Server struct {
	logger *slog.Logger
	pool   *pgxpool.Pool
	nats   NATSStatus
	auth   *auth.Issuer
	users  userReader
}

// NewServer builds the handler root. pool/nats may be nil in unit tests that don't
// exercise those dependencies (readiness then skips the corresponding check); auth may be
// nil in tests that don't hit the login handler.
func NewServer(logger *slog.Logger, pool *pgxpool.Pool, nats NATSStatus, authIssuer *auth.Issuer) *Server {
	return &Server{
		logger: logger,
		pool:   pool,
		nats:   nats,
		auth:   authIssuer,
		users:  db.NewIdentity(pool),
	}
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
