package modelstore

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
	now := time.Date(2026, 7, 11, 12, 34, 56, 0, time.UTC)
	store := mustStore(t)
	store.now = func() time.Time { return now }
	store.newID = func() uuid.UUID { return id }

	up, err := store.PresignPost(context.Background(), "model/gltf-binary")
	if err != nil {
		t.Fatalf("PresignPost: %v", err)
	}

	wantKey := "models/2026/07/11/11111111-2222-3333-4444-555555555555.glb"
	if up.UploadURL != "https://s3.example.test/lumin-assets/" {
		t.Fatalf("uploadURL = %q, want path-style bucket endpoint", up.UploadURL)
	}
	if up.FinalURL != "https://assets.example.test/lumin-assets/"+wantKey {
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

	f := up.Fields
	if f["key"] != wantKey {
		t.Fatalf("fields[key] = %q, want %q", f["key"], wantKey)
	}
	if f["Content-Type"] != "model/gltf-binary" {
		t.Fatalf("fields[Content-Type] = %q", f["Content-Type"])
	}
	if f["success_action_status"] != "201" {
		t.Fatalf("fields[success_action_status] = %q", f["success_action_status"])
	}
	for _, required := range []string{"policy", "x-amz-credential", "x-amz-date", "x-amz-signature"} {
		if f[required] == "" {
			t.Fatalf("fields[%s] is empty; want a signed value", required)
		}
	}

	// The signed policy must pin the exact key, Content-Type, bucket and a 1..MaxBytes range.
	policy := decodePolicy(t, f["policy"])
	assertPolicyEq(t, policy.Conditions, "key", wantKey)
	assertPolicyEq(t, policy.Conditions, "Content-Type", "model/gltf-binary")
	assertPolicyEq(t, policy.Conditions, "bucket", "lumin-assets")
	assertPolicyRange(t, policy.Conditions, 1, MaxUploadSize)
}

func TestStorePresignsEachModelType(t *testing.T) {
	for contentType, ext := range map[string]string{
		"model/gltf-binary": "glb",
		"model/stl":         "stl",
		"model/3mf":         "3mf",
	} {
		t.Run(ext, func(t *testing.T) {
			id := uuid.MustParse("11111111-2222-3333-4444-555555555555")
			now := time.Date(2026, 7, 11, 0, 0, 0, 0, time.UTC)
			store := mustStore(t)
			store.now = func() time.Time { return now }
			store.newID = func() uuid.UUID { return id }
			up, err := store.PresignPost(context.Background(), contentType)
			if err != nil {
				t.Fatalf("PresignPost(%q): %v", contentType, err)
			}
			wantKey := "models/2026/07/11/11111111-2222-3333-4444-555555555555." + ext
			if up.Fields["key"] != wantKey {
				t.Fatalf("fields[key] = %q, want %q", up.Fields["key"], wantKey)
			}
			if !store.OwnsURL(up.FinalURL) {
				t.Fatalf("store must own the %s finalURL it minted", ext)
			}
		})
	}
}

func TestStoreOwnsOnlyHostPinnedURLs(t *testing.T) {
	store := mustStore(t)
	valid := "https://assets.example.test/lumin-assets/models/2026/07/11/11111111-2222-3333-4444-555555555555.glb"
	if !store.OwnsURL(valid) {
		t.Fatalf("valid store-shaped finalURL rejected")
	}
	for name, raw := range map[string]string{
		"empty":        "",
		"bad-scheme":   "ftp://assets.example.test/lumin-assets/models/2026/07/11/11111111-2222-3333-4444-555555555555.glb",
		"foreign":      "https://cdn.example.test/lumin-assets/models/2026/07/11/11111111-2222-3333-4444-555555555555.glb",
		"wrong-base":   "https://assets.example.test/other-bucket/models/2026/07/11/11111111-2222-3333-4444-555555555555.glb",
		"wrong-prefix": "https://assets.example.test/lumin-assets/sprites/2026/07/11/11111111-2222-3333-4444-555555555555.glb",
		"query":        valid + "?download=1",
		"fragment":     valid + "#top",
		"dot-segment":  "https://assets.example.test/lumin-assets/models/2026/07/11/../11111111-2222-3333-4444-555555555555.glb",
		"bad-date":     "https://assets.example.test/lumin-assets/models/2026/99/11/11111111-2222-3333-4444-555555555555.glb",
		"bad-id":       "https://assets.example.test/lumin-assets/models/2026/07/11/not-a-uuid.glb",
		"bad-ext":      "https://assets.example.test/lumin-assets/models/2026/07/11/11111111-2222-3333-4444-555555555555.png",
		"image-proof":  "https://assets.example.test/lumin-assets/models/2026/07/11/11111111-2222-3333-4444-555555555555.jpg",
	} {
		t.Run(name, func(t *testing.T) {
			if store.OwnsURL(raw) {
				t.Fatalf("OwnsURL(%q) = true, want false", raw)
			}
		})
	}
}

func TestStoreHostOnlyPublicBase(t *testing.T) {
	// Website mode serves lumin-assets by Host (Garage web endpoint), so the public base is host-only — no
	// /lumin-assets path segment. finalURL, OwnsURL and OwnsOutputURL must all still round-trip through the
	// objectKeyFromFinalPath empty-base branch. See infra/k8s/README §public asset serving.
	cfg := validConfig()
	cfg.PublicBaseURL = "https://assets.luminstudio.vn"
	store, err := New(cfg)
	if err != nil {
		t.Fatalf("New host-only base: %v", err)
	}
	store.now = func() time.Time { return time.Date(2026, 7, 11, 0, 0, 0, 0, time.UTC) }
	store.newID = func() uuid.UUID { return uuid.MustParse("11111111-2222-3333-4444-555555555555") }

	up, err := store.PresignPost(context.Background(), "model/gltf-binary")
	if err != nil {
		t.Fatalf("PresignPost: %v", err)
	}
	wantFinal := "https://assets.luminstudio.vn/models/2026/07/11/11111111-2222-3333-4444-555555555555.glb"
	if up.FinalURL != wantFinal {
		t.Fatalf("finalURL = %q, want host-only %q", up.FinalURL, wantFinal)
	}
	if !store.OwnsURL(up.FinalURL) {
		t.Fatalf("store must own the host-only finalURL it minted: %q", up.FinalURL)
	}
	// The worker's derivative output (different key namespace, no minted-key shape) host-pins here too.
	if !store.OwnsOutputURL("https://assets.luminstudio.vn/derivatives/cafebabe/model.glb") {
		t.Fatalf("OwnsOutputURL rejected a valid host-only derivative URL")
	}
	if store.OwnsOutputURL("https://evil.test/derivatives/cafebabe/model.glb") {
		t.Fatalf("OwnsOutputURL accepted a foreign host")
	}
}

func TestStoreRejectsBadInput(t *testing.T) {
	store := mustStore(t)
	// Images (the proofstore class) and octet-stream are rejected — the editor must declare a model MIME.
	for _, contentType := range []string{"", "text/plain", "image/png", "application/octet-stream", "model/gltf-binary; charset=binary"} {
		if _, err := store.PresignPost(context.Background(), contentType); !errors.Is(err, ErrInvalidContentType) {
			t.Fatalf("PresignPost(%q) err = %v, want ErrInvalidContentType", contentType, err)
		}
	}

	for _, tc := range []struct {
		name string
		edit func(*config.ModelUploadConfig)
	}{
		{"missing secret", func(c *config.ModelUploadConfig) { c.SecretAccessKey = "" }},
		{"bad endpoint scheme", func(c *config.ModelUploadConfig) { c.S3Endpoint = "ftp://s3.example.test" }},
		{"bad public base", func(c *config.ModelUploadConfig) { c.PublicBaseURL = "https:///missing-host" }},
		{"ttl above cap", func(c *config.ModelUploadConfig) { c.PostTTL = 6 * time.Minute }},
		{"max bytes above cap", func(c *config.ModelUploadConfig) { c.MaxBytes = MaxUploadSize + 1 }},
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
	contentType, ext, ok := normalizeContentType("MODEL/GLTF-BINARY")
	if !ok || contentType != "model/gltf-binary" || ext != "glb" {
		t.Fatalf("normalize uppercase glb = %q/%q/%v", contentType, ext, ok)
	}
}

func validConfig() config.ModelUploadConfig {
	return config.ModelUploadConfig{
		S3Endpoint:      "https://s3.example.test",
		S3Region:        "garage",
		Bucket:          "lumin-assets",
		PublicBaseURL:   "https://assets.example.test/lumin-assets",
		AccessKeyID:     "test-key",
		SecretAccessKey: "test-secret",
		KeyPrefix:       "models",
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

func assertPolicyRange(t *testing.T, conditions []any, minBytes, maxBytes int64) {
	t.Helper()
	for _, c := range conditions {
		arr, ok := c.([]any)
		if !ok || len(arr) != 3 || arr[0] != "content-length-range" {
			continue
		}
		gotMin, okMin := arr[1].(float64)
		gotMax, okMax := arr[2].(float64)
		if okMin && okMax && int64(gotMin) == minBytes && int64(gotMax) == maxBytes {
			return
		}
	}
	t.Fatalf("policy missing content-length-range %d..%d in %#v", minBytes, maxBytes, conditions)
}
