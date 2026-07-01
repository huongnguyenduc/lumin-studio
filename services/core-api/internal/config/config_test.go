package config

import (
	"testing"
	"time"
)

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

func TestLoadNATSDefaults(t *testing.T) {
	for _, k := range []string{"NATS_URL", "RELAY_POLL_INTERVAL", "RELAY_BATCH_SIZE", "RELAY_MAX_ATTEMPTS", "RELAY_DUP_WINDOW"} {
		t.Setenv(k, "")
	}
	cfg := Load()
	if cfg.NATSURL != "nats://127.0.0.1:4222" {
		t.Fatalf("NATSURL default = %q, want nats://127.0.0.1:4222", cfg.NATSURL)
	}
	if cfg.RelayPollInterval != time.Second {
		t.Fatalf("RelayPollInterval default = %v, want 1s", cfg.RelayPollInterval)
	}
	if cfg.RelayBatchSize != 100 {
		t.Fatalf("RelayBatchSize default = %d, want 100", cfg.RelayBatchSize)
	}
	if cfg.RelayMaxAttempts != 5 {
		t.Fatalf("RelayMaxAttempts default = %d, want 5", cfg.RelayMaxAttempts)
	}
	if cfg.RelayDupWindow != 2*time.Minute {
		t.Fatalf("RelayDupWindow default = %v, want 2m", cfg.RelayDupWindow)
	}
}

func TestLoadHonoursNATSEnv(t *testing.T) {
	t.Setenv("NATS_URL", "nats://broker:4222")
	t.Setenv("RELAY_POLL_INTERVAL", "500ms")
	t.Setenv("RELAY_BATCH_SIZE", "250")
	t.Setenv("RELAY_MAX_ATTEMPTS", "9")
	t.Setenv("RELAY_DUP_WINDOW", "30s")
	cfg := Load()
	if cfg.NATSURL != "nats://broker:4222" {
		t.Fatalf("NATSURL = %q, want the env value", cfg.NATSURL)
	}
	if cfg.RelayPollInterval != 500*time.Millisecond {
		t.Fatalf("RelayPollInterval = %v, want 500ms", cfg.RelayPollInterval)
	}
	if cfg.RelayBatchSize != 250 {
		t.Fatalf("RelayBatchSize = %d, want 250", cfg.RelayBatchSize)
	}
	if cfg.RelayMaxAttempts != 9 {
		t.Fatalf("RelayMaxAttempts = %d, want 9", cfg.RelayMaxAttempts)
	}
	if cfg.RelayDupWindow != 30*time.Second {
		t.Fatalf("RelayDupWindow = %v, want 30s", cfg.RelayDupWindow)
	}
}

func TestLoadFallsBackOnInvalidDuration(t *testing.T) {
	t.Setenv("RELAY_DUP_WINDOW", "not-a-duration")
	if got := Load().RelayDupWindow; got != 2*time.Minute {
		t.Fatalf("RelayDupWindow with garbage env = %v, want default 2m", got)
	}
}

func TestLoadAuthDefaults(t *testing.T) {
	for _, k := range []string{"JWT_SECRET", "JWT_TTL", "COOKIE_SECURE", "ALLOW_DEV_JWT_SECRET"} {
		t.Setenv(k, "")
	}
	cfg := Load()
	if cfg.JWTSecret != DevJWTSecret {
		t.Fatalf("JWTSecret default = %q, want the dev fallback", cfg.JWTSecret)
	}
	if cfg.JWTTTL != 12*time.Hour {
		t.Fatalf("JWTTTL default = %v, want 12h", cfg.JWTTTL)
	}
	if !cfg.CookieSecure {
		t.Fatal("CookieSecure must default true (HTTPS at the edge)")
	}
	if cfg.AllowDevJWTSecret {
		t.Fatal("AllowDevJWTSecret must default false (dev secret is opt-in)")
	}
}

func TestLoadHonoursAuthEnv(t *testing.T) {
	t.Setenv("JWT_SECRET", "a-real-production-secret")
	t.Setenv("JWT_TTL", "1h")
	t.Setenv("COOKIE_SECURE", "false")
	cfg := Load()
	if cfg.JWTSecret != "a-real-production-secret" {
		t.Fatalf("JWTSecret = %q, want the env value", cfg.JWTSecret)
	}
	if cfg.JWTTTL != time.Hour {
		t.Fatalf("JWTTTL = %v, want 1h", cfg.JWTTTL)
	}
	if cfg.CookieSecure {
		t.Fatal("CookieSecure must honour COOKIE_SECURE=false (local http dev)")
	}
}

// The money-critical gate main.go fail-fasts on: the dev secret is "forgeable" ONLY without the
// explicit opt-in; a real secret, or the dev default WITH ALLOW_DEV_JWT_SECRET, must not trip it.
func TestUsesForgeableJWTSecret(t *testing.T) {
	cases := []struct {
		name     string
		secret   string
		allowDev bool
		want     bool
	}{
		{"dev secret, no opt-in → forgeable (refuse start)", DevJWTSecret, false, true},
		{"dev secret WITH opt-in → allowed", DevJWTSecret, true, false},
		{"real secret → allowed", "a-real-production-secret", false, false},
		{"real secret + stray opt-in → allowed", "a-real-production-secret", true, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			cfg := Config{JWTSecret: tc.secret, AllowDevJWTSecret: tc.allowDev}
			if got := cfg.UsesForgeableJWTSecret(); got != tc.want {
				t.Fatalf("UsesForgeableJWTSecret() = %v, want %v", got, tc.want)
			}
		})
	}
}
