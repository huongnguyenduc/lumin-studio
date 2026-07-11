-- costing.sql — Vật tư cost inputs (ADR-039 slice 4c-1): machines (depreciation) + aux_costs (overhead).
-- Plain CRUD — the ₫/hour rate and the per-order aux allocation are DERIVED downstream (Go DTO / the 4c-2
-- rollup), never stored (ADR-039 pt 8), so these queries carry no money math. Scrap has no table here (it is
-- a filament_consumption row, 000019 — the scrap endpoint reuses the deduct helper).

-- name: InsertMachine :one
INSERT INTO machines (id, name, purchase_price_vnd, depreciation_months, expected_hours_per_month, is_primary, active)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING *;

-- ListMachines returns every machine, the primary(s) first then by name — the /vat-tu Giờ máy tab (owner+staff).
-- The DTO derives ₫/hour = purchase_price_vnd / (depreciation_months × expected_hours_per_month).
-- name: ListMachines :many
SELECT * FROM machines ORDER BY is_primary DESC, name, id;

-- name: UpdateMachine :one
UPDATE machines
SET name = $2, purchase_price_vnd = $3, depreciation_months = $4, expected_hours_per_month = $5,
    is_primary = $6, active = $7, updated_at = now()
WHERE id = $1
RETURNING *;

-- name: DeleteMachine :one
DELETE FROM machines WHERE id = $1 RETURNING id;

-- name: InsertAuxCost :one
INSERT INTO aux_costs (id, label, kind, amount_vnd)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- ListAuxCosts returns every overhead line grouped by kind then label — the /vat-tu Chi phí phụ tab (owner+staff).
-- name: ListAuxCosts :many
SELECT * FROM aux_costs ORDER BY kind, label, id;

-- name: UpdateAuxCost :one
UPDATE aux_costs
SET label = $2, kind = $3, amount_vnd = $4, updated_at = now()
WHERE id = $1
RETURNING *;

-- name: DeleteAuxCost :one
DELETE FROM aux_costs WHERE id = $1 RETURNING id;
