package httpapi

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"

	"github.com/google/uuid"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/modelstore"
)

// Integration test for the model-upload + asset-job surface (P3-j-b) against real Postgres (skip local
// without Docker, run in CI — ADR-020). Owner-actor driven (the owner-only boundary is proven Docker-free
// in TestAssetJobWritesAreOwnerOnly). It exercises the full pipeline the branches only real FKs + the
// outbox can prove: presign a model → enqueue a job from the host-pinned finalUrl → the asset_job.created
// outbox row committed atomically (publish-on-commit) → list it back → foreign-URL/bad-type/unknown-product.
func TestProductAssetJobsEndToEnd(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()
	owner := ownerCtx()
	srv := NewServer(slog.New(slog.NewTextHandler(io.Discard, nil)), pool, nil, nil, WithModelUploads(testModelStore(t)))

	cat, _ := db.NewCatalog(pool).CreateCategory(ctx, sqlc.InsertCategoryParams{ID: uuid.New(), Slug: "cat-aj", Name: "DM"})
	prod, err := db.NewCatalog(pool).CreateProduct(ctx, sqlc.InsertProductParams{
		ID: uuid.New(), Slug: "den-aj", Name: "Đèn", Description: "", CategoryID: cat.ID, BasePrice: 1,
		Dimensions: []byte(`{"w":1,"d":1,"h":1}`), Material: "PLA", Images: []byte(`[]`), Status: sqlc.ProductStatusDraft,
	})
	if err != nil {
		t.Fatalf("seed product: %v", err)
	}

	// --- an existing product with no jobs lists as [] (not 404) ---
	if jobs := listAssetJobs(t, srv, owner, prod.ID); len(jobs) != 0 {
		t.Fatalf("new product jobs = %d, want 0", len(jobs))
	}

	// --- presign a model upload (owner); finalUrl is host-pinned ---
	upResp, err := srv.CreateProductModelUpload(owner, api.CreateProductModelUploadRequestObject{Id: prod.ID, Body: &api.ModelUploadInput{ContentType: "model/gltf-binary"}})
	if err != nil {
		t.Fatalf("model-upload: %v", err)
	}
	up, ok := upResp.(api.CreateProductModelUpload200JSONResponse)
	if !ok {
		t.Fatalf("model-upload resp = %T, want 200", upResp)
	}
	if up.FinalUrl == "" || up.MaxBytes != modelstore.MaxUploadSize {
		t.Fatalf("presign finalUrl=%q maxBytes=%d", up.FinalUrl, up.MaxBytes)
	}

	// --- enqueue a job from the host-pinned finalUrl → 201 queued ---
	ajResp, err := srv.CreateProductAssetJob(owner, api.CreateProductAssetJobRequestObject{Id: prod.ID, Body: &api.AssetJobInput{
		JobType: "model_ingest", SourceModelUrl: up.FinalUrl, SourceVersion: "cafebabecafebabe",
	}})
	if err != nil {
		t.Fatalf("asset-job: %v", err)
	}
	aj, ok := ajResp.(api.CreateProductAssetJob201JSONResponse)
	if !ok {
		t.Fatalf("asset-job resp = %T, want 201", ajResp)
	}
	if aj.Status != "queued" || aj.JobType != "model_ingest" || aj.ProductId != prod.ID || aj.Attempts != 0 || aj.SourceModelUrl != up.FinalUrl {
		t.Fatalf("job = %+v (want queued/model_ingest/prod/0 attempts/host-pinned src)", aj)
	}

	// --- publish-on-commit: the asset_job.created outbox row committed atomically with the job ---
	var outboxCount int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM outbox WHERE aggregate_id=$1 AND event_type='asset_job.created'`, aj.Id).Scan(&outboxCount); err != nil {
		t.Fatalf("outbox query: %v", err)
	}
	if outboxCount != 1 {
		t.Fatalf("outbox asset_job.created rows = %d, want 1 (publish-on-commit, ADR-006)", outboxCount)
	}

	// --- list now returns the queued job ---
	jobs := listAssetJobs(t, srv, owner, prod.ID)
	if len(jobs) != 1 || jobs[0].Id != aj.Id || jobs[0].Status != "queued" {
		t.Fatalf("list = %+v, want 1 queued job", jobs)
	}

	// --- a foreign (not host-pinned) sourceModelUrl → 400, and NO job/outbox written ---
	badResp, err := srv.CreateProductAssetJob(owner, api.CreateProductAssetJobRequestObject{Id: prod.ID, Body: &api.AssetJobInput{
		JobType: "sprite_render", SourceModelUrl: "https://evil.test/steal.glb", SourceVersion: "cafebabecafebabe",
	}})
	if err != nil {
		t.Fatalf("foreign-url call err: %v", err)
	}
	if _, ok := badResp.(api.CreateProductAssetJob400JSONResponse); !ok {
		t.Fatalf("foreign url resp = %T, want 400", badResp)
	}
	if jobs := listAssetJobs(t, srv, owner, prod.ID); len(jobs) != 1 {
		t.Fatalf("after rejected foreign url, jobs = %d, want still 1", len(jobs))
	}

	// --- a non-model content-type on model-upload → 400 (the handler maps ErrInvalidContentType) ---
	ctResp, err := srv.CreateProductModelUpload(owner, api.CreateProductModelUploadRequestObject{Id: prod.ID, Body: &api.ModelUploadInput{ContentType: "image/png"}})
	if err != nil {
		t.Fatalf("bad content-type call err: %v", err)
	}
	if _, ok := ctResp.(api.CreateProductModelUpload400JSONResponse); !ok {
		t.Fatalf("bad content-type resp = %T, want 400", ctResp)
	}

	// --- unknown product → 404 on all three (upload/list/create) ---
	unknown := uuid.New()
	if _, err := srv.CreateProductModelUpload(owner, api.CreateProductModelUploadRequestObject{Id: unknown, Body: &api.ModelUploadInput{ContentType: "model/gltf-binary"}}); !errors.Is(err, db.ErrNotFound) {
		t.Fatalf("model-upload unknown product: err = %v, want ErrNotFound (404)", err)
	}
	if _, err := srv.GetProductAssetJobs(owner, api.GetProductAssetJobsRequestObject{Id: unknown}); !errors.Is(err, db.ErrNotFound) {
		t.Fatalf("list unknown product: err = %v, want ErrNotFound (404)", err)
	}
	if _, err := srv.CreateProductAssetJob(owner, api.CreateProductAssetJobRequestObject{Id: unknown, Body: &api.AssetJobInput{
		JobType: "model_ingest", SourceModelUrl: up.FinalUrl, SourceVersion: "cafebabecafebabe",
	}}); !errors.Is(err, db.ErrNotFound) {
		t.Fatalf("asset-job unknown product: err = %v, want ErrNotFound (404 via FK)", err)
	}
}

func listAssetJobs(t *testing.T, srv *Server, ctx context.Context, pid uuid.UUID) []api.AssetJob {
	t.Helper()
	resp, err := srv.GetProductAssetJobs(ctx, api.GetProductAssetJobsRequestObject{Id: pid})
	if err != nil {
		t.Fatalf("list asset jobs: %v", err)
	}
	return []api.AssetJob(resp.(api.GetProductAssetJobs200JSONResponse))
}
