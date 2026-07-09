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

func TestCreatePaymentProofUploadHandler(t *testing.T) {
	srv := NewServer(slog.New(slog.NewTextHandler(io.Discard, nil)), nil, nil, nil, WithPaymentProofUploads(newTestProofStore()))
	ctx := context.Background()

	resp, err := srv.CreatePaymentProofUpload(ctx, api.CreatePaymentProofUploadRequestObject{
		Body: &api.PaymentProofUploadInput{ContentType: "image/webp"},
	})
	if err != nil {
		t.Fatalf("CreatePaymentProofUpload: %v", err)
	}
	ok, good := resp.(api.CreatePaymentProofUpload200JSONResponse)
	if !good {
		t.Fatalf("resp = %T, want 200", resp)
	}
	if ok.Fields["Content-Type"] != "image/webp" || ok.MaxBytes != proofstore.MaxUploadSize || ok.FinalUrl == "" || ok.UploadUrl == "" {
		t.Fatalf("upload = %+v", ok)
	}

	bad, err := srv.CreatePaymentProofUpload(ctx, api.CreatePaymentProofUploadRequestObject{Body: nil})
	if err != nil {
		t.Fatalf("nil body should render typed 400, got err %v", err)
	}
	if _, good := bad.(api.CreatePaymentProofUpload400JSONResponse); !good {
		t.Fatalf("nil body resp = %T, want 400", bad)
	}

	bad, err = srv.CreatePaymentProofUpload(ctx, api.CreatePaymentProofUploadRequestObject{
		Body: &api.PaymentProofUploadInput{ContentType: "application/pdf"},
	})
	if err != nil {
		t.Fatalf("bad content type should render typed 400, got err %v", err)
	}
	if _, good := bad.(api.CreatePaymentProofUpload400JSONResponse); !good {
		t.Fatalf("bad content type resp = %T, want 400", bad)
	}

	unconfigured := NewServer(slog.New(slog.NewTextHandler(io.Discard, nil)), nil, nil, nil)
	_, err = unconfigured.CreatePaymentProofUpload(ctx, api.CreatePaymentProofUploadRequestObject{
		Body: &api.PaymentProofUploadInput{ContentType: "image/jpeg"},
	})
	if !errors.Is(err, errPaymentProofUploadNotConfigured) {
		t.Fatalf("unconfigured err = %v, want errPaymentProofUploadNotConfigured", err)
	}
	if status, env := mapError(err); status != http.StatusInternalServerError || env.Code != codeInternal {
		t.Fatalf("mapError(unconfigured) = %d/%s, want 500/%s", status, env.Code, codeInternal)
	}
}

func TestCreatePaymentProofUploadRateLimited(t *testing.T) {
	srv := NewServer(slog.New(slog.NewTextHandler(io.Discard, nil)), nil, nil, nil, WithPaymentProofUploads(newTestProofStore()))
	srv.proofUploadLimiter = newPaymentProofUploadLimiter(paymentProofUploadLimits{rate: 0, burst: 0})

	_, err := srv.CreatePaymentProofUpload(context.Background(), api.CreatePaymentProofUploadRequestObject{
		Body: &api.PaymentProofUploadInput{ContentType: "image/png"},
	})
	if !errors.Is(err, errRateLimited) {
		t.Fatalf("err = %v, want errRateLimited", err)
	}
	if status, env := mapError(err); status != http.StatusTooManyRequests || env.Code != codeRateLimited {
		t.Fatalf("mapError(rate limit) = %d/%s, want 429/%s", status, env.Code, codeRateLimited)
	}
}

func TestCreatePaymentProofUploadPublicRoute(t *testing.T) {
	h := NewRouter(
		slog.New(slog.NewTextHandler(io.Discard, nil)),
		nil,
		nil,
		nil,
		WithPaymentProofUploads(newTestProofStore()),
	)
	req := httptest.NewRequest(http.MethodPost, "/checkout/payment-proof-upload", strings.NewReader(`{"contentType":"image/jpeg"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("POST /checkout/payment-proof-upload without cookie = %d, want 200 (mount + authPublic); body=%s", rec.Code, rec.Body.String())
	}
	var body api.PaymentProofUpload
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body.Fields["Content-Type"] != "image/jpeg" || body.FinalUrl == "" || body.UploadUrl == "" {
		t.Fatalf("response body = %+v", body)
	}
}

func validPaymentProofConfig() config.PaymentProofUploadConfig {
	return config.PaymentProofUploadConfig{
		S3Endpoint:      "https://s3.example.test",
		S3Region:        "garage",
		Bucket:          "lumin-payment-proofs",
		PublicBaseURL:   "https://assets.example.test/private/receipts",
		AccessKeyID:     "test-key",
		SecretAccessKey: "test-secret",
		KeyPrefix:       "proofs",
		PostTTL:         5 * time.Minute,
		MaxBytes:        proofstore.MaxUploadSize,
	}
}

// newTestProofStore builds a store from the static valid config. It panics rather than taking a
// *testing.T so package-level helpers (e.g. testCheckoutServer) can wire the upload host-pin without
// threading t; proofstore.New only fails on bad config, which here would be a test bug.
func newTestProofStore() *proofstore.Store {
	store, err := proofstore.New(validPaymentProofConfig())
	if err != nil {
		panic("proofstore.New(validPaymentProofConfig): " + err.Error())
	}
	return store
}
