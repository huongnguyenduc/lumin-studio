-- jobs.sql — fulfillment/asset job queries (PR-2f). architecture.md §3D-pipeline · spec.md §02.
--
-- CreateAssetJob is orchestrated by internal/db/jobs.go CreateAssetJobTx, which ALSO enqueues the
-- `asset_job.created` outbox event on the SAME tx (publish-on-commit, ADR-006). print_jobs has no
-- emit-seam — the print queue is admin-internal (SSE wiring lands in slice 3). UpdateAssetJobStatus
-- is the slice-3 worker-callback write; it is defined now so the lifecycle column set is exercised.

-- name: CreateAssetJob :one
INSERT INTO asset_jobs (
  id, product_id, job_type, source_model_url, source_version, status
) VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: GetAssetJobByID :one
SELECT * FROM asset_jobs WHERE id = $1;

-- name: ListAssetJobsByStatus :many
SELECT * FROM asset_jobs WHERE status = $1 ORDER BY created_at;

-- UpdateAssetJobStatus records a worker lifecycle transition (slice-3 callback): the new status,
-- the attempt count, last_error (set on 'failed', NULL clears it on 'ready'), and completed_at when
-- supplied (COALESCE keeps the prior value when the narg is NULL).
-- name: UpdateAssetJobStatus :one
UPDATE asset_jobs
SET status = sqlc.arg('status'),
    attempts = sqlc.arg('attempts'),
    last_error = sqlc.narg('last_error'),
    completed_at = COALESCE(sqlc.narg('completed_at'), completed_at),
    updated_at = now()
WHERE id = sqlc.arg('id')
RETURNING *;

-- name: InsertPrintJob :one
INSERT INTO print_jobs (
  id, order_item_id, stage, printer, color_name, eta
) VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: GetPrintJobByID :one
SELECT * FROM print_jobs WHERE id = $1;

-- name: ListPrintJobsByStage :many
SELECT * FROM print_jobs WHERE stage = $1 ORDER BY created_at;

-- UpdatePrintJobStage advances the print queue stage (staff drag-drop) and refreshes updated_at.
-- name: UpdatePrintJobStage :one
UPDATE print_jobs
SET stage = sqlc.arg('stage'),
    updated_at = now()
WHERE id = sqlc.arg('id')
RETURNING *;
