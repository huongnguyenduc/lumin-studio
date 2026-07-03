package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/order"
)

// Docker-free unit tests for the guest order-lookup (PR-P1-n): the pure phone/code normalizers, the
// non-leaking public timeline mapper, the in-memory rate-limiter/lockout (deterministic via an
// injected clock), and the handler's 429 + mapError wiring. The DB-backed found/not-found/non-leak
// behavior is covered by lookup_integration_test.go against real Postgres.

func TestNormalizePhone(t *testing.T) {
	// The two canonical stored forms (0xxxxxxxxx and +84xxxxxxxxx) and common typed variants must all
	// reduce to the same 9-digit national significant number, so a customer who typed a different-but-
	// equivalent format still matches. A malformed value just yields some string that won't match.
	cases := map[string]string{
		"0901234567":      "901234567",
		"+84901234567":    "901234567",
		"84901234567":     "901234567",
		"901234567":       "901234567",
		"090 123 4567":    "901234567",
		"0847123456":      "847123456", // 08x number via trunk 0
		"+84847123456":    "847123456", // same 08x number via +84 — must match the line above
		"847123456":       "847123456", // bare 9-digit NSN starting "84" — must NOT be over-stripped
		"":                "",
		"not-a-number!!!": "",
	}
	for in, want := range cases {
		if got := normalizePhone(in); got != want {
			t.Errorf("normalizePhone(%q) = %q, want %q", in, got, want)
		}
	}
	// The load-bearing invariant: equivalent formats of the SAME number compare equal after
	// normalization (this is what makes the constant-time match tolerant of format).
	if normalizePhone("0847123456") != normalizePhone("+84847123456") {
		t.Error("0xxx and +84xxx forms of the same number must normalize equal")
	}
	// Edge: an 084x number stored with its trunk 0 vs the bare 9-digit NSN typed without a prefix —
	// length-guarded stripping must NOT over-strip the leading "84" of the bare form.
	if normalizePhone("0847123456") != normalizePhone("847123456") {
		t.Error("084x stored-with-trunk and the bare 9-digit NSN must normalize equal")
	}
}

func TestNormalizeLookupCode(t *testing.T) {
	cases := map[string]string{
		" #lmn-1000 ": "#LMN-1000",
		"#LMN-1000":   "#LMN-1000",
		"lmn-1000":    "LMN-1000",
	}
	for in, want := range cases {
		if got := normalizeLookupCode(in); got != want {
			t.Errorf("normalizeLookupCode(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestPublicTimelineDTO(t *testing.T) {
	created := time.Date(2026, 7, 1, 8, 0, 0, 0, time.UTC)
	pending := order.PendingConfirm
	row := sqlc.Order{
		Code:      "#LMN-1000",
		Status:    order.Paid,
		CreatedAt: pgtype.Timestamptz{Time: created, Valid: true},
		StatusHistory: []order.StatusEvent{
			// genesis (from=nil) + one transition. The mapper must project ONLY {status, at} — the
			// byUser/reason below must NOT appear anywhere in the public DTO.
			{To: order.PendingConfirm, At: "2026-07-01T08:00:00Z", ByUser: "customer"},
			{From: &pending, To: order.Paid, At: "2026-07-02T03:30:00Z", ByUser: "u-owner-secret", Reason: "internal note"},
		},
	}

	t.Run("projects milestones to {status, at}; no tracking when unset", func(t *testing.T) {
		dto, err := publicTimelineDTO(row)
		if err != nil {
			t.Fatalf("publicTimelineDTO: %v", err)
		}
		if dto.Code != "#LMN-1000" || dto.Status != api.OrderStatus(order.Paid) {
			t.Errorf("code/status = %q/%v, want #LMN-1000/PAID", dto.Code, dto.Status)
		}
		if !dto.CreatedAt.Equal(created) {
			t.Errorf("createdAt = %v, want %v", dto.CreatedAt, created)
		}
		if len(dto.Milestones) != 2 {
			t.Fatalf("milestones = %d, want 2", len(dto.Milestones))
		}
		if dto.Milestones[0].Status != api.OrderStatus(order.PendingConfirm) ||
			dto.Milestones[1].Status != api.OrderStatus(order.Paid) {
			t.Errorf("milestone statuses = %v, want [PENDING_CONFIRM PAID]", dto.Milestones)
		}
		if dto.TrackingCode != nil {
			t.Errorf("trackingCode = %v, want nil (unset)", *dto.TrackingCode)
		}
	})

	t.Run("exposes trackingCode once set", func(t *testing.T) {
		tc := "VN123456"
		r := row
		r.TrackingCode = &tc
		dto, err := publicTimelineDTO(r)
		if err != nil {
			t.Fatalf("publicTimelineDTO: %v", err)
		}
		if dto.TrackingCode == nil || *dto.TrackingCode != tc {
			t.Errorf("trackingCode = %v, want %q", dto.TrackingCode, tc)
		}
	})

	t.Run("empty-string trackingCode stays omitted", func(t *testing.T) {
		empty := ""
		r := row
		r.TrackingCode = &empty
		dto, err := publicTimelineDTO(r)
		if err != nil {
			t.Fatalf("publicTimelineDTO: %v", err)
		}
		if dto.TrackingCode != nil {
			t.Error("empty trackingCode must stay nil (omitted), not render \"\"")
		}
	})

	t.Run("malformed stored at → error, not panic", func(t *testing.T) {
		r := row
		r.StatusHistory = []order.StatusEvent{{To: order.PendingConfirm, At: "not-a-timestamp", ByUser: "customer"}}
		if _, err := publicTimelineDTO(r); err == nil {
			t.Error("malformed at must return an error")
		}
	})
}

func TestLookupLimiter(t *testing.T) {
	clock := time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC)
	newLim := func(l lookupLimits) *lookupLimiter {
		lim := newLookupLimiter(l)
		lim.now = func() time.Time { return clock }
		return lim
	}

	t.Run("token bucket: burst then deny", func(t *testing.T) {
		lim := newLim(lookupLimits{rate: 0, burst: 2, ttl: time.Hour})
		first := lim.allow("#LMN-1")  // consumes token 1 of the burst
		second := lim.allow("#LMN-1") // consumes token 2 of the burst
		if !first || !second {
			t.Fatal("first two attempts (burst=2) must be allowed")
		}
		if lim.allow("#LMN-1") {
			t.Error("third attempt must be denied (bucket empty, rate=0)")
		}
		// A DIFFERENT code has its own bucket — per-code keying.
		if !lim.allow("#LMN-2") {
			t.Error("a different code must have its own fresh bucket")
		}
	})

	t.Run("bucket refills over time", func(t *testing.T) {
		lim := newLim(lookupLimits{rate: 1, burst: 1, ttl: time.Hour}) // 1 token/s
		if !lim.allow("#LMN-5") {
			t.Fatal("first attempt must be allowed")
		}
		if lim.allow("#LMN-5") {
			t.Error("second immediate attempt must be denied (burst=1, empty)")
		}
		clock = clock.Add(2 * time.Second) // >= 1/rate → a token refills
		if !lim.allow("#LMN-5") {
			t.Error("attempt after the refill interval must be allowed")
		}
	})

	t.Run("idle entries are swept past the TTL", func(t *testing.T) {
		lim := newLim(lookupLimits{rate: 100, burst: 100, ttl: 30 * time.Minute})
		lim.allow("#IDLE")
		clock = clock.Add(31 * time.Minute)
		lim.allow("#TRIGGER-SWEEP") // past the ttl interval → sweepLocked runs before this entry is added
		lim.mu.Lock()
		_, idleKept := lim.entries["#IDLE"]
		lim.mu.Unlock()
		if idleKept {
			t.Error("idle entry past TTL should be evicted (map stays bounded)")
		}
	})

	t.Run("concurrent access is race-free", func(t *testing.T) {
		// Gives `go test -race` a concurrent workload over allow() — the production handler calls it
		// from many goroutines. Real clock is fine here (we only exercise the mutex, not the TTL).
		lim := newLookupLimiter(lookupLimits{rate: 100, burst: 100, ttl: time.Minute})
		var wg sync.WaitGroup
		for i := 0; i < 50; i++ {
			wg.Add(1)
			go func(i int) {
				defer wg.Done()
				lim.allow(fmt.Sprintf("#LMN-%d", i%5))
			}(i)
		}
		wg.Wait()
	})
}

func TestLookupOrderRateLimitedReturns429Sentinel(t *testing.T) {
	// A tripped limiter must short-circuit BEFORE any DB work — proven here with a nil pool: if the
	// handler touched the pool it would panic, so reaching errRateLimited proves the gate runs first.
	srv := NewServer(slog.New(slog.NewTextHandler(io.Discard, nil)), nil, nil, nil)
	srv.lookup = newLookupLimiter(lookupLimits{rate: 0, burst: 0, ttl: time.Hour})

	resp, err := srv.LookupOrder(context.Background(), api.LookupOrderRequestObject{
		Params: api.LookupOrderParams{Code: "#LMN-1000", Phone: "0901234567"},
	})
	if !errors.Is(err, errRateLimited) {
		t.Fatalf("err = %v, want errRateLimited", err)
	}
	if resp != nil {
		t.Errorf("resp = %v, want nil on the error path", resp)
	}
}

func TestLookupOrderRateLimitReturns429Envelope(t *testing.T) {
	// End-to-end through the router: an emptied per-code bucket renders HTTP 429 with the RATE_LIMITED
	// envelope on the wire (handler → errRateLimited → handleResponseError → mapError → 429 body).
	// Docker-free: the rate-limit gate fires BEFORE any DB read, so the nil pool is never touched
	// (burst 0 → every attempt denied). doLookup lives in lookup_integration_test.go (same package).
	srv := NewServer(slog.New(slog.NewTextHandler(io.Discard, nil)), nil, nil, nil)
	srv.lookup = newLookupLimiter(lookupLimits{rate: 0, burst: 0, ttl: time.Hour})
	router := testAuthedRouter(srv)

	rec := doLookup(t, router, "#LMN-1000", "0901234567")
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("rate-limited lookup = %d, want 429 (body=%s)", rec.Code, rec.Body.String())
	}
	var env api.ErrorEnvelope
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("decode envelope: %v", err)
	}
	if env.Code != codeRateLimited || env.MessageKey != "errors.RATE_LIMITED" {
		t.Errorf("envelope = %+v, want RATE_LIMITED / errors.RATE_LIMITED", env)
	}
}

func TestMapErrorRateLimited(t *testing.T) {
	status, env := mapError(errRateLimited)
	if status != http.StatusTooManyRequests {
		t.Errorf("status = %d, want 429", status)
	}
	if env.Code != codeRateLimited || env.MessageKey != "errors.RATE_LIMITED" {
		t.Errorf("envelope = %+v, want code RATE_LIMITED / key errors.RATE_LIMITED", env)
	}
}
