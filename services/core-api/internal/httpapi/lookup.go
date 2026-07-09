package httpapi

import (
	"context"
	"crypto/subtle"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
)

// errRateLimited is the public-endpoint rate-limit sentinel. mapError renders it as a 429
// RATE_LIMITED ErrorEnvelope (ADR-032) — no Retry-After, so the exact limiter window never leaks.
// It lives here because guest lookup introduced the first public token bucket; later public surfaces
// reuse the same wire code.
var errRateLimited = errors.New("httpapi: public endpoint rate limited")

// dummyPhone is compared in constant time on the code-not-found path so an unknown code takes the
// same compare time as a known-code-wrong-phone (the AUTH-01 always-run-bcrypt pattern). It is a
// 9-digit string so ConstantTimeCompare does a full compare against a normalized 9-digit input.
const dummyPhone = "000000000"

// LookupOrder handles GET /orders/lookup (PR-P1-n): the public guest order-tracking read. It is
// authPublic (classify) — a guest has no session — and is gated instead by a constant-time code+phone
// match plus a per-code token-bucket + lockout (conventions §Bảo mật). BOTH the order code AND the
// phone used on the order must match; an unknown code and a phone mismatch return the SAME 404
// NOT_FOUND, so the endpoint never reveals whether a given code exists (no order-existence
// enumeration). It returns a minimal PublicOrderTimeline — NEVER the internal Order (no customer PII,
// address, items, money, payment/refund proof, note, or statusHistory actor/reason; ADR-032).
// r.Context() propagates into the reads so a client disconnect / 30s timeout cancels them.
func (s *Server) LookupOrder(ctx context.Context, request api.LookupOrderRequestObject) (api.LookupOrderResponseObject, error) {
	code := normalizeLookupCode(request.Params.Code)
	phone := normalizePhone(request.Params.Phone)

	// Per-code token-bucket BEFORE any DB work: it throttles the attempt rate for one code (bounding a
	// phone brute-force) and bounds DB reads. Consuming a token on every attempt keeps an unknown code,
	// a wrong phone and a legit poll uniform in TOKEN cost. An empty bucket → 429 RATE_LIMITED; log it so
	// ops has a signal on abuse of this unauthenticated surface (the 429 itself is below the 500 log line).
	if !s.lookup.allow(code) {
		s.logger.Warn("order lookup rate-limited", "code", code)
		return nil, errRateLimited
	}

	row, err := db.NewOrders(s.pool).ByCode(ctx, code)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			// Run a constant-time compare against a fixed dummy so the phone-compare STEP costs the same
			// as the known-code path (AUTH-01 always-run pattern), and return the SAME 404 body as the
			// phone-mismatch path so response CONTENT never distinguishes unknown-code from wrong-phone.
			// NOTE: timing is not fully equalized — the known-code path does one extra DB read (below);
			// enumeration resistance rests on the identical 404 body + the token-bucket + the CF WAF (and
			// codes are already sequential/guessable, so existence is low-value), NOT on timing parity.
			_ = subtle.ConstantTimeCompare([]byte(phone), []byte(dummyPhone))
			return nil, db.ErrNotFound
		}
		return nil, err // genuine DB fault → 500 (logged), never a client 404
	}

	cust, err := db.NewIdentity(s.pool).CustomerByID(ctx, row.CustomerID)
	if err != nil {
		// A genuine DB fault on the customer read → 500 (logged). The "row missing" case is FK-impossible
		// (orders.customer_id is NOT NULL REFERENCES customers RESTRICT, migration 000005), so this only
		// fires on a real fault, e.g. a dropped connection — never a 404 that would imply the code was wrong.
		return nil, fmt.Errorf("lookup order %s: customer: %w", row.Code, err)
	}

	if subtle.ConstantTimeCompare([]byte(phone), []byte(normalizePhone(cust.Phone))) != 1 {
		return nil, db.ErrNotFound // uniform 404 — byte-identical to the unknown-code response
	}

	dto, err := publicTimelineDTO(row)
	if err != nil {
		return nil, err // malformed stored `at` (never written by the seams) → 500 (logged)
	}
	return api.LookupOrder200JSONResponse(dto), nil
}

// publicTimelineDTO builds the guest-facing timeline from the persisted order row. It is a pure
// mapper (split from the I/O so it is Docker-free unit-testable) that WHITELISTS the safe fields:
// the code, current status, a status→time milestone list (each statusHistory event projected to
// {status, at} — dropping byUser/reason/refundProofUrl), the optional tracking code, and createdAt.
// It intentionally does NOT reuse toOrderDTO/statusHistoryDTO, which would leak the internal Order.
func publicTimelineDTO(row sqlc.Order) (api.PublicOrderTimeline, error) {
	milestones := make([]api.OrderMilestone, len(row.StatusHistory))
	for i, ev := range row.StatusHistory {
		at, err := time.Parse(time.RFC3339Nano, ev.At)
		if err != nil {
			return api.PublicOrderTimeline{}, fmt.Errorf("lookup timeline: milestone %d parse at %q: %w", i, ev.At, err)
		}
		milestones[i] = api.OrderMilestone{Status: api.OrderStatus(ev.To), At: at}
	}
	dto := api.PublicOrderTimeline{
		Code:       row.Code,
		Status:     api.OrderStatus(row.Status),
		Milestones: milestones,
		CreatedAt:  row.CreatedAt.Time,
	}
	// Tracking code is exposed only once set (present from SHIPPING onward, spec §04); an empty/NULL
	// column stays omitted rather than surfacing as "".
	if row.TrackingCode != nil && *row.TrackingCode != "" {
		dto.TrackingCode = row.TrackingCode
	}
	return dto, nil
}

// normalizeLookupCode canonicalizes a typed order code for both the DB match and the limiter key:
// trim surrounding whitespace and upper-case it (stored codes are "#LMN-1000"). It does not invent a
// missing "#" prefix — the frontend (P1-o) formats the input; a non-matching code funnels to 404.
func normalizeLookupCode(code string) string {
	return strings.ToUpper(strings.TrimSpace(code))
}

// normalizePhone reduces a VN phone to its 9-digit national significant number for comparison: keep
// only digits, then drop a leading country code ("84", only when the whole string is 11 digits = +84 +
// 9) or a leading trunk "0" (only when 10 digits = 0 + 9). Length-guarding the strip avoids mangling a
// bare 9-digit NSN that happens to start "84" (an 084/086/088 number typed without a prefix). So
// "0912 345 678", "+84912345678" and "912345678" all compare equal. It does NOT validate — a malformed
// phone (or an unguarded stored value) simply won't match and funnels to the uniform 404 (never a 400,
// which would be an enumeration signal); it is best-effort on both the typed and stored sides.
func normalizePhone(s string) string {
	var b strings.Builder
	for _, r := range s {
		if r >= '0' && r <= '9' {
			b.WriteByte(byte(r))
		}
	}
	d := b.String()
	switch {
	case len(d) == 11 && strings.HasPrefix(d, "84"):
		return d[2:] // +84 <9-digit NSN>
	case len(d) == 10 && strings.HasPrefix(d, "0"):
		return d[1:] // 0 <9-digit NSN> (trunk prefix)
	default:
		return d
	}
}

// NOTE: this read-only path reads the persisted status + status_history directly and never calls
// order.Transition/ReplayStatus — those return a TransitionError whose Vietnamese message must never
// cross the wire (ADR-032). The public DTO is built by hand from the whitelisted fields above.
