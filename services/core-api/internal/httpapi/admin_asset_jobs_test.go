package httpapi

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/config"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/modelstore"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/order"
)

// testModelStore builds an offline-signing model store (minio signs locally, Region fixed — no I/O) for
// the host-pin checks. Shared with the integration test (same package).
func testModelStore(t *testing.T) *modelstore.Store {
	t.Helper()
	store, err := modelstore.New(config.ModelUploadConfig{
		S3Endpoint:      "https://s3.example.test",
		S3Region:        "garage",
		Bucket:          "lumin-assets",
		PublicBaseURL:   "https://assets.example.test/lumin-assets",
		AccessKeyID:     "k",
		SecretAccessKey: "s",
		KeyPrefix:       "models",
		PostTTL:         5 * time.Minute,
		MaxBytes:        modelstore.MaxUploadSize,
	})
	if err != nil {
		t.Fatalf("model store: %v", err)
	}
	return store
}

func discardServer(t *testing.T, opts ...ServerOption) *Server {
	t.Helper()
	return NewServer(slog.New(slog.NewTextHandler(io.Discard, nil)), nil, nil, nil, opts...)
}

// The two catalog-asset WRITES are owner-only (spec §08): staff → 403, no actor → 401, BEFORE any store
// or DB touch (assertOwner is the first line). The read (GetProductAssetJobs) is owner+staff by design.
func TestAssetJobWritesAreOwnerOnly(t *testing.T) {
	srv := discardServer(t, WithModelUploads(testModelStore(t)))
	id := uuid.New()
	up := api.ModelUploadInput{ContentType: "model/gltf-binary"}
	job := api.AssetJobInput{JobType: "model_ingest", SourceModelUrl: "https://assets.example.test/lumin-assets/x.glb", SourceVersion: "deadbeef"}

	calls := map[string]func(context.Context) error{
		"CreateProductModelUpload": func(ctx context.Context) error {
			_, err := srv.CreateProductModelUpload(ctx, api.CreateProductModelUploadRequestObject{Id: id, Body: &up})
			return err
		},
		"CreateProductAssetJob": func(ctx context.Context) error {
			_, err := srv.CreateProductAssetJob(ctx, api.CreateProductAssetJobRequestObject{Id: id, Body: &job})
			return err
		},
	}
	for name, call := range calls {
		t.Run(name+"/staff→403", func(t *testing.T) {
			ctx := withActor(context.Background(), Actor{ByUser: uuid.NewString(), Role: order.RoleStaff, At: time.Now().UTC()})
			if err := call(ctx); !errors.Is(err, errForbidden) {
				t.Fatalf("staff: err = %v, want errForbidden", err)
			}
		})
		t.Run(name+"/no-actor→401", func(t *testing.T) {
			if err := call(context.Background()); !errors.Is(err, errUnauthenticated) {
				t.Fatalf("no actor: err = %v, want errUnauthenticated", err)
			}
		})
	}
}

// With no catalog-asset bucket wired (nil store), both owner-only writes fail closed with a generic 500
// (errModelUploadNotConfigured) rather than signing a spoofable form or accepting an un-host-pinnable URL.
// The nil-store check sits after assertOwner but before any pool touch, so a nil pool never panics here.
func TestModelEndpointsNotConfigured(t *testing.T) {
	srv := discardServer(t) // modelUploads nil
	owner := withActor(context.Background(), Actor{ByUser: uuid.NewString(), Role: order.RoleOwner, At: time.Now().UTC()})
	id := uuid.New()

	if _, err := srv.CreateProductModelUpload(owner, api.CreateProductModelUploadRequestObject{Id: id, Body: &api.ModelUploadInput{ContentType: "model/gltf-binary"}}); !errors.Is(err, errModelUploadNotConfigured) {
		t.Fatalf("model-upload nil store: err = %v, want errModelUploadNotConfigured", err)
	}
	if _, err := srv.CreateProductAssetJob(owner, api.CreateProductAssetJobRequestObject{Id: id, Body: &api.AssetJobInput{JobType: "model_ingest", SourceModelUrl: "https://x/m.glb", SourceVersion: "deadbeef"}}); !errors.Is(err, errModelUploadNotConfigured) {
		t.Fatalf("asset-job nil store: err = %v, want errModelUploadNotConfigured", err)
	}
}

// cleanAssetJobInput is the pre-write gate: a known jobType, a host-pinned sourceModelUrl this store
// minted, and a content-hash-shaped sourceVersion. Each is proven independently (no DB needed).
func TestCleanAssetJobInput(t *testing.T) {
	store := testModelStore(t)
	srv := discardServer(t, WithModelUploads(store))
	up, err := store.PresignPost(context.Background(), "model/gltf-binary")
	if err != nil {
		t.Fatalf("presign: %v", err)
	}
	valid := up.FinalURL // a URL the store owns (host-pinned)

	jobType, src, ver, fields := srv.cleanAssetJobInput(api.AssetJobInput{JobType: "sprite_render", SourceModelUrl: valid, SourceVersion: "DEADBEEFdeadbeef"})
	if len(fields) != 0 {
		t.Fatalf("valid input fields = %v", fields)
	}
	if string(jobType) != "sprite_render" || src != valid || ver != "DEADBEEFdeadbeef" {
		t.Fatalf("clean returned jobType=%q src=%q ver=%q", jobType, src, ver)
	}

	for name, tc := range map[string]struct {
		in    api.AssetJobInput
		field string
	}{
		"bad-jobtype":    {api.AssetJobInput{JobType: "nope", SourceModelUrl: valid, SourceVersion: "deadbeef"}, "jobType"},
		"foreign-url":    {api.AssetJobInput{JobType: "model_ingest", SourceModelUrl: "https://evil.test/steal.glb", SourceVersion: "deadbeef"}, "sourceModelUrl"},
		"empty-url":      {api.AssetJobInput{JobType: "model_ingest", SourceModelUrl: "", SourceVersion: "deadbeef"}, "sourceModelUrl"},
		"short-version":  {api.AssetJobInput{JobType: "model_ingest", SourceModelUrl: valid, SourceVersion: "ab"}, "sourceVersion"},
		"nonhex-version": {api.AssetJobInput{JobType: "model_ingest", SourceModelUrl: valid, SourceVersion: "not-a-real-hash"}, "sourceVersion"},
		"empty-version":  {api.AssetJobInput{JobType: "model_ingest", SourceModelUrl: valid, SourceVersion: ""}, "sourceVersion"},
	} {
		t.Run(name, func(t *testing.T) {
			_, _, _, fields := srv.cleanAssetJobInput(tc.in)
			if _, ok := fields[tc.field]; !ok {
				t.Fatalf("input %+v: fields = %v, want error on %q", tc.in, fields, tc.field)
			}
		})
	}
}
