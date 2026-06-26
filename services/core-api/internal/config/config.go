// Package config loads core-api runtime configuration from the environment.
// Twelve-factor: every setting comes from env with a safe local-dev default.
package config

import (
	"os"
	"strconv"
	"time"
)

// Config holds core-api runtime settings.
type Config struct {
	// Addr is the TCP address the HTTP server binds to (":port" or "host:port").
	Addr string
	// ReadHeaderTimeout bounds reading request headers (mitigates Slowloris);
	// passed to http.Server.ReadHeaderTimeout.
	ReadHeaderTimeout time.Duration
	// ShutdownTimeout bounds the graceful drain on SIGTERM/SIGINT.
	ShutdownTimeout time.Duration

	// DatabaseURL is the pgx DSN for the app Postgres (the compose `postgres`
	// service, never postgres-umami — ADR-004).
	DatabaseURL string
	// DBMaxConns bounds the pgx pool. Kept modest: the all-home box shares CPU with
	// the Blender render-worker (ADR-014), so an unbounded pool would starve it.
	DBMaxConns int32
	// DBConnectTimeout bounds a single connection attempt.
	DBConnectTimeout time.Duration
}

// Load reads configuration from the environment, applying defaults. PORT matches the
// compose/Caddy wiring (Caddy reverse-proxies to core-api:8080); DATABASE_URL defaults
// to a localhost Postgres so `go vet`/build/`make verify-go` stay green with no env set.
func Load() Config {
	return Config{
		Addr:              ":" + getenv("PORT", "8080"),
		ReadHeaderTimeout: 10 * time.Second,
		ShutdownTimeout:   15 * time.Second,
		DatabaseURL:       getenv("DATABASE_URL", "postgres://lumin:lumin@localhost:5432/lumin_app?sslmode=disable"),
		DBMaxConns:        int32(getenvInt("DB_MAX_CONNS", 8)),
		DBConnectTimeout:  5 * time.Second,
	}
}

// getenv returns the env var named key, or fallback when it is unset or empty.
func getenv(key, fallback string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return fallback
}

// getenvInt returns the int value of env key, or fallback when it is unset, empty, or
// not a valid integer.
func getenvInt(key string, fallback int) int {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return fallback
}
