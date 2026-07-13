package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/config"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/proofstore"
)

func TestCreateImageUploadHandler(t *testing.T) {
	srv := NewServer(slog.New(slog.NewTextHandler(io.Discard, nil)), nil, nil, nil, WithImageUploads(newTestImageStore()))
	ctx := context.Background()

	resp, err := srv.CreateImageUpload(ctx, api.CreateImageUploadRequestObject{
		Body: &api.ImageUploadInput{ContentType: "image/webp"},
	})
	if err != nil {
		t.Fatalf("CreateImageUpload: %v", err)
	}
	ok, good := resp.(api.CreateImageUpload200JSONResponse)
	if !good {
		t.Fatalf("resp = %T, want 200", resp)
	}
	// The whole point of t-6: pet photos land in the PERMANENT public bucket under a distinct prefix, never
	// the retention-swept payment-proof bucket. Lock the finalUrl bucket + prefix so a config regression that
	// re-points this signer at the proof bucket fails here.
	if !strings.Contains(ok.FinalUrl, "/lumin-assets/") || !strings.Contains(ok.FinalUrl, "/pet-images/") {
		t.Fatalf("finalUrl = %q, want lumin-assets bucket + pet-images/ prefix (permanent, not the proof bucket)", ok.FinalUrl)
	}
	if ok.Fields["Content-Type"] != "image/webp" || ok.MaxBytes != proofstore.MaxUploadSize || ok.UploadUrl == "" {
		t.Fatalf("upload = %+v", ok)
	}

	bad, err := srv.CreateImageUpload(ctx, api.CreateImageUploadRequestObject{Body: nil})
	if err != nil {
		t.Fatalf("nil body should render typed 400, got err %v", err)
	}
	if _, good := bad.(api.CreateImageUpload400JSONResponse); !good {
		t.Fatalf("nil body resp = %T, want 400", bad)
	}

	bad, err = srv.CreateImageUpload(ctx, api.CreateImageUploadRequestObject{
		Body: &api.ImageUploadInput{ContentType: "application/pdf"},
	})
	if err != nil {
		t.Fatalf("bad content type should render typed 400, got err %v", err)
	}
	if _, good := bad.(api.CreateImageUpload400JSONResponse); !good {
		t.Fatalf("bad content type resp = %T, want 400", bad)
	}

	unconfigured := NewServer(slog.New(slog.NewTextHandler(io.Discard, nil)), nil, nil, nil)
	_, err = unconfigured.CreateImageUpload(ctx, api.CreateImageUploadRequestObject{
		Body: &api.ImageUploadInput{ContentType: "image/jpeg"},
	})
	if !errors.Is(err, errImageUploadNotConfigured) {
		t.Fatalf("unconfigured err = %v, want errImageUploadNotConfigured", err)
	}
	if status, env := mapError(err); status != http.StatusInternalServerError || env.Code != codeInternal {
		t.Fatalf("mapError(unconfigured) = %d/%s, want 500/%s", status, env.Code, codeInternal)
	}
}

func TestCreateImageUploadPublicRoute(t *testing.T) {
	h := NewRouter(
		slog.New(slog.NewTextHandler(io.Discard, nil)),
		nil,
		nil,
		nil,
		WithImageUploads(newTestImageStore()),
	)
	req := httptest.NewRequest(http.MethodPost, "/uploads/image", strings.NewReader(`{"contentType":"image/jpeg"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("POST /uploads/image without cookie = %d, want 200 (mount + authPublic); body=%s", rec.Code, rec.Body.String())
	}
	var body api.ImageUpload
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body.Fields["Content-Type"] != "image/jpeg" || body.FinalUrl == "" || body.UploadUrl == "" {
		t.Fatalf("response body = %+v", body)
	}
}

func validImageUploadConfig() config.PaymentProofUploadConfig {
	return config.PaymentProofUploadConfig{
		S3Endpoint:      "https://s3.example.test",
		S3Region:        "garage",
		Bucket:          "lumin-assets",
		PublicBaseURL:   "https://assets.example.test/lumin-assets",
		AccessKeyID:     "test-key",
		SecretAccessKey: "test-secret",
		KeyPrefix:       "pet-images",
		PostTTL:         5 * time.Minute,
		MaxBytes:        proofstore.MaxUploadSize,
	}
}

// newTestImageStore builds an image signer pointed at a lumin-assets-shaped bucket. It panics rather than
// taking a *testing.T so it mirrors newTestProofStore; proofstore.New only fails on bad config (a test bug).
func newTestImageStore() *proofstore.Store {
	store, err := proofstore.New(validImageUploadConfig())
	if err != nil {
		panic("proofstore.New(validImageUploadConfig): " + err.Error())
	}
	return store
}
