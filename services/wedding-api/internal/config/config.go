// Package config loads wedding-api runtime configuration from the environment.
// Twelve-factor: every setting comes from env with a safe local-dev default.
// Deliberately lean vs core-api (no NATS/outbox, no JWT realms yet — the wedding
// site has no events; admin auth arrives with the admin slice, HANDOFF §6).
package config

import (
	"os"
	"strconv"
	"time"
)

// Config holds wedding-api runtime settings.
type Config struct {
	// Addr is the TCP address the HTTP server binds to (":port" or "host:port").
	Addr string
	// ReadHeaderTimeout bounds reading request headers (mitigates Slowloris).
	ReadHeaderTimeout time.Duration
	// ShutdownTimeout bounds the graceful drain on SIGTERM/SIGINT.
	ShutdownTimeout time.Duration

	// DatabaseURL is the pgx DSN for the `wedding` Postgres database (a separate
	// database on the same cluster instance as lumin-studio — HANDOFF §6).
	DatabaseURL string
	// DBMaxConns bounds the pgx pool. Modest: the all-home box is shared (ADR-014).
	DBMaxConns int32
	// DBConnectTimeout bounds a single connection attempt.
	DBConnectTimeout time.Duration
}

// Load reads configuration from the environment, applying local-dev defaults.
func Load() Config {
	return Config{
		Addr:              ":" + getenv("PORT", "8081"),
		ReadHeaderTimeout: getDuration("READ_HEADER_TIMEOUT", 10*time.Second),
		ShutdownTimeout:   getDuration("SHUTDOWN_TIMEOUT", 15*time.Second),
		DatabaseURL: getenv("DATABASE_URL",
			"postgres://postgres:postgres@localhost:5432/wedding?sslmode=disable"),
		DBMaxConns:       getInt32("DB_MAX_CONNS", 5),
		DBConnectTimeout: getDuration("DB_CONNECT_TIMEOUT", 5*time.Second),
	}
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func getDuration(key string, fallback time.Duration) time.Duration {
	if v := os.Getenv(key); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
	}
	return fallback
}

func getInt32(key string, fallback int32) int32 {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.ParseInt(v, 10, 32); err == nil {
			return int32(n)
		}
	}
	return fallback
}
