package config

import (
	"testing"
	"time"
)

func TestLoadDefaults(t *testing.T) {
	cfg := Load()
	if cfg.Addr != ":8081" {
		t.Errorf("Addr = %q, want :8081", cfg.Addr)
	}
	if cfg.DBMaxConns != 5 {
		t.Errorf("DBMaxConns = %d, want 5", cfg.DBMaxConns)
	}
}

func TestLoadEnvOverrides(t *testing.T) {
	t.Setenv("PORT", "9000")
	t.Setenv("DATABASE_URL", "postgres://x/y")
	t.Setenv("SHUTDOWN_TIMEOUT", "3s")
	t.Setenv("DB_MAX_CONNS", "not-a-number") // malformed → fallback

	cfg := Load()
	if cfg.Addr != ":9000" {
		t.Errorf("Addr = %q, want :9000", cfg.Addr)
	}
	if cfg.DatabaseURL != "postgres://x/y" {
		t.Errorf("DatabaseURL = %q", cfg.DatabaseURL)
	}
	if cfg.ShutdownTimeout != 3*time.Second {
		t.Errorf("ShutdownTimeout = %v, want 3s", cfg.ShutdownTimeout)
	}
	if cfg.DBMaxConns != 5 {
		t.Errorf("DBMaxConns = %d, want fallback 5 on malformed env", cfg.DBMaxConns)
	}
}
