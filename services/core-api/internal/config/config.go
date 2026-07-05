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

	// JWTSecret signs the admin session JWT (HS256, ADR-030 self-issued auth). REQUIRED in
	// production: the well-known DevJWTSecret fallback yields forgeable owner tokens (a
	// money-out risk — the owner can reconcile→PAID / change the STK), so main.go logs a
	// loud warning while it is in use. Source it from the environment; never commit a real one.
	JWTSecret string
	// JWTTTL is the admin session lifetime. On expiry the admin simply re-logs in — there is
	// no refresh token this slice (ADR-030; a home single-shop panel, accept-downtime ADR-009).
	// Override via JWT_TTL (Go duration, e.g. "12h").
	JWTTTL time.Duration
	// CookieSecure sets the Secure flag on the session cookie. Default true — the Cloudflare
	// edge terminates HTTPS. Set COOKIE_SECURE=false ONLY for local plain-http dev, or the
	// browser withholds the cookie and login silently appears to fail.
	CookieSecure bool
	// AllowDevJWTSecret must be set true to start the server with the well-known DevJWTSecret
	// fallback (i.e. with JWT_SECRET unset). It exists so signing with a forgeable key is an
	// EXPLICIT local-dev opt-in, never a silent production default: main.go refuses to start when
	// JWT_SECRET is unset and this flag is off (a Warn log alone can be missed in a deploy —
	// review finding, PR-3e-1). `make verify-go`/CI never start the server, so this gate does not
	// affect them. Set ALLOW_DEV_JWT_SECRET=true for local `go run`; set JWT_SECRET in production.
	// The same opt-in also covers CustomerJWTSecret below (one dev-mode switch for both realms).
	AllowDevJWTSecret bool

	// CustomerJWTSecret signs the SEPARATE storefront-customer session JWT (PR-P1-r). It MUST differ
	// from JWTSecret so an admin token can never validate as a customer session and vice versa
	// (cryptographic realm isolation, ADR-030). REQUIRED in production: a forgeable customer token
	// lets anyone read any customer's order history (PII leak), so main.go fail-fasts on the dev
	// fallback without the opt-in — exactly like the admin secret. Source it from the environment.
	CustomerJWTSecret string
	// CustomerJWTTTL is the storefront session lifetime. Defaults longer than the admin's (a shopper
	// should not be logged out mid-browse); on expiry the customer simply logs in again — no refresh
	// token this slice (ADR-030). Override via CUSTOMER_JWT_TTL (Go duration, e.g. "720h").
	CustomerJWTTTL time.Duration
}

// DevJWTSecret is the fallback signing secret used when JWT_SECRET is unset. It is
// deliberately NOT a secret — its only job is to keep local dev and `make verify-go` running
// with no environment set. main.go refuses to start when it is in use without an explicit
// opt-in; production MUST set JWT_SECRET (a known signing key means anyone can forge an owner
// session and reconcile→PAID / change the STK).
const DevJWTSecret = "lumin-dev-insecure-jwt-secret-do-not-use-in-prod"

// DevCustomerJWTSecret is the fallback signing secret for the storefront-customer realm when
// CUSTOMER_JWT_SECRET is unset. Deliberately NOT a secret and deliberately DIFFERENT from
// DevJWTSecret so the two realms stay isolated even in local dev. Production MUST set
// CUSTOMER_JWT_SECRET (a known key means anyone can forge a customer session and read others'
// order history — a PII leak); main.go refuses to start on it without ALLOW_DEV_JWT_SECRET.
const DevCustomerJWTSecret = "lumin-dev-insecure-customer-jwt-secret-do-not-use-in-prod"

// UsesForgeableJWTSecret reports whether the server would sign session tokens with the public
// DevJWTSecret fallback WITHOUT an explicit opt-in (ALLOW_DEV_JWT_SECRET). main.go treats this
// as a fatal misconfiguration and refuses to start — a forgeable owner token is a money-out risk
// too grave to guard with a Warn log alone (PR-3e-1 review). A real JWT_SECRET, or the dev
// default WITH the opt-in, both return false.
func (c Config) UsesForgeableJWTSecret() bool {
	return c.JWTSecret == DevJWTSecret && !c.AllowDevJWTSecret
}

// UsesForgeableCustomerJWTSecret is the customer-realm twin of UsesForgeableJWTSecret (PR-P1-r):
// true when the storefront session JWT would be signed with the public DevCustomerJWTSecret without
// an explicit opt-in. main.go fail-fasts on it — a forgeable customer token exposes every
// customer's order history (PII). The same ALLOW_DEV_JWT_SECRET opt-in clears both realms.
func (c Config) UsesForgeableCustomerJWTSecret() bool {
	return c.CustomerJWTSecret == DevCustomerJWTSecret && !c.AllowDevJWTSecret
}

// RealmSecretsCollide reports whether the admin and customer realms would sign with the SAME secret
// (PR-P1-r). ADR-030's realm isolation is *cryptographic*: the two secrets must differ, or an admin
// token could validate as a customer session (and vice versa) and the separation collapses to mere
// cookie-name scoping. main.go fail-fasts on it. The dev fallbacks are deliberately distinct, so this
// only trips when an operator sets JWT_SECRET == CUSTOMER_JWT_SECRET.
func (c Config) RealmSecretsCollide() bool {
	return c.JWTSecret == c.CustomerJWTSecret
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
		JWTSecret:         getenv("JWT_SECRET", DevJWTSecret),
		JWTTTL:            getenvDuration("JWT_TTL", 12*time.Hour),
		CookieSecure:      getenvBool("COOKIE_SECURE", true),
		AllowDevJWTSecret: getenvBool("ALLOW_DEV_JWT_SECRET", false),
		CustomerJWTSecret: getenv("CUSTOMER_JWT_SECRET", DevCustomerJWTSecret),
		CustomerJWTTTL:    getenvDuration("CUSTOMER_JWT_TTL", 720*time.Hour),
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

// getenvBool returns the bool value of env key (strconv.ParseBool syntax: 1/t/true/0/f/false),
// or fallback when it is unset, empty, or not a valid bool.
func getenvBool(key string, fallback bool) bool {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		if b, err := strconv.ParseBool(v); err == nil {
			return b
		}
	}
	return fallback
}
