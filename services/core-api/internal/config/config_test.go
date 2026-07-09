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

func TestLoadPaymentProofUploadDefaults(t *testing.T) {
	for _, k := range []string{
		"PAYMENT_PROOF_S3_ENDPOINT",
		"PAYMENT_PROOF_S3_REGION",
		"PAYMENT_PROOF_BUCKET",
		"PAYMENT_PROOF_PUBLIC_BASE_URL",
		"PAYMENT_PROOF_ACCESS_KEY_ID",
		"PAYMENT_PROOF_SECRET_ACCESS_KEY",
		"PAYMENT_PROOF_KEY_PREFIX",
		"PAYMENT_PROOF_POST_TTL",
		"PAYMENT_PROOF_MAX_BYTES",
	} {
		t.Setenv(k, "")
	}
	cfg := Load().PaymentProofUploads
	if cfg.S3Endpoint != "http://127.0.0.1:3900" {
		t.Fatalf("S3Endpoint default = %q, want local Garage", cfg.S3Endpoint)
	}
	if cfg.S3Region != "garage" {
		t.Fatalf("S3Region default = %q, want garage", cfg.S3Region)
	}
	if cfg.Bucket != "lumin-payment-proofs" {
		t.Fatalf("Bucket default = %q, want lumin-payment-proofs", cfg.Bucket)
	}
	if cfg.PublicBaseURL != "http://127.0.0.1:3900/lumin-payment-proofs" {
		t.Fatalf("PublicBaseURL default = %q, want local bucket URL", cfg.PublicBaseURL)
	}
	if cfg.AccessKeyID != "" || cfg.SecretAccessKey != "" {
		t.Fatal("payment-proof S3 credentials must default blank, never a weak committed secret")
	}
	if cfg.KeyPrefix != "payment-proofs" {
		t.Fatalf("KeyPrefix default = %q, want payment-proofs", cfg.KeyPrefix)
	}
	if cfg.PostTTL != 5*time.Minute {
		t.Fatalf("PostTTL default = %v, want 5m", cfg.PostTTL)
	}
	if cfg.MaxBytes != 10*1024*1024 {
		t.Fatalf("MaxBytes default = %d, want 10MiB", cfg.MaxBytes)
	}
}

func TestLoadHonoursPaymentProofUploadEnv(t *testing.T) {
	t.Setenv("PAYMENT_PROOF_S3_ENDPOINT", "https://s3.example.test")
	t.Setenv("PAYMENT_PROOF_S3_REGION", "garage-prod")
	t.Setenv("PAYMENT_PROOF_BUCKET", "receipts")
	t.Setenv("PAYMENT_PROOF_PUBLIC_BASE_URL", "https://assets.example.test/receipts")
	t.Setenv("PAYMENT_PROOF_ACCESS_KEY_ID", "key-id")
	t.Setenv("PAYMENT_PROOF_SECRET_ACCESS_KEY", "secret")
	t.Setenv("PAYMENT_PROOF_KEY_PREFIX", "proofs")
	t.Setenv("PAYMENT_PROOF_POST_TTL", "2m")
	t.Setenv("PAYMENT_PROOF_MAX_BYTES", "1048576")
	cfg := Load().PaymentProofUploads
	if cfg.S3Endpoint != "https://s3.example.test" ||
		cfg.S3Region != "garage-prod" ||
		cfg.Bucket != "receipts" ||
		cfg.PublicBaseURL != "https://assets.example.test/receipts" ||
		cfg.AccessKeyID != "key-id" ||
		cfg.SecretAccessKey != "secret" ||
		cfg.KeyPrefix != "proofs" ||
		cfg.PostTTL != 2*time.Minute ||
		cfg.MaxBytes != 1048576 {
		t.Fatalf("PaymentProofUploads did not honour env: %+v", cfg)
	}
}

func TestLoadFallsBackOnInvalidDuration(t *testing.T) {
	t.Setenv("RELAY_DUP_WINDOW", "not-a-duration")
	if got := Load().RelayDupWindow; got != 2*time.Minute {
		t.Fatalf("RelayDupWindow with garbage env = %v, want default 2m", got)
	}
}

func TestLoadAuthDefaults(t *testing.T) {
	for _, k := range []string{"JWT_SECRET", "JWT_TTL", "COOKIE_SECURE", "ALLOW_DEV_JWT_SECRET", "TRACKING_SECRET"} {
		t.Setenv(k, "")
	}
	cfg := Load()
	if cfg.JWTSecret != DevJWTSecret {
		t.Fatalf("JWTSecret default = %q, want the dev fallback", cfg.JWTSecret)
	}
	if cfg.TrackingSecret != DevTrackingSecret {
		t.Fatalf("TrackingSecret default = %q, want the dev fallback", cfg.TrackingSecret)
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

// The customer realm's forgeable-secret guard mirrors the admin one (PR-P1-r): a forgeable customer
// token lets anyone read any customer's order history (PII), so main.go fail-fasts on it.
func TestUsesForgeableCustomerJWTSecret(t *testing.T) {
	cases := []struct {
		name     string
		secret   string
		allowDev bool
		want     bool
	}{
		{"dev customer secret, no opt-in → forgeable (refuse start)", DevCustomerJWTSecret, false, true},
		{"dev customer secret WITH opt-in → allowed", DevCustomerJWTSecret, true, false},
		{"real customer secret → allowed", "a-real-customer-secret", false, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			cfg := Config{CustomerJWTSecret: tc.secret, AllowDevJWTSecret: tc.allowDev}
			if got := cfg.UsesForgeableCustomerJWTSecret(); got != tc.want {
				t.Fatalf("UsesForgeableCustomerJWTSecret() = %v, want %v", got, tc.want)
			}
		})
	}
}

// The phone-less tracking token's forgeable-secret guard mirrors the JWT ones (P2-i, D-P2-8): a
// forgeable TRACKING_SECRET lets anyone derive any order's tracking link and read its timeline, so
// main.go fail-fasts on it. The same ALLOW_DEV_JWT_SECRET opt-in clears it for local dev.
func TestUsesForgeableTrackingSecret(t *testing.T) {
	cases := []struct {
		name     string
		secret   string
		allowDev bool
		want     bool
	}{
		{"dev tracking secret, no opt-in → forgeable (refuse start)", DevTrackingSecret, false, true},
		{"dev tracking secret WITH opt-in → allowed", DevTrackingSecret, true, false},
		{"real tracking secret → allowed", "a-real-tracking-secret", false, false},
		{"real tracking secret + stray opt-in → allowed", "a-real-tracking-secret", true, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			cfg := Config{TrackingSecret: tc.secret, AllowDevJWTSecret: tc.allowDev}
			if got := cfg.UsesForgeableTrackingSecret(); got != tc.want {
				t.Fatalf("UsesForgeableTrackingSecret() = %v, want %v", got, tc.want)
			}
		})
	}
}

// The two realms MUST sign with different secrets (ADR-030 cryptographic isolation); main.go
// fail-fasts when they collide. The dev fallbacks are distinct, so a default Load() never collides.
func TestRealmSecretsCollide(t *testing.T) {
	if (Config{JWTSecret: "same", CustomerJWTSecret: "same"}).RealmSecretsCollide() != true {
		t.Fatal("identical secrets must collide")
	}
	if (Config{JWTSecret: "admin", CustomerJWTSecret: "customer"}).RealmSecretsCollide() != false {
		t.Fatal("distinct secrets must not collide")
	}
	if Load().RealmSecretsCollide() {
		t.Fatal("default Load() must not collide (dev fallbacks are deliberately distinct)")
	}
}
