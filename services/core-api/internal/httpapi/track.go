package httpapi

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"errors"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db"
)

// devTrackingSecret is the package-local fallback HMAC key NewServer defaults to when no
// WithTrackingSecret option is passed — so the signer is never nil in unit tests that don't wire it.
// Like config.DevJWTSecret it is deliberately NOT a secret: main.go resolves the real key from
// TRACKING_SECRET and passes it via WithTrackingSecret (fail-fasting on the forgeable dev value unless
// ALLOW_DEV_JWT_SECRET), so this default only ever signs tokens in tests, where the value is moot.
// ponytail: duplicated from config.DevTrackingSecret (the fail-fast's source of truth) to keep httpapi
// decoupled from config; a drift between the two is harmless because prod/dev always pass the option.
const devTrackingSecret = "lumin-dev-insecure-tracking-secret-do-not-use-in-prod"

// trackingSigner mints and verifies the phone-less order-tracking capability token (P2-i, D-P2-8):
// base64url(HMAC-SHA256(secret, orderCode)). It is a DETERMINISTIC capability — the same code always
// yields the same token — so no column is stored; the server recomputes and constant-time-compares on
// the read (no migration). Rotating the secret invalidates every outstanding link (plan §7).
type trackingSigner struct {
	secret []byte
}

func newTrackingSigner(secret string) *trackingSigner {
	return &trackingSigner{secret: []byte(secret)}
}

// token returns the tracking token for an order code. The code is normalized the SAME way the lookup
// limiter/DB match normalizes it (normalizeLookupCode), so the token is stable across casing/whitespace
// and identical whether minted from the freshly-minted code (checkout 201) or recomputed from the
// stored row.Code (the track read).
//
// ponytail: base64url (encoding/base64.RawURLEncoding, stdlib, URL-safe) rather than the plan's base62 —
// the token is opaque and the storefront owns the /o/{code}-{token} pretty-URL parse; a custom base62
// encoder buys nothing here. Swap to base62 only if a hand-typed token is ever required.
func (s *trackingSigner) token(code string) string {
	mac := hmac.New(sha256.New, s.secret)
	mac.Write([]byte(normalizeLookupCode(code)))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

// valid reports, in CONSTANT time, whether presented is the correct token for code. hmac.Equal wraps
// subtle.ConstantTimeCompare, so a wrong token never leaks a byte-position via timing; a length
// mismatch fails fast, but the token length is fixed and public so that reveals nothing secret.
func (s *trackingSigner) valid(code, presented string) bool {
	return hmac.Equal([]byte(presented), []byte(s.token(code)))
}

// TrackOrder handles GET /orders/track?code=&token= (P2-i, D-P2-8): the phone-less public order-
// tracking read behind the confirmation-screen link /o/{code}-{token}. Unlike LookupOrder it needs no
// phone — the HMAC capability token IS the authorization. It mirrors LookupOrder's structure exactly:
// the same per-code token bucket, the same ByCode read, a constant-time compare, and the SAME uniform
// 404 for both an unknown code and a wrong/absent token, so the endpoint never reveals which codes
// exist. It returns the same minimal PublicOrderTimeline — NEVER the internal Order (no customer PII,
// address, items, money, payment/refund proof, note, or statusHistory actor/reason; ADR-032).
// r.Context() propagates into the reads so a client disconnect / timeout cancels them.
func (s *Server) TrackOrder(ctx context.Context, request api.TrackOrderRequestObject) (api.TrackOrderResponseObject, error) {
	code := normalizeLookupCode(request.Params.Code)

	// Reuse the per-code token bucket that guards LookupOrder (same public read, same code key): it
	// throttles token-guessing and bounds DB reads BEFORE any work, consuming a token on EVERY attempt
	// so an unknown code, a wrong token and a legit poll spend the same. An empty bucket → 429.
	if !s.lookup.allow(code) {
		s.logger.Warn("order track rate-limited", "code", code)
		return nil, errRateLimited
	}

	row, err := db.NewOrders(s.pool).ByCode(ctx, code)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			// Run the same constant-time token compare on the unknown-code path so the verify STEP
			// costs the same as a known-code path, and return the SAME 404 body as the wrong-token
			// path — an unknown code and a bad token are indistinguishable (no order-existence oracle;
			// mirrors LookupOrder's dummy-compare on its code-miss branch).
			_ = s.tracking.valid(code, request.Params.Token)
			return nil, db.ErrNotFound
		}
		return nil, err // genuine DB fault → 500 (logged), never a client 404
	}

	// The token is verified against the canonical stored code (row.Code), which is exactly what the
	// checkout 201 minted it from. A mismatch → the uniform 404, byte-identical to the unknown-code body.
	if !s.tracking.valid(row.Code, request.Params.Token) {
		return nil, db.ErrNotFound
	}

	dto, err := publicTimelineDTO(row)
	if err != nil {
		return nil, err // malformed stored `at` (never written by the seams) → 500 (logged)
	}
	return api.TrackOrder200JSONResponse(dto), nil
}
