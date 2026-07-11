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
