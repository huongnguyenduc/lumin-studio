-- filament.sql — Vật tư inventory (ADR-039 slice 4a). filament_materials = shop-wide palette;
-- filament_batches = import lots. Stock + weighted-average cost/unit are DERIVED here (never stored): the
-- list/get queries LEFT JOIN batches so a never-imported material reads stock 0, avg 0.

-- name: InsertFilamentMaterial :one
INSERT INTO filament_materials (id, name, material, unit, hex, low_stock_threshold)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: UpdateFilamentMaterial :one
UPDATE filament_materials
SET name = $2, material = $3, unit = $4, hex = $5, low_stock_threshold = $6, archived = $7, updated_at = now()
WHERE id = $1
RETURNING *;

-- ListFilamentMaterials returns the palette with DERIVED stock + weighted-average cost/unit. The weighted
-- average is Σ(qty_remaining × per-lot ₫/unit) ÷ Σ(qty_remaining) where per-lot ₫/unit = total_cost/qty_original;
-- it is computed in ONE numeric expression (no per-lot pre-rounding → no int-VND drift, ADR-039) and cast
-- to float8 for display (a RATE, not stored money — frozen to int only at the print-time snapshot, 4b). A
-- material with no batches reads stock 0, avg 0. include_archived NULL → active only (archived hidden).
-- name: ListFilamentMaterials :many
SELECT
  m.*,
  COALESCE(SUM(b.qty_remaining), 0)::bigint AS stock_qty,
  COALESCE(
    SUM(b.qty_remaining::numeric * b.total_cost_vnd / b.qty_original) / NULLIF(SUM(b.qty_remaining), 0),
    0
  )::float8 AS avg_cost_per_unit
FROM filament_materials m
LEFT JOIN filament_batches b ON b.material_id = m.id
WHERE (sqlc.narg('include_archived')::bool IS TRUE OR m.archived = false)
GROUP BY m.id
ORDER BY m.archived, m.name;

-- GetFilamentMaterial is the by-id read with the same derived stock/avg (LEFT JOIN → exists with no lots
-- still returns one row). Batches for the weighted-avg breakdown panel come from ListFilamentBatchesByMaterial.
-- name: GetFilamentMaterial :one
SELECT
  m.*,
  COALESCE(SUM(b.qty_remaining), 0)::bigint AS stock_qty,
  COALESCE(
    SUM(b.qty_remaining::numeric * b.total_cost_vnd / b.qty_original) / NULLIF(SUM(b.qty_remaining), 0),
    0
  )::float8 AS avg_cost_per_unit
FROM filament_materials m
LEFT JOIN filament_batches b ON b.material_id = m.id
WHERE m.id = $1
GROUP BY m.id;

-- name: ListFilamentBatchesByMaterial :many
SELECT * FROM filament_batches WHERE material_id = $1 ORDER BY imported_at, id;

-- InsertFilamentBatch records one import lot; qty_remaining starts equal to qty_original (a fresh lot is
-- untouched). The handler computes qty_original = spoolCount × qtyPerSpool and total_cost = spoolCount ×
-- pricePerSpool from the "nhập cuộn" dialog.
-- name: InsertFilamentBatch :one
INSERT INTO filament_batches (id, material_id, qty_original, qty_remaining, total_cost_vnd)
VALUES ($1, $2, $3, $3, $4)
RETURNING *;

-- ── Deduct-on-print (slice 4b, ADR-039 pt 2/4) ────────────────────────────────────────────────────────

-- BatchesToDecrement returns a material's OPEN lots oldest-first for a FIFO draw, row-locked (FOR UPDATE)
-- so two concurrent deduct-on-print draws of the same filament serialize — the second blocks until the
-- first commits, then reads the decremented qty_remaining, so no lost update. qty_original is returned so
-- the caller derives each lot's ₫/unit = total_cost_vnd / qty_original when it freezes the FIFO cost.
-- name: BatchesToDecrement :many
SELECT id, qty_remaining, qty_original, total_cost_vnd
FROM filament_batches
WHERE material_id = $1 AND qty_remaining > 0
ORDER BY imported_at, id
FOR UPDATE;

-- DecrementBatch subtracts a drawn qty from one lot. The 000018 CHECK (qty_remaining >= 0) is the backstop;
-- the caller never takes more than the lot's qty_remaining (clamp), so this cannot go negative.
-- name: DecrementBatch :exec
UPDATE filament_batches SET qty_remaining = qty_remaining - sqlc.arg('drawn') WHERE id = sqlc.arg('id');

-- InsertConsumption writes ONE draw-ledger row for the ACTUAL qty drawn (never the requested qty when short).
-- cost_vnd is the FIFO actual cost the caller froze (Σ per-lot drawn × ₫/unit, rounded once). order_item_id
-- is the printed line (NULL for a scrap draw); product_name is denormalized so the row survives a catalog edit.
-- name: InsertConsumption :one
INSERT INTO filament_consumption (id, material_id, kind, qty, cost_vnd, order_item_id, product_name, reason, note)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
RETURNING *;

-- OrderItemForDeduction is the deduct-on-print resolution read (ADR-039 pt 4): the line a print job draws
-- for — product_id + color_id + the ADR-037 part_colors snapshot + quantity, plus the product's flat est +
-- name. product FK is RESTRICT (000005) so the product always resolves. The handler turns this into draw
-- lines using the product's live parts/colors (grams from parts.est_filament_qty | products.est_filament_qty,
-- material from colors.filament_material_id).
-- name: OrderItemForDeduction :one
SELECT oi.product_id, oi.color_id, oi.part_colors, oi.quantity,
  p.name AS product_name,
  p.est_filament_qty AS product_est_filament_qty
FROM order_items oi
JOIN products p ON p.id = oi.product_id
WHERE oi.id = $1;
