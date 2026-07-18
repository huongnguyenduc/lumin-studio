package db

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
)

// --- pure unit (no Docker) -------------------------------------------------------------

func sampleAssetJobInput() CreateAssetJobInput {
	return CreateAssetJobInput{
		ID:             uuid.New(),
		ProductID:      uuid.New(),
		JobType:        sqlc.AssetJobTypeModelIngest,
		SourceModelURL: "https://garage.lumin.vn/models/abc.glb",
		SourceVersion:  "sha256-deadbeef",
	}
}

func TestCreateAssetJobValidate(t *testing.T) {
	if err := sampleAssetJobInput().validate(); err != nil {
		t.Fatalf("valid input rejected: %v", err)
	}
	bad := map[string]func(CreateAssetJobInput) CreateAssetJobInput{
		"missing id":             func(i CreateAssetJobInput) CreateAssetJobInput { i.ID = uuid.Nil; return i },
		"missing productId":      func(i CreateAssetJobInput) CreateAssetJobInput { i.ProductID = uuid.Nil; return i },
		"missing jobType":        func(i CreateAssetJobInput) CreateAssetJobInput { i.JobType = ""; return i },
		"missing sourceModelUrl": func(i CreateAssetJobInput) CreateAssetJobInput { i.SourceModelURL = ""; return i },
		"missing sourceVersion":  func(i CreateAssetJobInput) CreateAssetJobInput { i.SourceVersion = ""; return i },
	}
	for name, mutate := range bad {
		t.Run(name, func(t *testing.T) {
			if err := mutate(sampleAssetJobInput()).validate(); !errors.Is(err, ErrInvalidAssetJob) {
				t.Fatalf("validate(%s) err = %v, want ErrInvalidAssetJob", name, err)
			}
		})
	}
}

// --- integration (testcontainers; skips without a Docker provider) ---------------------

func firstOrderItemID(t *testing.T, ctx context.Context, pool *pgxpool.Pool, orderID uuid.UUID) uuid.UUID {
	t.Helper()
	items, err := NewOrders(pool).Items(ctx, orderID)
	if err != nil || len(items) == 0 {
		t.Fatalf("order items = %d (err %v), want >=1", len(items), err)
	}
	return items[0].ID
}

func TestCreateAssetJobEmitsCreated(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()
	prod := seedProduct(t, ctx, NewCatalog(pool), "den-asset", 200000)

	jobID := uuid.New()
	tx := mustBegin(t, ctx, pool)
	row, err := CreateAssetJobTx(ctx, tx, CreateAssetJobInput{
		ID: jobID, ProductID: prod.ID, JobType: sqlc.AssetJobTypeModelIngest,
		SourceModelURL: "https://garage.lumin.vn/models/den.glb", SourceVersion: "sha256-1",
	})
	if err != nil {
		t.Fatalf("create asset job: %v", err)
	}
	if row.Status != sqlc.AssetJobStatusQueued {
		t.Fatalf("status = %s, want queued", row.Status)
	}
	if row.JobType != sqlc.AssetJobTypeModelIngest {
		t.Fatalf("job_type = %s, want model_ingest", row.JobType)
	}
	if row.SourceModelUrl != "https://garage.lumin.vn/models/den.glb" || row.SourceVersion != "sha256-1" {
		t.Fatalf("source round-trip wrong: %q / %q", row.SourceModelUrl, row.SourceVersion)
	}
	if row.Attempts != 0 || row.LastError != nil || row.CompletedAt.Valid {
		t.Fatalf("fresh job should be attempts=0/no error/not completed: %+v", row)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("commit: %v", err)
	}

	// asset_job.created emitted on the SAME tx (publish-on-commit) — exactly one row.
	if n := countRows(t, ctx, pool, `SELECT count(*) FROM outbox WHERE aggregate_id=$1 AND event_type='asset_job.created'`, jobID); n != 1 {
		t.Fatalf("asset_job.created rows = %d, want 1", n)
	}

	// The payload carries the SOURCE pointer so the worker reconstructs without a DB lookup (ADR-006).
	var raw []byte
	if err := pool.QueryRow(ctx, `SELECT payload FROM outbox WHERE aggregate_id=$1 AND event_type='asset_job.created'`, jobID).Scan(&raw); err != nil {
		t.Fatalf("read payload: %v", err)
	}
	var p assetJobCreatedPayload
	if err := json.Unmarshal(raw, &p); err != nil {
		t.Fatalf("unmarshal payload: %v", err)
	}
	if p.AssetJobID != jobID || p.ProductID != prod.ID || p.JobType != sqlc.AssetJobTypeModelIngest ||
		p.SourceModelURL != "https://garage.lumin.vn/models/den.glb" || p.SourceVersion != "sha256-1" {
		t.Fatalf("payload missing a reconstruction pointer: %+v", p)
	}

	// Read-back through the repo.
	back, err := NewJobs(pool).AssetJobByID(ctx, jobID)
	if err != nil || back.ID != jobID {
		t.Fatalf("AssetJobByID = %+v (err %v)", back, err)
	}
}

func TestCreateAssetJobRollbackIsAtomic(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()
	prod := seedProduct(t, ctx, NewCatalog(pool), "den-rollback", 100000)

	jobID := uuid.New()
	tx := mustBegin(t, ctx, pool)
	if _, err := CreateAssetJobTx(ctx, tx, CreateAssetJobInput{
		ID: jobID, ProductID: prod.ID, JobType: sqlc.AssetJobTypeSpriteRender,
		SourceModelURL: "https://garage.lumin.vn/models/x.glb", SourceVersion: "v1",
	}); err != nil {
		t.Fatalf("create: %v", err)
	}
	if err := tx.Rollback(ctx); err != nil {
		t.Fatalf("rollback: %v", err)
	}
	// Job row AND the outbox event vanish together (one commit unit).
	if n := countRows(t, ctx, pool, `SELECT count(*) FROM asset_jobs WHERE id=$1`, jobID); n != 0 {
		t.Fatalf("asset_jobs after rollback = %d, want 0", n)
	}
	if n := countRows(t, ctx, pool, `SELECT count(*) FROM outbox WHERE aggregate_id=$1`, jobID); n != 0 {
		t.Fatalf("outbox after rollback = %d, want 0", n)
	}
}

func TestCreateAssetJobRejectsDuplicateID(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()
	prod := seedProduct(t, ctx, NewCatalog(pool), "den-dup", 100000)

	in := CreateAssetJobInput{
		ID: uuid.New(), ProductID: prod.ID, JobType: sqlc.AssetJobTypeModelIngest,
		SourceModelURL: "https://garage.lumin.vn/models/d.glb", SourceVersion: "v1",
	}
	tx1 := mustBegin(t, ctx, pool)
	if _, err := CreateAssetJobTx(ctx, tx1, in); err != nil {
		t.Fatalf("first create: %v", err)
	}
	if err := tx1.Commit(ctx); err != nil {
		t.Fatalf("commit: %v", err)
	}

	// Re-creating the SAME job id is rejected by the asset_jobs PRIMARY KEY (before the outbox insert
	// is even reached). The dedup_key UNIQUE — a same-KEY double-insert with a DIFFERENT row id — is
	// covered generically by outbox_test.go's "duplicate dedup_key rejected" subtest.
	tx2 := mustBegin(t, ctx, pool)
	_, err := CreateAssetJobTx(ctx, tx2, in)
	_ = tx2.Rollback(ctx)
	if err == nil {
		t.Fatal("duplicate asset job id must be rejected")
	}
	// Exactly one job row and one event survive — no partial double-write.
	if n := countRows(t, ctx, pool, `SELECT count(*) FROM asset_jobs WHERE id=$1`, in.ID); n != 1 {
		t.Fatalf("asset_jobs = %d, want 1", n)
	}
	if n := countRows(t, ctx, pool, `SELECT count(*) FROM outbox WHERE aggregate_id=$1`, in.ID); n != 1 {
		t.Fatalf("outbox = %d, want 1", n)
	}
}

func TestAssetJobBothTypesQueued(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()
	prod := seedProduct(t, ctx, NewCatalog(pool), "den-twokinds", 150000)

	for _, jt := range []sqlc.AssetJobType{sqlc.AssetJobTypeModelIngest, sqlc.AssetJobTypeSpriteRender} {
		tx := mustBegin(t, ctx, pool)
		if _, err := CreateAssetJobTx(ctx, tx, CreateAssetJobInput{
			ID: uuid.New(), ProductID: prod.ID, JobType: jt,
			SourceModelURL: "https://garage.lumin.vn/models/d.glb", SourceVersion: "v1",
		}); err != nil {
			t.Fatalf("create %s: %v", jt, err)
		}
		if err := tx.Commit(ctx); err != nil {
			t.Fatalf("commit %s: %v", jt, err)
		}
	}

	queued, err := NewJobs(pool).AssetJobsByStatus(ctx, sqlc.AssetJobStatusQueued)
	if err != nil {
		t.Fatalf("list queued: %v", err)
	}
	var ingest, sprite int
	for _, j := range queued {
		switch j.JobType {
		case sqlc.AssetJobTypeModelIngest:
			ingest++
		case sqlc.AssetJobTypeSpriteRender:
			sprite++
		}
	}
	if ingest != 1 || sprite != 1 {
		t.Fatalf("queued kinds = ingest %d / sprite %d, want 1/1", ingest, sprite)
	}
}

func TestAssetJobByIDNotFound(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()
	if _, err := NewJobs(pool).AssetJobByID(ctx, uuid.New()); !errors.Is(err, ErrNotFound) {
		t.Fatalf("err = %v, want ErrNotFound", err)
	}
}

func TestMarkAssetJobLifecycle(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()
	prod := seedProduct(t, ctx, NewCatalog(pool), "den-lifecycle", 100000)

	jobID := uuid.New()
	tx := mustBegin(t, ctx, pool)
	if _, err := CreateAssetJobTx(ctx, tx, CreateAssetJobInput{
		ID: jobID, ProductID: prod.ID, JobType: sqlc.AssetJobTypeModelIngest,
		SourceModelURL: "https://garage.lumin.vn/models/l.glb", SourceVersion: "v1",
	}); err != nil {
		t.Fatalf("create: %v", err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("commit: %v", err)
	}

	jobs := NewJobs(pool)

	// queued → processing (first attempt; no completed_at, no error yet).
	if _, err := jobs.MarkAssetJob(ctx, sqlc.UpdateAssetJobStatusParams{
		ID: jobID, Status: sqlc.AssetJobStatusProcessing, Attempts: 1,
	}); err != nil {
		t.Fatalf("→processing: %v", err)
	}

	// processing → failed: last_error is SET and completed_at is stamped (a render that OOM'd).
	failedAt := pgtype.Timestamptz{Time: time.Date(2026, 6, 26, 12, 0, 0, 0, time.UTC), Valid: true}
	oom := "render failed: out of VRAM"
	failed, err := jobs.MarkAssetJob(ctx, sqlc.UpdateAssetJobStatusParams{
		ID: jobID, Status: sqlc.AssetJobStatusFailed, Attempts: 1, LastError: &oom, CompletedAt: failedAt,
	})
	if err != nil {
		t.Fatalf("→failed: %v", err)
	}
	if failed.Status != sqlc.AssetJobStatusFailed || failed.Attempts != 1 ||
		failed.LastError == nil || *failed.LastError != oom || !failed.CompletedAt.Valid {
		t.Fatalf("after failed: %+v, want failed/attempts=1/last_error set/completed stamped", failed)
	}

	// failed → ready (a retry succeeded): last_error CLEARS — UpdateAssetJobStatus sets it
	// UNCONDITIONALLY (not COALESCE), so a nil arg overwrites the column to NULL — while completed_at,
	// left UNSET here, KEEPS its prior value (that column IS COALESCE'd). Both branches asserted.
	ready, err := jobs.MarkAssetJob(ctx, sqlc.UpdateAssetJobStatusParams{
		ID: jobID, Status: sqlc.AssetJobStatusReady, Attempts: 2, LastError: nil,
	})
	if err != nil {
		t.Fatalf("→ready: %v", err)
	}
	if ready.Status != sqlc.AssetJobStatusReady || ready.Attempts != 2 {
		t.Fatalf("after ready: status=%s attempts=%d, want ready/2", ready.Status, ready.Attempts)
	}
	if ready.LastError != nil {
		t.Fatalf("ready must CLEAR last_error, got %q", *ready.LastError)
	}
	if !ready.CompletedAt.Valid || !ready.CompletedAt.Time.Equal(failedAt.Time) {
		t.Fatalf("unset completed_at must keep the prior value (COALESCE), got %+v want %v", ready.CompletedAt, failedAt.Time)
	}

	if _, err := jobs.MarkAssetJob(ctx, sqlc.UpdateAssetJobStatusParams{ID: uuid.New(), Status: sqlc.AssetJobStatusFailed}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("mark unknown = %v, want ErrNotFound", err)
	}
}

func TestPrintJobQueueRoundTrip(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()
	customerID, productID, _ := seedOrderDeps(t, ctx, pool)
	o := createCommittedWebOrder(t, ctx, pool, customerID, productID)
	itemID := firstOrderItemID(t, ctx, pool, o.ID)

	jobs := NewJobs(pool)
	printer := "Bambu-A1-01"
	colorName := "Kem sữa"
	eta := pgtype.Timestamptz{Time: time.Date(2026, 6, 28, 9, 0, 0, 0, time.UTC), Valid: true}
	pj, err := jobs.CreatePrintJob(ctx, sqlc.InsertPrintJobParams{
		ID: uuid.New(), OrderItemID: itemID, Stage: sqlc.PrintStageNEEDPRINT,
		Printer: &printer, ColorName: &colorName, Eta: eta,
	})
	if err != nil {
		t.Fatalf("create print job: %v", err)
	}

	back, err := jobs.PrintJobByID(ctx, pj.ID)
	if err != nil {
		t.Fatalf("get print job: %v", err)
	}
	if back.Stage != sqlc.PrintStageNEEDPRINT || back.Printer == nil || *back.Printer != printer ||
		back.ColorName == nil || *back.ColorName != colorName || !back.Eta.Valid {
		t.Fatalf("print job round-trip wrong: %+v", back)
	}

	need, _ := jobs.PrintJobsByStage(ctx, sqlc.PrintStageNEEDPRINT)
	if !containsPrintJob(need, pj.ID) {
		t.Fatal("NEED_PRINT queue should contain the new job")
	}

	// Staff drag-drop NEED_PRINT → PRINTING (the stage is staff-driven, finer than order status).
	if _, err := jobs.AdvancePrintStage(ctx, pj.ID, sqlc.PrintStagePRINTING); err != nil {
		t.Fatalf("advance stage: %v", err)
	}
	if need, _ := jobs.PrintJobsByStage(ctx, sqlc.PrintStageNEEDPRINT); containsPrintJob(need, pj.ID) {
		t.Fatal("job should have left the NEED_PRINT queue")
	}
	if printing, _ := jobs.PrintJobsByStage(ctx, sqlc.PrintStagePRINTING); !containsPrintJob(printing, pj.ID) {
		t.Fatal("job should be in the PRINTING queue")
	}
	if _, err := jobs.AdvancePrintStage(ctx, uuid.New(), sqlc.PrintStagePACKING); !errors.Is(err, ErrNotFound) {
		t.Fatalf("advance unknown = %v, want ErrNotFound", err)
	}
}

func containsPrintJob(jobs []sqlc.PrintJob, id uuid.UUID) bool {
	for _, j := range jobs {
		if j.ID == id {
			return true
		}
	}
	return false
}

// A print job dies with its order item: deleting the order cascades order_items → print_jobs.
func TestPrintJobCascadesWithOrderItem(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()
	customerID, productID, _ := seedOrderDeps(t, ctx, pool)
	o := createCommittedWebOrder(t, ctx, pool, customerID, productID)
	itemID := firstOrderItemID(t, ctx, pool, o.ID)

	pj, err := NewJobs(pool).CreatePrintJob(ctx, sqlc.InsertPrintJobParams{
		ID: uuid.New(), OrderItemID: itemID, Stage: sqlc.PrintStageNEEDPRINT,
	})
	if err != nil {
		t.Fatalf("create print job: %v", err)
	}

	if _, err := pool.Exec(ctx, `DELETE FROM orders WHERE id=$1`, o.ID); err != nil {
		t.Fatalf("delete order: %v", err)
	}
	if _, err := NewJobs(pool).PrintJobByID(ctx, pj.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("print job after order delete = %v, want ErrNotFound (ON DELETE CASCADE)", err)
	}
}

// FailStuckProcessing (the reconcile sweep) must fail ONLY jobs that are BOTH in 'processing' AND past
// the cutoff — a fresh processing job (worker alive, heartbeating callbacks) and an old queued job (the
// relay/worker will still pick it up) are untouched.
func TestFailStuckProcessingSweepsOnlyOldProcessing(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()
	prod := seedProduct(t, ctx, NewCatalog(pool), "den-stuck", 100000)
	jobs := NewJobs(pool)

	mk := func(status sqlc.AssetJobStatus, age time.Duration) uuid.UUID {
		id := uuid.New()
		tx := mustBegin(t, ctx, pool)
		if _, err := CreateAssetJobTx(ctx, tx, CreateAssetJobInput{
			ID: id, ProductID: prod.ID, JobType: sqlc.AssetJobTypeModelIngest,
			SourceModelURL: "https://garage.lumin.vn/models/s.glb", SourceVersion: "v-" + id.String(),
		}); err != nil {
			t.Fatalf("create: %v", err)
		}
		if err := tx.Commit(ctx); err != nil {
			t.Fatalf("commit: %v", err)
		}
		if status != sqlc.AssetJobStatusQueued {
			if _, err := jobs.MarkAssetJob(ctx, sqlc.UpdateAssetJobStatusParams{ID: id, Status: status, Attempts: 1}); err != nil {
				t.Fatalf("mark %s: %v", status, err)
			}
		}
		// Backdate the liveness column directly — the repo API always stamps now().
		if _, err := pool.Exec(ctx, "UPDATE asset_jobs SET updated_at = now() - $2::interval WHERE id = $1", id, age.String()); err != nil {
			t.Fatalf("backdate: %v", err)
		}
		return id
	}

	stuck := mk(sqlc.AssetJobStatusProcessing, 3*time.Hour) // dead worker → must be swept
	fresh := mk(sqlc.AssetJobStatusProcessing, time.Minute) // honest in-flight → untouched
	queued := mk(sqlc.AssetJobStatusQueued, 3*time.Hour)    // old but not processing → untouched

	swept, err := jobs.FailStuckProcessing(ctx, time.Now().UTC().Add(-2*time.Hour))
	if err != nil {
		t.Fatalf("sweep: %v", err)
	}
	if swept != 1 {
		t.Fatalf("swept = %d, want 1", swept)
	}
	got, err := jobs.AssetJobByID(ctx, stuck)
	if err != nil {
		t.Fatalf("read stuck: %v", err)
	}
	if got.Status != sqlc.AssetJobStatusFailed || got.LastError == nil ||
		*got.LastError != "reconcile: stuck in processing" || !got.CompletedAt.Valid {
		t.Fatalf("stuck after sweep = %+v, want failed + reconcile last_error + completed stamped", got)
	}
	for name, id := range map[string]uuid.UUID{"fresh": fresh, "queued": queued} {
		j, err := jobs.AssetJobByID(ctx, id)
		if err != nil {
			t.Fatalf("read %s: %v", name, err)
		}
		if j.Status == sqlc.AssetJobStatusFailed {
			t.Fatalf("%s job must survive the sweep, got failed", name)
		}
	}
}
