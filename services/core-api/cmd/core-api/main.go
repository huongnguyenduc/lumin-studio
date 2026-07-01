// Command core-api is the Lumin Studio BFF (Go + Chi v5).
//
// Boot: load config → open the Postgres pool → connect NATS + provision streams → start the
// outbox→NATS relay goroutine → build the router → serve with graceful shutdown. The
// OrderStatus state machine and server-side money live in internal/order + internal/money; the
// data layer (sqlc/migrations/outbox) in internal/db; the publish-on-commit relay in
// internal/relay (ADR-006/029). Auth + RBAC, HTTP domain routes and SSE come in later slices.
// See docs/architecture.md §3 and spec.md §04.
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

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/auth"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/config"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/httpapi"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/natsx"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/relay"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))

	cfg := config.Load()

	// Fail fast if the session JWT would be signed with the well-known dev secret and the
	// operator has NOT explicitly opted in. A forgeable signing key lets anyone mint an owner
	// token and reconcile→PAID / change the STK (money-out) — too grave to guard with a Warn log
	// alone, which a deploy pipeline can miss (review finding, PR-3e-1). Local dev sets
	// ALLOW_DEV_JWT_SECRET=true; production sets JWT_SECRET. This check never runs in
	// `make verify-go`/CI (they don't start the server).
	if cfg.UsesForgeableJWTSecret() {
		logger.Error("refusing to start: JWT_SECRET is unset so the session JWT would be signed with the public dev secret (forgeable owner tokens). Set JWT_SECRET (production) or ALLOW_DEV_JWT_SECRET=true (local dev only).")
		os.Exit(1)
	}
	if cfg.JWTSecret == config.DevJWTSecret {
		logger.Warn("signing session JWTs with the INSECURE dev secret (ALLOW_DEV_JWT_SECRET=true) — never use this in production; the tokens are forgeable")
	}

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
	// outage at start is non-fatal (accept-downtime, ADR-009). If it fails here, two paths
	// recover it without a restart: the reconnect handler below, and the relay's inline
	// re-ensure on a no-stream publish (the down-at-boot-then-up case fires no reconnect).
	topoCtx, topoCancel := context.WithTimeout(context.Background(), 5*time.Second)
	if err := nc.EnsureTopology(topoCtx, cfg.RelayDupWindow); err != nil {
		logger.Warn("nats topology not ensured at boot (relay will re-ensure on reconnect / no-stream)", "err", err)
	}
	topoCancel()
	// Re-ensure the streams whenever NATS reconnects, so a topology lost across a broker
	// restart converges without a core-api restart (idempotent; ADR-029 carry-over).
	nc.ReEnsureOnReconnect(cfg.RelayDupWindow, logger)

	// Build the self-issued auth token issuer (ADR-030). The JWT-secret safety check ran right
	// after config.Load() above (fail-fast unless ALLOW_DEV_JWT_SECRET), so by here the signing
	// key is either a real JWT_SECRET or a deliberately opted-in dev secret.
	authIssuer := auth.NewIssuer(cfg.JWTSecret, cfg.JWTTTL, cfg.CookieSecure)

	// Start the outbox→NATS relay: one in-process goroutine draining committed `pending` rows
	// publish-on-commit (ADR-006/029). Cancel + join it on shutdown BEFORE nc.Close()/pool.Close()
	// so it releases its NATS + DB handles first. A panic inside is recovered (relay.drainOnce).
	relayCtx, relayStop := context.WithCancel(context.Background())
	relayDone := make(chan struct{})
	go func() {
		defer close(relayDone)
		relay.New(pool, nc, cfg, logger).Run(relayCtx)
	}()
	// stopRelay cancels the loop and waits for the goroutine to exit (idempotent join).
	stopRelay := func() {
		relayStop()
		<-relayDone
	}

	srv := &http.Server{
		Addr:    cfg.Addr,
		Handler: httpapi.NewRouter(logger, pool, nc, authIssuer),
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
		stopRelay()
		nc.Close()
		pool.Close()
		os.Exit(1)
	case <-ctx.Done():
		logger.Info("shutdown signal received, draining")
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
	defer cancel()
	shutdownErr := srv.Shutdown(shutdownCtx)
	// Stop the relay (cancel + join) so it stops publishing, THEN close NATS (flush pending
	// publishes) and the pool — AFTER the HTTP server drains so in-flight requests release
	// their handles first. The relay holds both DB + NATS, so it must exit before either closes.
	stopRelay()
	nc.Close()
	pool.Close()
	if shutdownErr != nil {
		logger.Error("graceful shutdown failed", "err", shutdownErr)
		os.Exit(1)
	}
	logger.Info("core-api stopped cleanly")
}
