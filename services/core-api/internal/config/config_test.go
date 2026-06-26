package config

import "testing"

func TestLoadDefaults(t *testing.T) {
	t.Setenv("PORT", "")
	cfg := Load()
	if cfg.Addr != ":8080" {
		t.Fatalf("default Addr = %q, want :8080", cfg.Addr)
	}
	if cfg.ReadHeaderTimeout <= 0 {
		t.Fatalf("ReadHeaderTimeout must be positive, got %v", cfg.ReadHeaderTimeout)
	}
	if cfg.ShutdownTimeout <= 0 {
		t.Fatalf("ShutdownTimeout must be positive, got %v", cfg.ShutdownTimeout)
	}
}

func TestLoadHonoursPORT(t *testing.T) {
	t.Setenv("PORT", "9090")
	if got := Load().Addr; got != ":9090" {
		t.Fatalf("Addr with PORT=9090 = %q, want :9090", got)
	}
}

func TestLoadFallsBackOnEmptyPORT(t *testing.T) {
	t.Setenv("PORT", "")
	if got := Load().Addr; got != ":8080" {
		t.Fatalf("Addr with empty PORT = %q, want :8080", got)
	}
}

func TestLoadDatabaseDefaults(t *testing.T) {
	t.Setenv("DATABASE_URL", "")
	t.Setenv("DB_MAX_CONNS", "")
	cfg := Load()
	if cfg.DatabaseURL == "" {
		t.Fatal("DatabaseURL must have a local-dev default")
	}
	if cfg.DBMaxConns <= 0 {
		t.Fatalf("DBMaxConns must be positive, got %d", cfg.DBMaxConns)
	}
	if cfg.DBConnectTimeout <= 0 {
		t.Fatalf("DBConnectTimeout must be positive, got %v", cfg.DBConnectTimeout)
	}
}

func TestLoadHonoursDatabaseEnv(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://x@db:5432/y")
	t.Setenv("DB_MAX_CONNS", "32")
	cfg := Load()
	if cfg.DatabaseURL != "postgres://x@db:5432/y" {
		t.Fatalf("DatabaseURL = %q, want the env value", cfg.DatabaseURL)
	}
	if cfg.DBMaxConns != 32 {
		t.Fatalf("DBMaxConns = %d, want 32", cfg.DBMaxConns)
	}
}

func TestLoadFallsBackOnInvalidMaxConns(t *testing.T) {
	t.Setenv("DB_MAX_CONNS", "not-a-number")
	if got := Load().DBMaxConns; got != 8 {
		t.Fatalf("DBMaxConns with garbage env = %d, want default 8", got)
	}
}
