package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/google/uuid"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
)

// TestPrintStreamHubFanout: a broadcast reaches every current subscriber, and an unsubscribed one
// stops receiving. This is the whole fan-out contract behind the SSE stream, proven without a socket.
func TestPrintStreamHubFanout(t *testing.T) {
	hub := newPrintStreamHub()
	a, unsubA := hub.subscribe()
	b, unsubB := hub.subscribe()
	defer unsubB()

	card := api.PrintQueueJob{Id: uuid.New(), Stage: api.PrintStage("PRINTING"), OrderCode: "#LMN-1", ProductName: "Đèn", Quantity: 1}
	hub.broadcast(card)
	if got := <-a; got.Id != card.Id {
		t.Fatalf("subscriber A got %v, want %v", got.Id, card.Id)
	}
	if got := <-b; got.Id != card.Id {
		t.Fatalf("subscriber B got %v, want %v", got.Id, card.Id)
	}

	// Unsubscribe A; only B should receive the next broadcast.
	unsubA()
	card2 := api.PrintQueueJob{Id: uuid.New(), Stage: api.PrintStage("PACKING")}
	hub.broadcast(card2)
	if got := <-b; got.Id != card2.Id {
		t.Fatalf("subscriber B (after A left) got %v, want %v", got.Id, card2.Id)
	}
	select {
	case leaked := <-a:
		t.Fatalf("unsubscribed A still received %v", leaked.Id)
	default:
	}
}

// TestPrintStreamHubBroadcastNeverBlocks: a full subscriber buffer must DROP the update, not stall
// broadcast — which runs inline in the PATCH request goroutine, so a block there would hang the write.
// A slow subscriber that never reads is pushed far past its buffer; broadcast must still return fast.
func TestPrintStreamHubBroadcastNeverBlocks(t *testing.T) {
	hub := newPrintStreamHub()
	_, unsub := hub.subscribe() // never drained
	defer unsub()

	done := make(chan struct{})
	go func() {
		for i := 0; i < 100; i++ { // far past the 16-slot buffer
			hub.broadcast(api.PrintQueueJob{Id: uuid.New()})
		}
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("broadcast blocked on a full subscriber buffer — must drop, not stall the PATCH goroutine")
	}
}

// TestPrintStreamHubBroadcastNilSafe: broadcast on a nil hub is a no-op, so a Server literal built
// without a hub (some unit tests) can call the PATCH path without panicking.
func TestPrintStreamHubBroadcastNilSafe(t *testing.T) {
	var hub *printStreamHub
	hub.broadcast(api.PrintQueueJob{Id: uuid.New()}) // must not panic
}

// TestStreamPrintQueueRequiresAuth: the raw SSE route is admin-gated — a no-cookie request is 401
// before any stream bytes. resolveActor runs first and short-circuits on the missing cookie, so the
// nil-backed fakeUsers is never queried. Auth is manual here because the SSE route is not a
// classify()-gated strict operation.
func TestStreamPrintQueueRequiresAuth(t *testing.T) {
	srv := serverWithUsers(fakeUsers{})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/admin/print-queue/stream", nil)
	srv.streamPrintQueue(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("no-cookie SSE = %d, want 401 (admin-gated)", rec.Code)
	}
}

// TestStreamPrintQueueAuthedSetsSSEHeaders: an authenticated request opens the stream with the
// Cloudflare-tunnel anti-buffer headers (ADR-008 / conventions §Realtime) and returns cleanly when the
// client disconnects. A pre-cancelled request context stands in for "client already gone": the handler
// writes headers + the opening comment, enters the select, immediately observes ctx.Done(), and
// returns — deterministic, no goroutine, no sleep. Staff (not just owner) is allowed: the print board
// is fulfillment work, the same gate as GET /admin/print-queue.
func TestStreamPrintQueueAuthedSetsSSEHeaders(t *testing.T) {
	u := authTestUser(sqlc.UserRoleStaff, true)
	srv := serverWithUsers(fakeUsers{byID: map[uuid.UUID]sqlc.User{u.ID: u}})

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/admin/print-queue/stream", nil).WithContext(ctx)
	req.AddCookie(issueCookie(t, srv, u))

	srv.streamPrintQueue(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("authed SSE status = %d, want 200", rec.Code)
	}
	h := rec.Header()
	if ct := h.Get("Content-Type"); ct != "text/event-stream" {
		t.Errorf("Content-Type = %q, want text/event-stream", ct)
	}
	if xa := h.Get("X-Accel-Buffering"); xa != "no" {
		t.Errorf("X-Accel-Buffering = %q, want no (Cloudflare anti-buffer)", xa)
	}
	if cc := h.Get("Cache-Control"); !strings.Contains(cc, "no-transform") {
		t.Errorf("Cache-Control = %q, want to contain no-transform", cc)
	}
	if ce := h.Get("Content-Encoding"); ce != "identity" {
		t.Errorf("Content-Encoding = %q, want identity", ce)
	}
	if body := rec.Body.String(); !strings.Contains(body, ": ok") {
		t.Errorf("stream body = %q, want the opening comment frame", body)
	}
}

// TestStreamPrintQueueThroughLoggerMiddlewareStillFlushes guards a production-only landmine: the SSE
// route runs under requestLogger, which wraps the ResponseWriter (middleware.NewWrapResponseWriter). If
// that wrapper did not surface http.Flusher, the handler would 500 ("streaming unsupported") in
// production while the raw-recorder tests above stayed green. Route the request through the real
// wrapper (+ Recoverer, as NewRouter does) and assert the stream still opens — i.e. the flush path
// survives the middleware chain.
func TestStreamPrintQueueThroughLoggerMiddlewareStillFlushes(t *testing.T) {
	u := authTestUser(sqlc.UserRoleOwner, true)
	srv := serverWithUsers(fakeUsers{byID: map[uuid.UUID]sqlc.User{u.ID: u}})

	r := chi.NewRouter()
	r.Use(requestLogger(srv.logger))
	r.Use(middleware.Recoverer)
	r.Get("/admin/print-queue/stream", srv.streamPrintQueue)

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/admin/print-queue/stream", nil).WithContext(ctx)
	req.AddCookie(issueCookie(t, srv, u))

	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("SSE through requestLogger wrapper = %d, want 200 (wrapper must preserve http.Flusher)", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "text/event-stream" {
		t.Errorf("Content-Type = %q, want text/event-stream", ct)
	}
}

// TestWriteSSEEvent frames a card as a single well-formed `stage` event: an `event:` line, a
// single-line JSON `data:` payload (json.Marshal is newline-free, so the frame stays valid), and the
// blank-line terminator. A field swap or a raw newline in the payload would break the SSE framing.
func TestWriteSSEEvent(t *testing.T) {
	var b strings.Builder
	card := api.PrintQueueJob{Id: uuid.New(), Stage: api.PrintStage("PRINTING"), OrderCode: "#LMN-9", ProductName: "Đèn Mochi", Quantity: 2}
	if err := writeSSEEvent(&b, card); err != nil {
		t.Fatalf("writeSSEEvent: %v", err)
	}
	out := b.String()
	if !strings.HasPrefix(out, "event: stage\ndata: ") {
		t.Fatalf("frame = %q, want an `event: stage` + `data:` header", out)
	}
	if !strings.HasSuffix(out, "\n\n") {
		t.Fatalf("frame = %q, want a blank-line terminator", out)
	}
	if strings.Count(out, "\n") != 3 { // event line, data line, blank terminator (2 newlines)
		t.Fatalf("frame = %q, want exactly one data line (no embedded newlines)", out)
	}
	if !strings.Contains(out, card.OrderCode) || !strings.Contains(out, "PRINTING") {
		t.Fatalf("frame = %q, want the card payload", out)
	}
}
