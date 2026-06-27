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

	// NATSURL is the JetStream broker URL (the compose `nats` service). A connect
	// failure is NOT fatal — the client reconnects in the background and readiness
	// reports it (mirrors the lazy pgx pool); the relay drains accumulated rows on
	// recovery (accept-downtime, ADR-009).
	NATSURL string
	// RelayPollInterval is how often the slice-3 outbox relay scans for pending rows.
	RelayPollInterval time.Duration
	// RelayBatchSize bounds one relay scan, so polling can't starve HTTP handlers on
	// the shared DBMaxConns pool (the box also feeds Blender, ADR-014).
	RelayBatchSize int
	// RelayMaxAttempts is the per-row publish-attempt budget before an outbox row is
	// quarantined as 'failed' (a poison row must not re-poison the seq scan, ADR-029).
	RelayMaxAttempts int
	// RelayDupWindow is the JetStream stream DuplicateWindow — the Nats-Msg-Id dedup
	// horizon that collapses an at-least-once republish after a crash-before-mark.
	RelayDupWindow time.Duration
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
		NATSURL:           getenv("NATS_URL", "nats://127.0.0.1:4222"),
		RelayPollInterval: getenvDuration("RELAY_POLL_INTERVAL", time.Second),
		RelayBatchSize:    getenvInt("RELAY_BATCH_SIZE", 100),
		RelayMaxAttempts:  getenvInt("RELAY_MAX_ATTEMPTS", 5),
		RelayDupWindow:    getenvDuration("RELAY_DUP_WINDOW", 2*time.Minute),
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

// getenvDuration returns the time.Duration parsed from env key (Go syntax, e.g. "1s",
// "2m"), or fallback when it is unset, empty, or not a valid duration.
func getenvDuration(key string, fallback time.Duration) time.Duration {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
	}
	return fallback
}
