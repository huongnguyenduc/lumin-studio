// Command core-api is the Lumin Studio BFF (Go + Chi v5).
//
// Boot skeleton: load config → open the Postgres pool → build the router → serve with
// graceful shutdown. The OrderStatus state machine and server-side money already live
// in internal/order + internal/money; the data layer (sqlc/migrations/outbox) is landing
// in the Core data-layer slice. Auth + RBAC, the outbox→NATS publisher and SSE come in
// later slices. See docs/architecture.md §3 and spec.md §04.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/config"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/httpapi"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/natsx"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))

	cfg := config.Load()

	// Open the pool before serving. pgxpool connects lazily, so this fails fast only
	// on a malformed DSN — not on a momentarily-down database (readiness reports that).
	pool, err := db.Open(context.Background(), cfg)
	if err != nil {
		logger.Error("database pool init failed", "err", err)
		os.Exit(1)
	}

	// Connect to NATS after the pool. Like the pool, a momentarily-down broker must not
	// block start: nats.Connect retries in the background and readiness reports it. Connect
	// errors only on a malformed URL (a config bug) — fail fast there, mirroring the pool.
	nc, err := natsx.Connect(cfg)
	if err != nil {
		logger.Error("nats connect init failed", "err", err)
		pool.Close()
		os.Exit(1)
	}
	// Provision the JetStream streams the relay publishes into. Best-effort at boot: a NATS
	// outage at start is non-fatal (accept-downtime, ADR-009) — the streams are re-provisioned
	// on the next boot (and, once the relay lands in PR-3b, when it reconnects).
	topoCtx, topoCancel := context.WithTimeout(context.Background(), 5*time.Second)
	if err := nc.EnsureTopology(topoCtx, cfg.RelayDupWindow); err != nil {
		logger.Warn("nats topology not ensured at boot (will retry on next boot)", "err", err)
	}
	topoCancel()

	srv := &http.Server{
		Addr:    cfg.Addr,
		Handler: httpapi.NewRouter(logger, pool, nc),
		// ReadHeaderTimeout covers the Slowloris header vector. Read/Write/Idle
		// timeouts are intentionally unset for now — TODO(phase-1): source
		// IdleTimeout + Read/WriteTimeout from config once real request bodies land
		// (SSE routes need per-route handling, not a global WriteTimeout —
		// conventions.md §Realtime).
		ReadHeaderTimeout: cfg.ReadHeaderTimeout,
	}

	// Serve in the background; a fatal listen error arrives on errCh.
	errCh := make(chan error, 1)
	go func() {
		logger.Info("core-api listening", "addr", cfg.Addr)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
	}()

	// Block until a termination signal or a fatal listen error.
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	select {
	case err := <-errCh:
		logger.Error("server failed", "err", err)
		nc.Close()
		pool.Close()
		os.Exit(1)
	case <-ctx.Done():
		logger.Info("shutdown signal received, draining")
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
	defer cancel()
	shutdownErr := srv.Shutdown(shutdownCtx)
	// Close NATS (flush pending publishes) then the pool, AFTER the HTTP server drains so
	// in-flight requests release their handles first. NATS before the pool so a future
	// relay goroutine — which holds both — has released them by pool close.
	nc.Close()
	pool.Close()
	if shutdownErr != nil {
		logger.Error("graceful shutdown failed", "err", shutdownErr)
		os.Exit(1)
	}
	logger.Info("core-api stopped cleanly")
}
