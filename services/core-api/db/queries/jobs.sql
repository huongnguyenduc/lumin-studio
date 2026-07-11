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

-- ListAssetJobsByProduct powers the admin product editor's render-status panel (P3-j-b GET
-- /admin/products/{id}/asset-jobs): every render/ingest job for one product, newest first so the
-- editor shows the latest attempt's status at the top. id breaks created_at ties for stable ordering.
-- name: ListAssetJobsByProduct :many
SELECT * FROM asset_jobs WHERE product_id = $1 ORDER BY created_at DESC, id DESC;

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

-- ListPrintQueue is the admin kanban board read (P3-f): every print job across all stages, joined to
-- the human-readable order code + product name + quantity so a queue card says WHAT TO MAKE for WHICH
-- order (the bare print_jobs row carries ids only, useless at the printer). color_name is denormalized
-- on print_jobs (queue-card field, spec §02) so no colors join is needed; printer/eta/color_name are
-- nullable. oi.part_colors is the ADR-037 per-part-colour snapshot (jsonb, already denormalized WITH the
-- colour names at capture) — carried straight off the joined order_item so a parts-product card shows
-- what-filament-for-which-part without any new colours/parts join. All joins are INNER: a print job's order_item FK is ON DELETE CASCADE and its product FK is
-- RESTRICT, so every job has exactly one live item → order + product. Ordered by stage (enum definition
-- order NEED_PRINT→SHIPPED) then created_at, so each column is stable FIFO; the client groups by stage.
-- ponytail: no pagination — the active print queue on a one-shop box is small; SHIPPED accretes, so add
-- a "recent N" / archive filter here if that column ever grows unbounded.
-- name: ListPrintQueue :many
SELECT pj.id, pj.stage, pj.printer, pj.color_name, pj.eta,
  o.code AS order_code,
  p.name AS product_name,
  oi.quantity AS quantity,
  oi.part_colors AS part_colors
FROM print_jobs pj
JOIN order_items oi ON oi.id = pj.order_item_id
JOIN orders o ON o.id = oi.order_id
JOIN products p ON p.id = oi.product_id
ORDER BY pj.stage, pj.created_at;

-- GetPrintQueueEntry is the single-card read behind the stage PATCH (P3-f): the same enriched shape as
-- ListPrintQueue for one job, so the mutate response and the board list carry one identical card shape.
-- name: GetPrintQueueEntry :one
SELECT pj.id, pj.stage, pj.printer, pj.color_name, pj.eta,
  o.code AS order_code,
  p.name AS product_name,
  oi.quantity AS quantity,
  oi.part_colors AS part_colors
FROM print_jobs pj
JOIN order_items oi ON oi.id = pj.order_item_id
JOIN orders o ON o.id = oi.order_id
JOIN products p ON p.id = oi.product_id
WHERE pj.id = $1;
