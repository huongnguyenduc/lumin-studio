package httpapi

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"slices"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
)

// Integration test for the asset-worker render callback (PATCH /internal/asset-jobs/{id}, ADR-045) against
// real Postgres (skip local without Docker, run in CI — ADR-020). It calls the handler directly (the
// authService gate is proven Docker-free in internal_asset_jobs_test.go) to exercise the parts only a real
// DB + FK + row-lock can prove: a ready model_ingest writes model3d_url onto the product (D3) and stamps
// completed_at; `ready` is terminal + sticky (idempotent redelivery); failed sets last_error and leaves the
// product untouched; processing stamps nothing; and missing/foreign model3dUrl → 400 with no write. The
// ADR-049 sprite_render mirror is here too: a ready sprite writes sprite_sheet_url (never touching
// model3d_url), and a missing / wrong-extension (.glb) sprite output → 400 with no write.
func TestReportAssetJobResultEndToEnd(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()
	owner := ownerCtx()
	srv := NewServer(slog.New(slog.NewTextHandler(io.Discard, nil)), pool, nil, nil, WithModelUploads(testModelStore(t)))

	cat, _ := db.NewCatalog(pool).CreateCategory(ctx, sqlc.InsertCategoryParams{ID: uuid.New(), Slug: "cat-cb", Name: "DM"})
	prod, err := db.NewCatalog(pool).CreateProduct(ctx, sqlc.InsertProductParams{
		ID: uuid.New(), Slug: "den-cb", Name: "Đèn", Description: "", CategoryID: cat.ID, BasePrice: 1,
		Dimensions: []byte(`{"w":1,"d":1,"h":1}`), Material: "PLA", Images: []byte(`[]`), Status: sqlc.ProductStatusDraft,
	})
	if err != nil {
		t.Fatalf("seed product: %v", err)
	}

	// A presigned model-upload finalUrl is a same-origin .glb this store owns — reuse it both as the source
	// pointer for enqueue AND as a stand-in worker OUTPUT url that passes the OwnsOutputURL host-pin.
	up := presignModel(t, srv, owner, prod.ID)
	outputURL := up.FinalUrl

	// --- ready model_ingest → 200 ready, completed_at stamped, product.model3d_url written (D3) ---
	jobID := enqueueJob(t, srv, owner, prod.ID, up.FinalUrl)
	// f-2: a ready model_ingest also records the model's object-name list — sanitized (trimmed, empties dropped).
	objNames := []string{"Chao đèn", "  Đế  ", ""}
	wantNames := []string{"Chao đèn", "Đế"}
	got := reportResult(t, srv, jobID, api.AssetJobResultInput{Status: api.AssetJobResultInputStatusReady, Model3dUrl: &outputURL, ObjectNames: &objNames})
	if got.Status != "ready" || got.CompletedAt == nil {
		t.Fatalf("ready job = %+v, want status=ready + completedAt set", got)
	}
	if p, _ := db.NewCatalog(pool).ProductByID(ctx, prod.ID); p.Model3dUrl != outputURL {
		t.Fatalf("product model3d_url = %q, want the reported glb %q (D3)", p.Model3dUrl, outputURL)
	}
	if p, _ := db.NewCatalog(pool).ProductByID(ctx, prod.ID); !slices.Equal(p.ModelObjectNames, wantNames) {
		t.Fatalf("product model_object_names = %v, want the sanitized %v (f-2)", p.ModelObjectNames, wantNames)
	}

	// --- idempotent: a redelivered ready (with a DIFFERENT url + names) is a no-op — ready is sticky ---
	second := presignModel(t, srv, owner, prod.ID).FinalUrl
	clobber := []string{"WRONG"}
	again := reportResult(t, srv, jobID, api.AssetJobResultInput{Status: api.AssetJobResultInputStatusReady, Model3dUrl: &second, ObjectNames: &clobber})
	if again.Status != "ready" {
		t.Fatalf("redelivered ready = %+v, want unchanged ready", again)
	}
	if p, _ := db.NewCatalog(pool).ProductByID(ctx, prod.ID); p.Model3dUrl != outputURL {
		t.Fatalf("sticky-ready violated: model3d_url = %q, want the FIRST glb %q", p.Model3dUrl, outputURL)
	}
	if p, _ := db.NewCatalog(pool).ProductByID(ctx, prod.ID); !slices.Equal(p.ModelObjectNames, wantNames) {
		t.Fatalf("sticky-ready violated: model_object_names = %v, want the FIRST list %v (redelivery must not clobber)", p.ModelObjectNames, wantNames)
	}

	// --- failed → last_error set, completed_at stamped, product untouched ---
	failURL := presignModel(t, srv, owner, prod.ID).FinalUrl
	failJob := enqueueJob(t, srv, owner, prod.ID, failURL)
	reason := "blender: CUDA out of memory"
	f := reportResult(t, srv, failJob, api.AssetJobResultInput{Status: api.AssetJobResultInputStatusFailed, LastError: &reason})
	if f.Status != "failed" || f.LastError == nil || *f.LastError != reason || f.CompletedAt == nil {
		t.Fatalf("failed job = %+v, want failed + lastError + completedAt", f)
	}

	// --- processing → 200, no completed_at, product untouched ---
	procJob := enqueueJob(t, srv, owner, prod.ID, presignModel(t, srv, owner, prod.ID).FinalUrl)
	pr := reportResult(t, srv, procJob, api.AssetJobResultInput{Status: api.AssetJobResultInputStatusProcessing})
	if pr.Status != "processing" || pr.CompletedAt != nil {
		t.Fatalf("processing job = %+v, want processing + null completedAt", pr)
	}

	// --- ready model_ingest with NO model3dUrl → 400, job NOT advanced ---
	noURLJob := enqueueJob(t, srv, owner, prod.ID, presignModel(t, srv, owner, prod.ID).FinalUrl)
	resp, err := srv.ReportAssetJobResult(ctx, api.ReportAssetJobResultRequestObject{Id: noURLJob, Body: &api.AssetJobResultInput{Status: api.AssetJobResultInputStatusReady}})
	if err != nil {
		t.Fatalf("missing-url call err: %v", err)
	}
	if _, ok := resp.(api.ReportAssetJobResult400JSONResponse); !ok {
		t.Fatalf("ready model_ingest without model3dUrl resp = %T, want 400", resp)
	}
	if j, _ := db.NewJobs(pool).AssetJobByID(ctx, noURLJob); j.Status != sqlc.AssetJobStatusQueued {
		t.Fatalf("missing-url job advanced to %q, want still queued (rolled back)", j.Status)
	}

	// --- foreign (not host-pinned) model3dUrl → 400, job NOT advanced ---
	foreign := "https://evil.test/steal.glb"
	fjob := enqueueJob(t, srv, owner, prod.ID, presignModel(t, srv, owner, prod.ID).FinalUrl)
	fresp, err := srv.ReportAssetJobResult(ctx, api.ReportAssetJobResultRequestObject{Id: fjob, Body: &api.AssetJobResultInput{Status: api.AssetJobResultInputStatusReady, Model3dUrl: &foreign}})
	if err != nil {
		t.Fatalf("foreign-url call err: %v", err)
	}
	if _, ok := fresp.(api.ReportAssetJobResult400JSONResponse); !ok {
		t.Fatalf("foreign model3dUrl resp = %T, want 400 (host-pin)", fresp)
	}
	if j, _ := db.NewJobs(pool).AssetJobByID(ctx, fjob); j.Status != sqlc.AssetJobStatusQueued {
		t.Fatalf("foreign-url job advanced to %q, want still queued", j.Status)
	}

	// --- ready sprite_render → 200 ready, product.sprite_sheet_url written, model3d_url UNTOUCHED (ADR-049) ---
	// A host-pinned .webp under the same assets origin (swap the presigned .glb's suffix — OwnsOutputURL
	// pins origin+base+key, not extension; the .webp suffix is checked separately).
	spriteURL := strings.TrimSuffix(up.FinalUrl, ".glb") + ".webp"
	spriteJob := enqueueJobKind(t, srv, owner, prod.ID, presignModel(t, srv, owner, prod.ID).FinalUrl, "sprite_render")
	sg := reportResult(t, srv, spriteJob, api.AssetJobResultInput{Status: api.AssetJobResultInputStatusReady, SpriteSheetUrl: &spriteURL})
	if sg.Status != "ready" || sg.CompletedAt == nil {
		t.Fatalf("ready sprite job = %+v, want ready + completedAt", sg)
	}
	if p, _ := db.NewCatalog(pool).ProductByID(ctx, prod.ID); p.SpriteSheetUrl != spriteURL {
		t.Fatalf("product sprite_sheet_url = %q, want the reported sheet %q (ADR-049)", p.SpriteSheetUrl, spriteURL)
	}
	// each pipeline writes ONLY its own column: the sprite_render must not clobber the model_ingest glb.
	if p, _ := db.NewCatalog(pool).ProductByID(ctx, prod.ID); p.Model3dUrl != outputURL {
		t.Fatalf("sprite_render clobbered model3d_url = %q, want the model_ingest glb %q", p.Model3dUrl, outputURL)
	}

	// --- ready sprite_render with NO spriteSheetUrl → 400, job NOT advanced ---
	noSpriteJob := enqueueJobKind(t, srv, owner, prod.ID, presignModel(t, srv, owner, prod.ID).FinalUrl, "sprite_render")
	sresp, err := srv.ReportAssetJobResult(ctx, api.ReportAssetJobResultRequestObject{Id: noSpriteJob, Body: &api.AssetJobResultInput{Status: api.AssetJobResultInputStatusReady}})
	if err != nil {
		t.Fatalf("missing-sprite call err: %v", err)
	}
	if _, ok := sresp.(api.ReportAssetJobResult400JSONResponse); !ok {
		t.Fatalf("ready sprite_render without spriteSheetUrl resp = %T, want 400", sresp)
	}
	if j, _ := db.NewJobs(pool).AssetJobByID(ctx, noSpriteJob); j.Status != sqlc.AssetJobStatusQueued {
		t.Fatalf("missing-sprite job advanced to %q, want still queued (rolled back)", j.Status)
	}

	// --- sprite output with the WRONG extension (.glb, not .webp) → 400, job NOT advanced ---
	weJob := enqueueJobKind(t, srv, owner, prod.ID, presignModel(t, srv, owner, prod.ID).FinalUrl, "sprite_render")
	wrongExt := up.FinalUrl // host-pinned, but a .glb — a sprite sheet must be .webp
	weResp, err := srv.ReportAssetJobResult(ctx, api.ReportAssetJobResultRequestObject{Id: weJob, Body: &api.AssetJobResultInput{Status: api.AssetJobResultInputStatusReady, SpriteSheetUrl: &wrongExt}})
	if err != nil {
		t.Fatalf("wrong-ext call err: %v", err)
	}
	if _, ok := weResp.(api.ReportAssetJobResult400JSONResponse); !ok {
		t.Fatalf("sprite_render with a .glb output resp = %T, want 400 (must be .webp)", weResp)
	}
	if j, _ := db.NewJobs(pool).AssetJobByID(ctx, weJob); j.Status != sqlc.AssetJobStatusQueued {
		t.Fatalf("wrong-ext job advanced to %q, want still queued", j.Status)
	}

	// --- unknown job id → ErrNotFound (404) ---
	if _, err := srv.ReportAssetJobResult(ctx, api.ReportAssetJobResultRequestObject{Id: uuid.New(), Body: &api.AssetJobResultInput{Status: api.AssetJobResultInputStatusProcessing}}); !errors.Is(err, db.ErrNotFound) {
		t.Fatalf("unknown job: err = %v, want ErrNotFound (404)", err)
	}
}

// presignModel returns a fresh host-pinned model-upload form (its finalUrl is a same-origin .glb).
func presignModel(t *testing.T, srv *Server, owner context.Context, pid uuid.UUID) api.ModelUpload {
	t.Helper()
	resp, err := srv.CreateProductModelUpload(owner, api.CreateProductModelUploadRequestObject{Id: pid, Body: &api.ModelUploadInput{ContentType: "model/gltf-binary"}})
	if err != nil {
		t.Fatalf("presign model: %v", err)
	}
	return api.ModelUpload(resp.(api.CreateProductModelUpload200JSONResponse))
}

// enqueueJob creates a queued model_ingest job from a host-pinned source url and returns its id.
func enqueueJob(t *testing.T, srv *Server, owner context.Context, pid uuid.UUID, sourceURL string) uuid.UUID {
	return enqueueJobKind(t, srv, owner, pid, sourceURL, "model_ingest")
}

// enqueueJobKind is enqueueJob parametrized by kind (model_ingest / sprite_render) — both take the same
// host-pinned raw-model sourceUrl (ADR-049: a sprite_render renders from the uploaded model, not the glb).
func enqueueJobKind(t *testing.T, srv *Server, owner context.Context, pid uuid.UUID, sourceURL, jobType string) uuid.UUID {
	t.Helper()
	resp, err := srv.CreateProductAssetJob(owner, api.CreateProductAssetJobRequestObject{Id: pid, Body: &api.AssetJobInput{
		JobType: api.AssetJobType(jobType), SourceModelUrl: sourceURL, SourceVersion: "cafebabecafebabe",
	}})
	if err != nil {
		t.Fatalf("enqueue %s job: %v", jobType, err)
	}
	return uuid.UUID(resp.(api.CreateProductAssetJob201JSONResponse).Id)
}

// reportResult calls the worker callback and asserts a 200, returning the updated job.
func reportResult(t *testing.T, srv *Server, id uuid.UUID, body api.AssetJobResultInput) api.AssetJob {
	t.Helper()
	resp, err := srv.ReportAssetJobResult(context.Background(), api.ReportAssetJobResultRequestObject{Id: id, Body: &body})
	if err != nil {
		t.Fatalf("report result: %v", err)
	}
	ok, is := resp.(api.ReportAssetJobResult200JSONResponse)
	if !is {
		t.Fatalf("report result resp = %T, want 200", resp)
	}
	return api.AssetJob(ok)
}
