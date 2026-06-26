// Package httpapi wires the core-api HTTP router: the baseline middleware stack
// and the platform endpoints (health/readiness). Domain routes (orders,
// products, settings, SSE) mount here in later phases — keep handlers thin and
// push business logic into domain packages.
package httpapi

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

// NewRouter builds the chi router with the baseline middleware stack and the
// platform probes.
func NewRouter(logger *slog.Logger) http.Handler {
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

	// Liveness: the process is up. Readiness gains real dependency checks
	// (Postgres, NATS, Garage) once those are wired — see architecture.md §2.
	r.Get("/healthz", health)
	r.Get("/readyz", health)

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
