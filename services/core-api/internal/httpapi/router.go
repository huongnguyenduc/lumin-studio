// Package httpapi wires the core-api HTTP router: the baseline middleware stack
// and the platform endpoints (health/readiness). Domain routes (orders,
// products, settings, SSE) mount here in later phases — keep handlers thin and
// push business logic into domain packages.
package httpapi

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/jackc/pgx/v5/pgxpool"
)

// NATSStatus reports whether the NATS/JetStream broker is currently reachable. The
// readiness probe uses it; *natsx.Conn satisfies it. Kept as a local interface so httpapi
// stays decoupled from the NATS client and is unit-testable with a fake.
type NATSStatus interface {
	Reachable() bool
}

// NewRouter builds the chi router with the baseline middleware stack and the platform
// probes. The pool and nats handle back the readiness check; pass nil for either in unit
// tests that don't exercise that dependency (readiness then skips that check).
func NewRouter(logger *slog.Logger, pool *pgxpool.Pool, nats NATSStatus) http.Handler {
	r := chi.NewRouter()

	r.Use(middleware.RequestID)
	// Real client IP comes from the trusted CF-Connecting-IP header set by the
	// Cloudflare Tunnel — wired in the edge-integration phase. We deliberately
	// do NOT use chi's middleware.RealIP (spoofable via X-Forwarded-For,
	// GHSA-3fxj-6jh8-hvhx). Rate-limiting lives at the Cloudflare WAF
	// (conventions.md §Bảo mật).
	r.Use(requestLogger(logger))
	r.Use(middleware.Recoverer)
	// NOTE: middleware.Timeout only sets a context deadline (cooperative) — it
	// cannot interrupt a handler that ignores ctx.Done(). Domain handlers MUST
	// propagate r.Context() into every DB/NATS call to be cancellable; the real
	// socket-level backstop is the http.Server Read/Write timeouts (Phase-1).
	r.Use(middleware.Timeout(30 * time.Second))

	// Liveness: the process is up. Readiness adds Postgres + NATS reachability checks;
	// Garage joins them once it is wired — see architecture.md §2.
	r.Get("/healthz", health)
	r.Get("/readyz", readiness(pool, nats))

	return r
}

// requestLogger emits one structured slog line per request.
func requestLogger(logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
			start := time.Now()
			next.ServeHTTP(ww, r)
			logger.Info("request",
				"method", r.Method,
				"path", r.URL.Path,
				"status", ww.Status(),
				"bytes", ww.BytesWritten(),
				"duration_ms", time.Since(start).Milliseconds(),
				"request_id", middleware.GetReqID(r.Context()),
			)
		})
	}
}

func health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// readiness reports 200 only when every wired dependency is reachable, 503 otherwise — so
// a load balancer drains this instance while Postgres or NATS is unreachable. A nil
// dependency (unit tests that don't exercise it) is skipped; the `dep` field on a 503
// names the failing dependency for ops triage.
func readiness(pool *pgxpool.Pool, nats NATSStatus) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if pool != nil {
			ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
			defer cancel()
			if err := pool.Ping(ctx); err != nil {
				writeJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "unavailable", "dep": "postgres"})
				return
			}
		}
		if nats != nil && !nats.Reachable() {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "unavailable", "dep": "nats"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	}
}

// writeJSON is the shared response helper. It marshals into a buffer first so a
// (currently impossible, but possible once domain structs adopt it) encode error
// surfaces as a 500 instead of a committed 200 with a truncated body.
func writeJSON(w http.ResponseWriter, status int, body any) {
	buf, err := json.Marshal(body)
	if err != nil {
		http.Error(w, `{"error":"internal"}`, http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_, _ = w.Write(buf)
}
