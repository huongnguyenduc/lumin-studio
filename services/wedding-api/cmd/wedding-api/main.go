// Command wedding-api is the backend for the "Giang & Hiếu" wedding invitation
// site (Go + Chi v5) — see design_handoff_wedding_invitation/HANDOFF.md.
//
// Boot: load config → open the Postgres pool → build the router → serve with
// graceful shutdown. Deliberately lean vs core-api: no NATS/outbox (no events
// to publish), no codegen. Runs on the same k3s cluster as lumin-studio with
// its own `wedding` database (HANDOFF §6).
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"github.com/huongnguyenduc/lumin-studio/services/wedding-api/internal/config"
	"github.com/huongnguyenduc/lumin-studio/services/wedding-api/internal/db"
	"github.com/huongnguyenduc/lumin-studio/services/wedding-api/internal/httpapi"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	cfg := config.Load()

	pool, err := db.Open(context.Background(), cfg)
	if err != nil {
		logger.Error("open postgres pool", "err", err)
		os.Exit(1)
	}
	defer pool.Close()

	srv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           httpapi.New(pool),
		ReadHeaderTimeout: cfg.ReadHeaderTimeout,
	}

	// Serve until SIGTERM/SIGINT, then drain within ShutdownTimeout.
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer stop()

	errCh := make(chan error, 1)
	go func() { errCh <- srv.ListenAndServe() }()
	logger.Info("wedding-api listening", "addr", cfg.Addr)

	select {
	case <-ctx.Done():
		shCtx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
		defer cancel()
		if err := srv.Shutdown(shCtx); err != nil {
			logger.Error("graceful shutdown", "err", err)
			os.Exit(1)
		}
		logger.Info("wedding-api stopped")
	case err := <-errCh:
		if !errors.Is(err, http.ErrServerClosed) {
			logger.Error("serve", "err", err)
			os.Exit(1)
		}
	}
}
