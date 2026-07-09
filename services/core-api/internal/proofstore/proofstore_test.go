package proofstore

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/config"
)

func TestStorePresignsHostPinnedPostPolicy(t *testing.T) {
	id := uuid.MustParse("11111111-2222-3333-4444-555555555555")
	now := time.Date(2026, 7, 6, 12, 34, 56, 0, time.UTC)
	store := mustStore(t)
	store.now = func() time.Time { return now }
	store.newID = func() uuid.UUID { return id }

	up, err := store.PresignPost(context.Background(), "image/png")
	if err != nil {
		t.Fatalf("PresignPost: %v", err)
	}

	wantKey := "proofs/2026/07/06/11111111-2222-3333-4444-555555555555.png"
	// UploadURL is the path-style bucket endpoint the browser POSTs to (minio's canonical form ends
	// in a slash).
	if up.UploadURL != "https://s3.example.test/lumin-payment-proofs/" {
		t.Fatalf("uploadURL = %q, want path-style bucket endpoint", up.UploadURL)
	}
	// FinalURL is host-pinned to the public base + server key, and the store must accept what it made.
	if up.FinalURL != "https://assets.example.test/private/receipts/"+wantKey {
		t.Fatalf("finalURL = %q, want host-pinned public URL with key", up.FinalURL)
	}
	if !store.OwnsURL(up.FinalURL) {
		t.Fatalf("store must accept the finalURL it created: %q", up.FinalURL)
	}
	if up.MaxBytes != MaxUploadSize {
		t.Fatalf("maxBytes = %d, want %d", up.MaxBytes, MaxUploadSize)
	}
	if !up.ExpiresAt.Equal(now.Add(5 * time.Minute)) {
		t.Fatalf("expiresAt = %s, want %s", up.ExpiresAt, now.Add(5*time.Minute))
	}

	// minio signs with its own clock, so assert the fields structurally (not an exact signature).
	f := up.Fields
	if f["key"] != wantKey {
		t.Fatalf("fields[key] = %q, want %q", f["key"], wantKey)
	}
	if f["Content-Type"] != "image/png" {
		t.Fatalf("fields[Content-Type] = %q", f["Content-Type"])
	}
	if f["success_action_status"] != "201" {
		t.Fatalf("fields[success_action_status] = %q", f["success_action_status"])
	}
	if f["x-amz-algorithm"] != "AWS4-HMAC-SHA256" {
		t.Fatalf("fields[x-amz-algorithm] = %q", f["x-amz-algorithm"])
	}
	for _, required := range []string{"policy", "x-amz-credential", "x-amz-date", "x-amz-signature"} {
		if f[required] == "" {
			t.Fatalf("fields[%s] is empty; want a signed value", required)
		}
	}

	// The signed policy must pin the exact key, Content-Type and a 1..MaxBytes content-length-range.
	policy := decodePolicy(t, f["policy"])
	assertPolicyEq(t, policy.Conditions, "key", wantKey)
	assertPolicyEq(t, policy.Conditions, "Content-Type", "image/png")
	assertPolicyEq(t, policy.Conditions, "bucket", "lumin-payment-proofs")
	assertPolicyRange(t, policy.Conditions, 1, MaxUploadSize)
}

func TestStoreOwnsOnlyHostPinnedURLs(t *testing.T) {
	store := mustStore(t)
	valid := "https://assets.example.test/private/receipts/proofs/2026/07/06/11111111-2222-3333-4444-555555555555.jpg"
	if !store.OwnsURL(valid) {
		t.Fatalf("valid store-shaped finalURL rejected")
	}
	for name, raw := range map[string]string{
		"empty":        "",
		"bad-scheme":   "ftp://assets.example.test/private/receipts/proofs/2026/07/06/11111111-2222-3333-4444-555555555555.jpg",
		"foreign":      "https://cdn.example.test/private/receipts/proofs/2026/07/06/11111111-2222-3333-4444-555555555555.jpg",
		"wrong-base":   "https://assets.example.test/private/archive/proofs/2026/07/06/11111111-2222-3333-4444-555555555555.jpg",
		"wrong-prefix": "https://assets.example.test/private/receipts/other/2026/07/06/11111111-2222-3333-4444-555555555555.jpg",
		"query":        valid + "?download=1",
		"fragment":     valid + "#top",
		"dot-segment":  "https://assets.example.test/private/receipts/proofs/2026/07/06/../11111111-2222-3333-4444-555555555555.jpg",
		"bad-date":     "https://assets.example.test/private/receipts/proofs/2026/99/06/11111111-2222-3333-4444-555555555555.jpg",
		"bad-id":       "https://assets.example.test/private/receipts/proofs/2026/07/06/not-a-uuid.jpg",
		"bad-ext":      "https://assets.example.test/private/receipts/proofs/2026/07/06/11111111-2222-3333-4444-555555555555.gif",
	} {
		t.Run(name, func(t *testing.T) {
			if store.OwnsURL(raw) {
				t.Fatalf("OwnsURL(%q) = true, want false", raw)
			}
		})
	}
}

func TestStoreDeleteIgnoresForeignURLs(t *testing.T) {
	// A non-owned URL must be a no-op WITHOUT any object-store call (the guard fires before minio),
	// so retention never deletes an arbitrary object it does not manage.
	store := mustStore(t)
	for _, raw := range []string{
		"",
		"https://cdn.example.test/private/receipts/proofs/2026/07/06/11111111-2222-3333-4444-555555555555.jpg",
		"https://assets.example.test/private/receipts/other/2026/07/06/11111111-2222-3333-4444-555555555555.jpg",
	} {
		deleted, err := store.Delete(context.Background(), raw)
		if err != nil || deleted {
			t.Fatalf("Delete(%q) = (%v, %v), want (false, nil)", raw, deleted, err)
		}
	}
}

func TestStoreRejectsBadInput(t *testing.T) {
	store := mustStore(t)
	for _, contentType := range []string{"", "text/plain", "image/gif", "image/jpeg; charset=binary"} {
		if _, err := store.PresignPost(context.Background(), contentType); !errors.Is(err, ErrInvalidContentType) {
			t.Fatalf("PresignPost(%q) err = %v, want ErrInvalidContentType", contentType, err)
		}
	}

	for _, tc := range []struct {
		name string
		edit func(*config.PaymentProofUploadConfig)
	}{
		{"missing secret", func(c *config.PaymentProofUploadConfig) { c.SecretAccessKey = "" }},
		{"bad endpoint scheme", func(c *config.PaymentProofUploadConfig) { c.S3Endpoint = "ftp://s3.example.test" }},
		{"bad public base", func(c *config.PaymentProofUploadConfig) { c.PublicBaseURL = "https:///missing-host" }},
		{"ttl above cap", func(c *config.PaymentProofUploadConfig) { c.PostTTL = 6 * time.Minute }},
		{"max bytes above cap", func(c *config.PaymentProofUploadConfig) { c.MaxBytes = MaxUploadSize + 1 }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			cfg := validConfig()
			tc.edit(&cfg)
			if _, err := New(cfg); err == nil {
				t.Fatal("New must reject unsafe config")
			}
		})
	}
}

func TestNormalizeContentType(t *testing.T) {
	contentType, ext, ok := normalizeContentType("IMAGE/JPEG")
	if !ok || contentType != "image/jpeg" || ext != "jpg" {
		t.Fatalf("normalize uppercase jpeg = %q/%q/%v", contentType, ext, ok)
	}
}

func validConfig() config.PaymentProofUploadConfig {
	return config.PaymentProofUploadConfig{
		S3Endpoint:      "https://s3.example.test",
		S3Region:        "garage",
		Bucket:          "lumin-payment-proofs",
		PublicBaseURL:   "https://assets.example.test/private/receipts",
		AccessKeyID:     "test-key",
		SecretAccessKey: "test-secret",
		KeyPrefix:       "proofs",
		PostTTL:         5 * time.Minute,
		MaxBytes:        MaxUploadSize,
	}
}

func mustStore(t *testing.T) *Store {
	t.Helper()
	store, err := New(validConfig())
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	return store
}

type decodedPolicy struct {
	Expiration string `json:"expiration"`
	Conditions []any  `json:"conditions"`
}

func decodePolicy(t *testing.T, policy64 string) decodedPolicy {
	t.Helper()
	raw, err := base64.StdEncoding.DecodeString(policy64)
	if err != nil {
		t.Fatalf("decode policy: %v", err)
	}
	var out decodedPolicy
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("unmarshal policy %s: %v", string(raw), err)
	}
	return out
}

// assertPolicyEq finds a minio ["eq", "$field", want] exact-match condition.
func assertPolicyEq(t *testing.T, conditions []any, field, want string) {
	t.Helper()
	for _, c := range conditions {
		arr, ok := c.([]any)
		if !ok || len(arr) != 3 || arr[0] != "eq" || arr[1] != "$"+field {
			continue
		}
		if got, ok := arr[2].(string); ok && got == want {
			return
		}
	}
	t.Fatalf("policy missing [\"eq\", %q, %q] in %#v", "$"+field, want, conditions)
}

func assertPolicyRange(t *testing.T, conditions []any, min, max int64) {
	t.Helper()
	for _, c := range conditions {
		arr, ok := c.([]any)
		if !ok || len(arr) != 3 || arr[0] != "content-length-range" {
			continue
		}
		gotMin, okMin := arr[1].(float64)
		gotMax, okMax := arr[2].(float64)
		if okMin && okMax && int64(gotMin) == min && int64(gotMax) == max {
			return
		}
	}
	t.Fatalf("policy missing content-length-range %d..%d in %#v", min, max, conditions)
}
