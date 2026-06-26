// Package db owns the Postgres connection pool (pgx/v5 / pgxpool) and hosts the
// sqlc-generated query layer (internal/db/sqlc) plus the hand-written repository
// wrappers that land in later slices. Handlers stay thin and call repositories here —
// SQL never leaks into httpapi/cmd (architecture.md §3, the thin-handler split).
//
// The pool connects ONLY to the app Postgres (the compose `postgres` service), never
// postgres-umami (ADR-004).
package db

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/config"
)

// ErrNotFound is the domain-level "no row" sentinel. Repository wrappers translate
// pgx.ErrNoRows into this so callers use errors.Is without importing pgx — matching the
// %w sentinel style in internal/money and internal/order.
var ErrNotFound = errors.New("db: record not found")

// Open builds a pgx connection pool from cfg. It validates the DSN and applies pool
// knobs but does NOT open a connection (pgxpool connects lazily on first use) — a
// momentarily-unreachable database must not block process start; readiness is reported
// separately via Ping. Returns an error only when the DSN itself is malformed.
func Open(ctx context.Context, cfg config.Config) (*pgxpool.Pool, error) {
	pcfg, err := pgxpool.ParseConfig(cfg.DatabaseURL)
	if err != nil {
		return nil, fmt.Errorf("db: parse DATABASE_URL: %w", err)
	}
	if cfg.DBMaxConns > 0 {
		pcfg.MaxConns = cfg.DBMaxConns
	}
	if cfg.DBConnectTimeout > 0 {
		pcfg.ConnConfig.ConnectTimeout = cfg.DBConnectTimeout
	}
	pool, err := pgxpool.NewWithConfig(ctx, pcfg)
	if err != nil {
		return nil, fmt.Errorf("db: new pool: %w", err)
	}
	return pool, nil
}

// Ping verifies the pool can reach Postgres within timeout. The readiness probe uses it;
// it is the first real connection attempt, so it surfaces a down/unreachable database.
func Ping(ctx context.Context, pool *pgxpool.Pool, timeout time.Duration) error {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	return pool.Ping(ctx)
}
