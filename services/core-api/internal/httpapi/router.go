// Package httpapi wires the core-api HTTP router: the baseline middleware stack, the
// platform probes (health/readiness), and the OpenAPI-generated domain routes served by
// the strict-server handler on *Server. Handlers stay thin — business logic lives in the
// domain packages (internal/order, internal/money) and SQL in internal/db.
package httpapi

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
)

// NATSStatus reports whether the NATS/JetStream broker is currently reachable. The
// readiness probe uses it; *natsx.Conn satisfies it. Kept as a local interface so httpapi
// stays decoupled from the NATS client and is unit-testable with a fake.
type NATSStatus interface {
	Reachable() bool
}

// NewRouter builds the chi router with the baseline middleware stack, the platform probes,
// and the OpenAPI domain routes. The pool and nats handle back the readiness check; pass
// nil for either in unit tests that don't exercise that dependency (readiness then skips
// that check).
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

	srv := NewServer(logger, pool, nats)

	// Liveness: the process is up. Readiness adds Postgres + NATS reachability checks;
	// Garage joins them once it is wired — see architecture.md §2.
	r.Get("/healthz", health)
	r.Get("/readyz", srv.readiness)

	// Mount the OpenAPI-generated domain routes. oapi-codegen has TWO error seams and both
	// default to a plaintext http.Error(w, err.Error()) that we must override, or a raw Go
	// error (incl. the domain's Vietnamese TransitionError.Message) leaks onto the wire and
	// the response breaks the single ErrorEnvelope contract all three TS clients consume
	// (always-must #3 / ADR-032):
	//   1. the STRICT layer (Request/ResponseErrorHandlerFunc) — body decode + handler-return
	//      errors; and
	//   2. the CHI wrapper (ChiServerOptions.ErrorHandlerFunc) — path/query param binding,
	//      which fires BEFORE the strict layer (e.g. a non-UUID {id} on the transition route).
	// Both route through handleRequestError/handleResponseError → the JSON ErrorEnvelope. The
	// auth boundary (JWT-verify on the admin group, optional-auth on POST /orders) plugs into
	// the StrictMiddlewareFunc seam (the nil slice below) in PR-3e-2. Handlers are 501 stubs
	// until their domain PRs (3e–3k) land.
	strict := api.NewStrictHandlerWithOptions(srv, nil, api.StrictHTTPServerOptions{
		RequestErrorHandlerFunc:  srv.handleRequestError,
		ResponseErrorHandlerFunc: srv.handleResponseError,
	})
	return api.HandlerWithOptions(strict, api.ChiServerOptions{
		BaseRouter:       r,
		ErrorHandlerFunc: srv.handleRequestError,
	})
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

// writeJSON is the shared response helper. It marshals into a buffer first so an encode
// error surfaces as a 500 instead of a committed 200 with a truncated body.
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
