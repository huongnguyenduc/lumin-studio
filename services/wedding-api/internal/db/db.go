// Package db owns the Postgres connection pool for wedding-api.
package db

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/huongnguyenduc/lumin-studio/services/wedding-api/internal/config"
)

// Open builds the pgx pool from config. pgxpool connects lazily, so this fails
// fast only on a malformed DSN — readiness (/readyz) reports a down database.
func Open(ctx context.Context, cfg config.Config) (*pgxpool.Pool, error) {
	pc, err := pgxpool.ParseConfig(cfg.DatabaseURL)
	if err != nil {
		return nil, err
	}
	pc.MaxConns = cfg.DBMaxConns
	pc.ConnConfig.ConnectTimeout = cfg.DBConnectTimeout
	return pgxpool.NewWithConfig(ctx, pc)
}
