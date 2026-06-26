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

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/config"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/httpapi"
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

	srv := &http.Server{
		Addr:    cfg.Addr,
		Handler: httpapi.NewRouter(logger, pool),
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
		pool.Close()
		os.Exit(1)
	case <-ctx.Done():
		logger.Info("shutdown signal received, draining")
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
	defer cancel()
	shutdownErr := srv.Shutdown(shutdownCtx)
	// Close the pool AFTER the HTTP server drains, so in-flight requests release their
	// connections first.
	pool.Close()
	if shutdownErr != nil {
		logger.Error("graceful shutdown failed", "err", shutdownErr)
		os.Exit(1)
	}
	logger.Info("core-api stopped cleanly")
}
