// Package httpapi builds the wedding-api HTTP router (Chi v5).
//
// Scaffold slice: health probes only. The public invite/RSVP/wishes routes and
// the /api/admin group (HANDOFF §5) land in later slices.
package httpapi

import (
	"context"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/jackc/pgx/v5/pgxpool"
)

// New builds the router. pool is used by /readyz to report database reachability.
func New(pool *pgxpool.Pool) http.Handler {
	r := chi.NewRouter()
	// No RealIP middleware: it's deprecated (IP-spoofable, GHSA-3fxj-6jh8-hvhx). The
	// public rate-limit slice (HANDOFF §5) should read CF-Connecting-IP deliberately —
	// the service only ever sits behind the Cloudflare Tunnel.
	r.Use(middleware.RequestID)
	r.Use(middleware.Recoverer)

	// Liveness: the process is up and serving.
	r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})

	// Readiness: the database answers a ping (pgxpool connects lazily, so this is
	// the first real proof the DSN + network are good).
	r.Get("/readyz", func(w http.ResponseWriter, req *http.Request) {
		ctx, cancel := context.WithTimeout(req.Context(), 2*time.Second)
		defer cancel()
		if err := pool.Ping(ctx); err != nil {
			http.Error(w, "db: "+err.Error(), http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})

	return r
}
