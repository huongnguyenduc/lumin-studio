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

	// RootDomain is the suffix (e.g. "luminstudio.vn") that marks a request Host
	// as an actual couple subdomain attempt — vs. an infra host (k8s readiness
	// probe hitting the pod IP, localhost dev, apex) that must keep falling back
	// to the default wedding instead of 404ing. Override via env if the domain
	// is ever migrated.
	RootDomain string

	// AdminPassword is the single shared admin password (HANDOFF §6 — 1–2 operators,
	// no user management). Empty → login is DISABLED (503), never open.
	AdminPassword string
	// JWTSecret signs the admin session JWT (HS256). REQUIRED in production: the
	// well-known dev fallback yields forgeable admin tokens (guest PII + settings
	// writes), so main.go refuses to start on the fallback without the opt-in.
	JWTSecret string
	// AllowDevJWTSecret must be true to start with JWTSecret unset (local dev only).
	AllowDevJWTSecret bool
	// JWTTTL is the admin session lifetime; on expiry the host just logs in again.
	JWTTTL time.Duration
	// CookieSecure sets Secure on the session cookie. Default true (Cloudflare edge
	// terminates HTTPS); set COOKIE_SECURE=false only for local plain-http dev.
	CookieSecure bool

	// Upload is the presigned-upload config for host-configurable media (HANDOFF
	// §3.5) — a dedicated `wedding-assets` Garage bucket with its own scoped key.
	// Any required field empty → uploads are disabled (503), the rest of the API
	// still boots (mirrors core-api's log-and-disable pattern).
	Upload UploadConfig
}

// UploadConfig mirrors core-api's proofstore config, one bucket, presigned POST
// (POST — not PUT — so the S3 policy enforces content-length-range + Content-Type
// server-side).
type UploadConfig struct {
	// S3Endpoint is the S3 API endpoint the browser POSTs to (e.g. the public
	// Garage URL behind the tunnel).
	S3Endpoint string
	// S3Region is the SigV4 credential-scope region (Garage: "garage").
	S3Region string
	// Bucket is the dedicated wedding-assets bucket.
	Bucket string
	// PublicBaseURL is the host-pinned base the stored object URL derives from.
	PublicBaseURL string
	// AccessKeyID / SecretAccessKey are the bucket-scoped signing key.
	AccessKeyID     string
	SecretAccessKey string
	// PresignTTL bounds how long a signed policy stays valid.
	PresignTTL time.Duration
}

// DevJWTSecret is the well-known local-dev signing key. Anything signed with it
// is forgeable — main.go gates startup on AllowDevJWTSecret when it is in use.
const DevJWTSecret = "wedding-dev-secret-do-not-use-in-prod"

// UsesForgeableJWTSecret reports the fatal misconfiguration: dev fallback in use
// without the explicit local-dev opt-in.
func (c Config) UsesForgeableJWTSecret() bool {
	return c.JWTSecret == DevJWTSecret && !c.AllowDevJWTSecret
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

		RootDomain: getenv("ROOT_DOMAIN", "luminstudio.vn"),

		AdminPassword:     os.Getenv("ADMIN_PASSWORD"),
		JWTSecret:         getenv("JWT_SECRET", DevJWTSecret),
		AllowDevJWTSecret: os.Getenv("ALLOW_DEV_JWT_SECRET") == "true",
		JWTTTL:            getDuration("JWT_TTL", 12*time.Hour),
		CookieSecure:      getenv("COOKIE_SECURE", "true") == "true",

		Upload: UploadConfig{
			S3Endpoint:      os.Getenv("UPLOAD_S3_ENDPOINT"),
			S3Region:        getenv("UPLOAD_S3_REGION", "garage"),
			Bucket:          getenv("UPLOAD_S3_BUCKET", "wedding-assets"),
			PublicBaseURL:   os.Getenv("UPLOAD_PUBLIC_BASE_URL"),
			AccessKeyID:     os.Getenv("UPLOAD_S3_ACCESS_KEY_ID"),
			SecretAccessKey: os.Getenv("UPLOAD_S3_SECRET_ACCESS_KEY"),
			PresignTTL:      getDuration("UPLOAD_PRESIGN_TTL", 10*time.Minute),
		},
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
