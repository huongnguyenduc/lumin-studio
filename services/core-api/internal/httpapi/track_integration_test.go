package httpapi

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/order"
)

// Integration tests for TrackOrder (GET /orders/track, PR-P2-i) against real Postgres (testcontainers:
// skip local without Docker, run in CI — ADR-020; startPostgres lives in transition_integration_test.go).
// They drive the FULL public router with NO cookie to prove the route is mounted + public, and cover the
// security-critical invariants (D-P2-8): a correct code + HMAC token returns the SAME minimal
// PublicOrderTimeline as /orders/lookup with NO phone; a wrong token and an unknown code are the
// BYTE-IDENTICAL 404 (no order-existence enumeration); an absent token is a 400, never a 404. The
// per-code token bucket is SHARED with LookupOrder and covered by TestLookupLimiter; the signer's
// determinism / tamper-rejection is covered Docker-free by TestTrackingSignerRoundTrip.
// seedLookupOrder + doLookup are reused from lookup_integration_test.go (same package).

func doTrack(t *testing.T, router http.Handler, code, token string) *httptest.ResponseRecorder {
	t.Helper()
	q := url.Values{}
	q.Set("code", code) // Encode() percent-encodes the '#' in "#LMN-…" so it stays a query value, not a fragment
	q.Set("token", token)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/orders/track?"+q.Encode(), nil))
	return rec
}

func TestTrackOrderEndToEnd(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()
	srv := NewServer(slog.New(slog.NewTextHandler(io.Discard, nil)), pool, nil, nil)
	router := testAuthedRouter(srv)

	_, code, phone := seedLookupOrder(t, ctx, pool)
	token := srv.tracking.token(code) // exactly what checkout's 201 mints for this code

	t.Run("correct code + token → 200 minimal timeline (no phone needed)", func(t *testing.T) {
		rec := doTrack(t, router, code, token)
		if rec.Code != http.StatusOK {
			t.Fatalf("track = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
		}
		var dto api.PublicOrderTimeline
		if err := json.Unmarshal(rec.Body.Bytes(), &dto); err != nil {
			t.Fatalf("decode timeline: %v", err)
		}
		if dto.Code != code {
			t.Errorf("code = %q, want %q", dto.Code, code)
		}
		if dto.Status != api.OrderStatus(order.PendingConfirm) {
			t.Errorf("status = %v, want PENDING_CONFIRM", dto.Status)
		}
	})

	t.Run("track body byte-equals lookup body for the same order (shared whitelist DTO — no extra leak)", func(t *testing.T) {
		// Both public reads project the same order through publicTimelineDTO, so their 200 bodies must be
		// identical. This piggybacks the exhaustive non-leak assertions in TestLookupOrderEndToEnd onto
		// the token path without duplicating them — if track ever grew a wider projection, this fails.
		track := doTrack(t, router, code, token)
		look := doLookup(t, router, code, phone)
		if track.Code != http.StatusOK || look.Code != http.StatusOK {
			t.Fatalf("statuses = track %d / lookup %d, want 200/200", track.Code, look.Code)
		}
		if track.Body.String() != look.Body.String() {
			t.Errorf("track vs lookup body differ → track exposes a different projection:\n track=%s\n lookup=%s", track.Body.String(), look.Body.String())
		}
	})

	t.Run("wrong token and unknown code are the BYTE-IDENTICAL 404 (no enumeration)", func(t *testing.T) {
		wrongToken := doTrack(t, router, code, token+"tampered") // a REAL code, a bad token → must NOT reveal the order
		unknownCode := doTrack(t, router, "#LMN-0000", token)    // a bogus code → same 404
		if wrongToken.Code != http.StatusNotFound || unknownCode.Code != http.StatusNotFound {
			t.Fatalf("statuses = wrong-token %d / unknown-code %d, want 404/404", wrongToken.Code, unknownCode.Code)
		}
		if wrongToken.Body.String() != unknownCode.Body.String() {
			t.Errorf("bodies differ → enumeration signal:\n wrong-token=%s\n unknown-code=%s", wrongToken.Body.String(), unknownCode.Body.String())
		}
		var env api.ErrorEnvelope
		if err := json.Unmarshal(wrongToken.Body.Bytes(), &env); err != nil {
			t.Fatalf("decode envelope: %v", err)
		}
		if env.Code != codeNotFound {
			t.Errorf("code = %q, want NOT_FOUND", env.Code)
		}
	})

	t.Run("absent token → 400 VALIDATION, never a 404 (required param, not an enumeration branch)", func(t *testing.T) {
		// Omit the token param entirely: the generated required-param binding rejects it as a 400 BEFORE
		// the handler runs, so it is uniform regardless of whether the code exists (no enumeration).
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/orders/track?code="+url.QueryEscape(code), nil))
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("absent-token track = %d, want 400 (body=%s)", rec.Code, rec.Body.String())
		}
	})
}
