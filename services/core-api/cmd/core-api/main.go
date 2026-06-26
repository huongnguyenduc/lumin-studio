// Command core-api is the Lumin Studio BFF (Go + Chi v5).
//
// Phase 0 scaffold: an HTTP server with health/readiness probes and graceful
// shutdown — the boot skeleton every later phase hangs domain logic on. Auth +
// RBAC, the OrderStatus state machine, server-side money, the outbox→NATS
// publisher and SSE all land in later phases. See docs/architecture.md §3 and
// spec.md §04; money/state-machine invariants live in packages/core.
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
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/httpapi"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))

	cfg := config.Load()

	srv := &http.Server{
		Addr:    cfg.Addr,
		Handler: httpapi.NewRouter(logger),
		// ReadHeaderTimeout covers the Slowloris header vector. Read/Write/Idle
		// timeouts are intentionally unset for the health-only scaffold —
		// TODO(phase-1): source IdleTimeout + Read/WriteTimeout from config once
		// real request bodies land (SSE routes need per-route handling, not a
		// global WriteTimeout — conventions.md §Realtime).
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
		os.Exit(1)
	case <-ctx.Done():
		logger.Info("shutdown signal received, draining")
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		logger.Error("graceful shutdown failed", "err", err)
		os.Exit(1)
	}
	logger.Info("core-api stopped cleanly")
}
