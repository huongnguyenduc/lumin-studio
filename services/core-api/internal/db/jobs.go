package db

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
)

// Jobs is the read/write repository for the fulfillment axis (asset_jobs, print_jobs). The
// asset-render WRITE that must span the job row + an outbox event goes through the transactional
// seam CreateAssetJobTx (it takes a pgx.Tx so publish-on-commit is structural, ADR-006). print_jobs
// has NO event — the print queue is admin-internal (SSE in slice 3, never NATS) — so its writes are
// plain repo methods. Construct over the *pgxpool.Pool for autocommit reads/writes, or over a
// pgx.Tx to enlist in a transaction.
type Jobs struct {
	q *sqlc.Queries
}

// NewJobs builds a Jobs over any sqlc.DBTX (the pool or a pgx.Tx).
func NewJobs(db sqlc.DBTX) *Jobs {
	return &Jobs{q: sqlc.New(db)}
}

// AssetJobByID returns the asset job, or ErrNotFound.
func (j *Jobs) AssetJobByID(ctx context.Context, id uuid.UUID) (sqlc.AssetJob, error) {
	row, err := j.q.GetAssetJobByID(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return sqlc.AssetJob{}, ErrNotFound
	}
	return row, err
}

// AssetJobByIDForUpdate reads the job under a FOR UPDATE row lock, or ErrNotFound. Construct Jobs over a
// pgx.Tx (NewJobs(tx)) so the lock is held for the render-callback tx: the handler reads → decides
// idempotency (a `ready` job is terminal, left untouched) → writes status + model3d_url, and the lock
// serializes overlapping at-least-once redeliveries so two callbacks can't race a lost update.
func (j *Jobs) AssetJobByIDForUpdate(ctx context.Context, id uuid.UUID) (sqlc.AssetJob, error) {
	row, err := j.q.GetAssetJobByIDForUpdate(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return sqlc.AssetJob{}, ErrNotFound
	}
	return row, err
}

// AssetJobsByStatus lists asset jobs in a status, oldest first (the worker/relay drain order).
func (j *Jobs) AssetJobsByStatus(ctx context.Context, status sqlc.AssetJobStatus) ([]sqlc.AssetJob, error) {
	return j.q.ListAssetJobsByStatus(ctx, status)
}

// AssetJobsByProduct lists every render/ingest job for one product, newest first (the admin editor's
// render-status panel, P3-j-b). An empty slice (product exists but has no jobs) is a valid result.
func (j *Jobs) AssetJobsByProduct(ctx context.Context, productID uuid.UUID) ([]sqlc.AssetJob, error) {
	return j.q.ListAssetJobsByProduct(ctx, productID)
}

// MarkAssetJob records a worker lifecycle transition (the slice-3 callback): the new status,
// attempt count, last_error (nil clears it) and completed_at (nil keeps the prior value). Returns
// ErrNotFound for an unknown job.
func (j *Jobs) MarkAssetJob(ctx context.Context, arg sqlc.UpdateAssetJobStatusParams) (sqlc.AssetJob, error) {
	row, err := j.q.UpdateAssetJobStatus(ctx, arg)
	if errors.Is(err, pgx.ErrNoRows) {
		return sqlc.AssetJob{}, ErrNotFound
	}
	return row, err
}

// FailStuckProcessing is the reconcile sweep (ops): it flips every asset job still 'processing' whose
// updated_at is older than `before` to 'failed' with last_error 'reconcile: stuck in processing', and
// returns how many were swept. A job can only sit there past the cutoff if the worker died or the
// final-attempt callback was lost — Admin would otherwise show it forever-running.
func (j *Jobs) FailStuckProcessing(ctx context.Context, before time.Time) (int64, error) {
	return j.q.FailStuckAssetJobs(ctx, pgtype.Timestamptz{Time: before, Valid: true})
}

// PrintJobByID returns the print job, or ErrNotFound.
func (j *Jobs) PrintJobByID(ctx context.Context, id uuid.UUID) (sqlc.PrintJob, error) {
	row, err := j.q.GetPrintJobByID(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return sqlc.PrintJob{}, ErrNotFound
	}
	return row, err
}

// PrintJobsByStage lists the print queue for one stage, oldest first (FIFO board column).
func (j *Jobs) PrintJobsByStage(ctx context.Context, stage sqlc.PrintStage) ([]sqlc.PrintJob, error) {
	return j.q.ListPrintJobsByStage(ctx, stage)
}

// CreatePrintJob inserts a print-queue row and returns it. No outbox event — the print queue is
// admin-internal (the slice-3 SSE stream pushes progress to the browser; NATS is not involved).
func (j *Jobs) CreatePrintJob(ctx context.Context, arg sqlc.InsertPrintJobParams) (sqlc.PrintJob, error) {
	return j.q.InsertPrintJob(ctx, arg)
}

// AdvancePrintStage moves a print job to a new queue stage (staff drag-drop) and returns the row,
// or ErrNotFound. The print queue's stages are intentionally finer-grained than order status (D6),
// so there is no order-state guard here — staff drive the board directly.
func (j *Jobs) AdvancePrintStage(ctx context.Context, id uuid.UUID, stage sqlc.PrintStage) (sqlc.PrintJob, error) {
	row, err := j.q.UpdatePrintJobStage(ctx, sqlc.UpdatePrintJobStageParams{ID: id, Stage: stage})
	if errors.Is(err, pgx.ErrNoRows) {
		return sqlc.PrintJob{}, ErrNotFound
	}
	return row, err
}

// ClaimPrintForPrinting is the atomic deduct-on-print claim (ADR-039 pt 4): it moves a job to PRINTING and
// returns claimedNow — TRUE when THIS call won the FIRST →PRINTING (the caller MUST draw filament), FALSE when
// the job was already deducted (a re-drag or a concurrent second mover — the caller must NOT re-draw). It runs
// the conditional claim UPDATE (stage→PRINTING + stamp filament_deducted_at WHERE it is NULL); a 0-row result
// is disambiguated by reading the row back — gone → ErrNotFound, else already-deducted (its stage is nudged to
// PRINTING so a PACKING→PRINTING re-drag still lands, WITHOUT re-drawing). Enlist j over the pgx.Tx so the
// claim, the draw and the ledger row commit as one unit.
func (j *Jobs) ClaimPrintForPrinting(ctx context.Context, id uuid.UUID) (sqlc.PrintJob, bool, error) {
	row, err := j.q.ClaimPrintForPrinting(ctx, id)
	if err == nil {
		return row, true, nil // won the claim → the caller draws filament
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return sqlc.PrintJob{}, false, err
	}
	// 0 rows: the job is gone OR already deducted (filament_deducted_at not NULL). Read it back to tell apart.
	existing, err := j.q.GetPrintJobByID(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return sqlc.PrintJob{}, false, ErrNotFound
	}
	if err != nil {
		return sqlc.PrintJob{}, false, err
	}
	if existing.Stage != sqlc.PrintStagePRINTING {
		// Already deducted but sitting in another stage (PACKING→PRINTING re-drag): land the stage move
		// without re-drawing filament.
		existing, err = j.q.UpdatePrintJobStage(ctx, sqlc.UpdatePrintJobStageParams{ID: id, Stage: sqlc.PrintStagePRINTING})
		if err != nil {
			return sqlc.PrintJob{}, false, err
		}
	}
	return existing, false, nil
}

// PrintQueue is the admin kanban read (P3-f): every print job across all stages, joined to the order
// code + product name + quantity so a card says what to make for which order. Ordered stage then
// created_at (FIFO per column); the caller groups by stage into the board columns.
func (j *Jobs) PrintQueue(ctx context.Context) ([]sqlc.ListPrintQueueRow, error) {
	return j.q.ListPrintQueue(ctx)
}

// PrintQueueEntry returns one enriched print-queue card by id (the stage-PATCH response, same shape as
// PrintQueue), or ErrNotFound.
func (j *Jobs) PrintQueueEntry(ctx context.Context, id uuid.UUID) (sqlc.GetPrintQueueEntryRow, error) {
	row, err := j.q.GetPrintQueueEntry(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return sqlc.GetPrintQueueEntryRow{}, ErrNotFound
	}
	return row, err
}

// ErrInvalidAssetJob is returned for a structurally invalid CreateAssetJobInput, before any write.
var ErrInvalidAssetJob = errors.New("asset job: invalid input")

// eventAssetJobCreated is the canonical dotted NATS subject / outbox event_type for an asset job's
// creation. Bound in one place so the outbox EventType and the dedup_key's 3rd segment cannot drift.
const eventAssetJobCreated = "asset_job.created"

// assetJobCreatedPayload is the `asset_job.created` outbox body. It carries the SOURCE pointer
// (url + content-hash version) and the job kind, so the worker can fetch and reconstruct the asset
// from the source object without a DB lookup (ADR-006 reconstructability) — int/strings only, never
// a blob. The relay (slice 3) forwards this verbatim to NATS.
//
// PartColors (f-5, amends ADR-049) is the DENORMALIZED {objectName → "#RRGGBB"} snapshot the
// sprite_render worker paints each named part with — frozen at enqueue so a redelivered/old job renders
// the SAME colours it was created with, never a fresh read of live catalog (idempotency; oracle D-E). It
// is `omitempty`, so a model_ingest job (and a sprite with no mapped part-colours) emits the exact same
// bytes as before — the wire contract only grows for a sprite that actually has per-part colours.
type assetJobCreatedPayload struct {
	AssetJobID     uuid.UUID         `json:"assetJobId"`
	ProductID      uuid.UUID         `json:"productId"`
	JobType        sqlc.AssetJobType `json:"jobType"`
	SourceModelURL string            `json:"sourceModelUrl"`
	SourceVersion  string            `json:"sourceVersion"`
	PartColors     map[string]string `json:"partColors,omitempty"`
}

// CreateAssetJobInput is the server-authoritative input to enqueue a render/ingest job. SourceModelURL
// is the Garage object the worker reconstructs from; SourceVersion is its content hash (ADR-004 — Garage
// has no versioning). JobType picks the pipeline (model_ingest vs sprite_render).
type CreateAssetJobInput struct {
	ID             uuid.UUID
	ProductID      uuid.UUID
	JobType        sqlc.AssetJobType
	SourceModelURL string
	SourceVersion  string
	// PartColors is the {objectName → "#RRGGBB"} snapshot for a sprite_render job (f-5); nil/empty for
	// model_ingest and for a sprite whose parts have no colours yet. The caller (the HTTP handler) builds
	// and hex-validates it from the product's current parts+colours before the tx.
	PartColors map[string]string
}

// CreateAssetJobTx inserts an asset_jobs row (status 'queued') AND enqueues an `asset_job.created`
// outbox event — both WITHIN tx, so the job and its event commit (or roll back) as ONE unit
// (publish-on-commit, ADR-006). The relay (slice 3) drains the pending row onto NATS; the worker
// (ADR-007: Cycles+CUDA, concurrency=1, subprocess+retry) consumes it idempotently. Caller owns the
// commit. dedup_key = asset_job:<id>:asset_job.created (the aggregate_type:aggregate_id:event_type
// convention, plan §4) — each (re-)render is its own row/id, so it is naturally unique; a same-id
// re-create is rejected by the asset_jobs PRIMARY KEY, and the outbox dedup_key UNIQUE is the backstop
// against a same-key double-insert.
func CreateAssetJobTx(ctx context.Context, tx pgx.Tx, in CreateAssetJobInput) (sqlc.AssetJob, error) {
	if err := in.validate(); err != nil {
		return sqlc.AssetJob{}, err
	}
	q := sqlc.New(tx)

	row, err := q.CreateAssetJob(ctx, sqlc.CreateAssetJobParams{
		ID:             in.ID,
		ProductID:      in.ProductID,
		JobType:        in.JobType,
		SourceModelUrl: in.SourceModelURL,
		SourceVersion:  in.SourceVersion,
		Status:         sqlc.AssetJobStatusQueued,
	})
	if err != nil {
		return sqlc.AssetJob{}, fmt.Errorf("asset job: create %s: %w", in.ID, err)
	}

	payload, err := json.Marshal(assetJobCreatedPayload{
		AssetJobID:     row.ID,
		ProductID:      row.ProductID,
		JobType:        row.JobType,
		SourceModelURL: row.SourceModelUrl,
		SourceVersion:  row.SourceVersion,
		PartColors:     in.PartColors, // omitempty → absent for model_ingest / an uncoloured sprite
	})
	if err != nil {
		return sqlc.AssetJob{}, fmt.Errorf("asset job: marshal created payload: %w", err)
	}
	if err := EnqueueOutbox(ctx, tx, OutboxEvent{
		ID:            uuid.New(),
		AggregateType: "asset_job",
		AggregateID:   row.ID,
		EventType:     eventAssetJobCreated,
		Payload:       payload,
		DedupKey:      assetJobDedupKey(row.ID),
	}); err != nil {
		return sqlc.AssetJob{}, err
	}
	return row, nil
}

// validate rejects a malformed input before any round-trip. The DB enum/NOT NULL constraints are
// the backstop; catching empties here gives a clearer error and avoids a doomed insert.
func (in CreateAssetJobInput) validate() error {
	switch {
	case in.ID == uuid.Nil:
		return fmt.Errorf("%w: id required", ErrInvalidAssetJob)
	case in.ProductID == uuid.Nil:
		return fmt.Errorf("%w: productId required", ErrInvalidAssetJob)
	case in.JobType == "":
		return fmt.Errorf("%w: jobType required", ErrInvalidAssetJob)
	case in.SourceModelURL == "":
		return fmt.Errorf("%w: sourceModelUrl required", ErrInvalidAssetJob)
	case in.SourceVersion == "":
		return fmt.Errorf("%w: sourceVersion required", ErrInvalidAssetJob)
	}
	return nil
}

// assetJobDedupKey builds the idempotency key for the singleton creation event of one asset job,
// following the aggregate_type:aggregate_id:event_type convention (plan §4, the same grammar as the
// orders seam's dedupKey). The UNIQUE(dedup_key) index rejects a buggy double-insert of the same
// creation event; a same-id re-create is already stopped earlier by the asset_jobs PRIMARY KEY.
func assetJobDedupKey(jobID uuid.UUID) string {
	return fmt.Sprintf("asset_job:%s:%s", jobID, eventAssetJobCreated)
}
