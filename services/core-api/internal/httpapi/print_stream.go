package httpapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sync"
	"time"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
)

// heartbeatInterval is how often the SSE stream sends a comment frame to keep the connection
// alive. It MUST stay well under Cloudflare's ~100s idle cap (a stream with no traffic past that
// is dropped with a 524) — conventions.md §Realtime / ADR-008. ponytail: a package const, not an
// env knob; the only constraint is "< 100s" and there is no reason to tune it per-deploy. If the
// tunnel proves to buffer more aggressively in the smoke-test, lower it.
const heartbeatInterval = 25 * time.Second

// printStreamHub is the in-process fan-out for print-board stage changes. core-api runs as a
// SINGLE instance (ADR-009), so the PATCH that moves a card and every SSE subscriber live in the
// same process — an in-process hub is sufficient and correct; no NATS round-trip is needed (ADR-008
// keeps NATS off the browser, but does not require it as the internal event source). A stage advance
// broadcasts the freshly-read card; each connected board tab patches that one card in place.
//
// ponytail: in-process assumes single-instance core-api. If core-api ever scales horizontally, an
// admin on instance A would miss a PATCH served by instance B — back this hub with a NATS subscribe
// then (the SSE transport to the browser stays unchanged; only the source fans in from NATS).
type printStreamHub struct {
	mu   sync.Mutex
	subs map[chan api.PrintQueueJob]struct{}
}

func newPrintStreamHub() *printStreamHub {
	return &printStreamHub{subs: make(map[chan api.PrintQueueJob]struct{})}
}

// subscribe registers a subscriber and returns its receive channel plus an unsubscribe func the
// caller MUST defer. The channel is buffered so a briefly-slow reader does not stall broadcast;
// unsubscribe just removes the channel (it is never closed — the SSE handler owns the read side and
// stops reading before it unsubscribes, so there is no send-on-closed race and no reason to close).
func (h *printStreamHub) subscribe() (<-chan api.PrintQueueJob, func()) {
	ch := make(chan api.PrintQueueJob, 16)
	h.mu.Lock()
	h.subs[ch] = struct{}{}
	h.mu.Unlock()
	return ch, func() {
		h.mu.Lock()
		delete(h.subs, ch)
		h.mu.Unlock()
	}
}

// broadcast delivers card to every subscriber without ever blocking: a full buffer drops the update
// for that one subscriber rather than stalling the PATCH request or the other subscribers. A drop is
// self-healing — the board is re-derivable, so the client reconciles on its next GET / fallback poll.
// Nil-receiver safe so a Server built without a hub (some unit-test literals) never panics here.
func (h *printStreamHub) broadcast(card api.PrintQueueJob) {
	if h == nil {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	for ch := range h.subs {
		select {
		case ch <- card:
		default: // buffer full — drop; the client re-reads the board to reconcile
		}
	}
}

// streamPrintQueue handles GET /admin/print-queue/stream (P3-g, ADR-008): a Server-Sent Events stream
// that pushes a print card each time its stage advances, so the kanban board (P3-h) updates live
// without polling. It is a RAW route — the oapi strict layer buffers the whole response and cannot
// stream, and it is mounted OUTSIDE middleware.Timeout so the long-lived stream is not cancelled at
// 30s (there is no global WriteTimeout either — main.go leaves it unset for exactly this). Auth is
// enforced here rather than by the strict authMiddleware: resolveActor reads the same lumin_session
// cookie EventSource sends same-origin (owner AND staff — the print board is fulfillment work, the
// same gate as GET /admin/print-queue). Fallback when the stream is unavailable is the GET poll,
// client-side.
//
// Cloudflare-tunnel hardening (conventions.md §Realtime): text/event-stream + Cache-Control
// no-transform + Content-Encoding identity + X-Accel-Buffering no defeat proxy buffering; http.Flusher
// pushes each frame the instant it is written; a heartbeat comment every heartbeatInterval keeps the
// idle connection under Cloudflare's ~100s cap.
func (s *Server) streamPrintQueue(w http.ResponseWriter, r *http.Request) {
	// Manual auth — the same actor resolution the strict authMiddleware runs for an authRequired op.
	// A missing/invalid cookie or a deactivated user → 401; a genuine DB fault must stay a 500 (and be
	// logged), so pass resolveActor's error THROUGH rather than flattening everything to 401 — mirroring
	// authMiddleware. Done before any 200/stream bytes so the error status is honoured.
	if _, ok, err := s.resolveActor(r.Context(), r); err != nil || !ok {
		if err == nil {
			err = errUnauthenticated // no credential at all
		}
		s.handleResponseError(w, r, err)
		return
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		// Streaming needs a flushable writer. Production net/http always provides one; this guards a
		// test/proxy writer that does not, failing before committing a 200 that could never stream.
		s.handleResponseError(w, r, errors.New("httpapi: streaming unsupported"))
		return
	}

	h := w.Header()
	h.Set("Content-Type", "text/event-stream")
	h.Set("Cache-Control", "no-cache, no-transform")
	h.Set("Content-Encoding", "identity")
	h.Set("X-Accel-Buffering", "no")
	h.Set("Connection", "keep-alive")
	w.WriteHeader(http.StatusOK)
	// Open the stream immediately: commit the headers and one comment so EventSource fires onopen and
	// any buffering proxy sees bytes right away (matters for the named-tunnel smoke-test).
	_, _ = io.WriteString(w, ": ok\n\n")
	flusher.Flush()

	events, unsubscribe := s.printHub.subscribe()
	defer unsubscribe()

	ticker := time.NewTicker(heartbeatInterval)
	defer ticker.Stop()

	ctx := r.Context() // this route is outside middleware.Timeout, so Done() means real disconnect
	// ponytail: on graceful shutdown srv.Shutdown does NOT cancel this context, so an open stream
	// delays the drain until the client disconnects or the ShutdownTimeout elapses (bounded — main.go).
	// Fine for a single-instance box that accepts downtime; wire RegisterOnShutdown → a done channel
	// here if prompt shutdown-drain ever matters.
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if _, err := io.WriteString(w, ": ping\n\n"); err != nil {
				return // client gone
			}
			flusher.Flush()
		case card := <-events:
			if err := writeSSEEvent(w, card); err != nil {
				return // client gone
			}
			flusher.Flush()
		}
	}
}

// writeSSEEvent frames one print card as a named `stage` SSE event. json.Marshal emits compact,
// newline-free bytes, so the payload is a single valid `data:` line (SSE frames are newline-delimited).
func writeSSEEvent(w io.Writer, card api.PrintQueueJob) error {
	payload, err := json.Marshal(card)
	if err != nil {
		return err
	}
	_, err = fmt.Fprintf(w, "event: stage\ndata: %s\n\n", payload)
	return err
}
