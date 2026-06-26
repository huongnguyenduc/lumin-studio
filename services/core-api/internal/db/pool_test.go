package db

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/config"
)

// A malformed DSN is the one thing Open must reject up front (fail-fast at boot).
func TestOpenRejectsMalformedDSN(t *testing.T) {
	cfg := config.Config{DatabaseURL: "://nope", DBMaxConns: 8, DBConnectTimeout: time.Second}
	if _, err := Open(context.Background(), cfg); err == nil {
		t.Fatal("Open should reject a malformed DATABASE_URL")
	}
}

// A valid-but-unreachable DSN must NOT fail Open (pgxpool is lazy); the failure must
// surface at Ping instead, fast. Exercises the readiness path without a live database.
func TestOpenIsLazyAndPingSurfacesUnreachable(t *testing.T) {
	cfg := config.Config{
		DatabaseURL:      "postgres://u:p@127.0.0.1:1/none?sslmode=disable",
		DBMaxConns:       4,
		DBConnectTimeout: time.Second,
	}
	pool, err := Open(context.Background(), cfg)
	if err != nil {
		t.Fatalf("Open(valid DSN) err = %v, want nil (lazy connect)", err)
	}
	defer pool.Close()

	if err := Ping(context.Background(), pool, 2*time.Second); err == nil {
		t.Fatal("Ping to an unreachable database should fail")
	}
}

func TestErrNotFoundIsComparable(t *testing.T) {
	if !errors.Is(ErrNotFound, ErrNotFound) {
		t.Fatal("ErrNotFound must be its own sentinel")
	}
}
