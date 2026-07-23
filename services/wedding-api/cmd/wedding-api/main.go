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

	"github.com/huongnguyenduc/lumin-studio/services/wedding-api/internal/auth"
	"github.com/huongnguyenduc/lumin-studio/services/wedding-api/internal/config"
	"github.com/huongnguyenduc/lumin-studio/services/wedding-api/internal/db"
	"github.com/huongnguyenduc/lumin-studio/services/wedding-api/internal/httpapi"
	"github.com/huongnguyenduc/lumin-studio/services/wedding-api/internal/uploadstore"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	cfg := config.Load()

	// Fail fast on a forgeable session key (mirrors core-api): the dev fallback
	// lets anyone mint an admin token → guest PII + settings writes. Local dev
	// opts in with ALLOW_DEV_JWT_SECRET=true; production sets JWT_SECRET.
	if cfg.UsesForgeableJWTSecret() {
		logger.Error("refusing to start: JWT_SECRET unset — admin session tokens would be forgeable. Set JWT_SECRET (production) or ALLOW_DEV_JWT_SECRET=true (local dev only).")
		os.Exit(1)
	}
	if cfg.JWTSecret == config.DevJWTSecret {
		logger.Warn("signing admin sessions with the INSECURE dev secret (ALLOW_DEV_JWT_SECRET=true) — never in production")
	}
	if cfg.AdminPassword == "" {
		logger.Warn("ADMIN_PASSWORD unset — admin login is DISABLED (503) until configured")
	}

	// Uploads are optional at boot: incomplete UPLOAD_S3_* config disables the
	// presign endpoint (503) but the rest of the API serves (log-and-disable).
	uploads, err := uploadstore.New(cfg.Upload)
	if err != nil {
		logger.Warn("uploads disabled", "reason", err.Error())
		uploads = nil
	}

	pool, err := db.Open(context.Background(), cfg)
	if err != nil {
		logger.Error("open postgres pool", "err", err)
		os.Exit(1)
	}
	defer pool.Close()

	srv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           httpapi.New(pool, auth.New(cfg), uploads, cfg.RootDomain),
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
