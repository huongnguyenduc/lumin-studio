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

-- ── COGS snapshot rollup + KPI reads (slice 4c-2, ADR-039 pt 5/6/7) ────────────────────────────────────

-- ItemCostInputs reads the two item-specific rollup inputs in one round-trip: the filament cost FROZEN at
-- print (Σ of the printed line's filament_consumption.cost_vnd — oracle R2: SUM per order_item_id and read
-- the frozen cost, NEVER re-derive from live batches; two parts sharing a material = two rows, both summed)
-- and the product's machine-time standard (est_print_minutes → machineVnd). A starved print drew 0 filament
-- and wrote NO ledger row, so the SUM is 0 (COALESCE) — distinct from "not costed" at the column level
-- (oracle R1: the rollup still WRITES a non-NULL snapshot). Unknown id → ErrNoRows (never in the rollup path).
-- name: ItemCostInputs :one
SELECT
  p.est_print_minutes::integer AS est_print_minutes,
  (SELECT COALESCE(SUM(cost_vnd), 0)
     FROM filament_consumption
    WHERE order_item_id = oi.id AND kind = 'print')::bigint AS filament_vnd
FROM order_items oi
JOIN products p ON p.id = oi.product_id
WHERE oi.id = $1;

-- SnapshotShopInputs reads the shop-wide, rolling-30-day rate inputs shared by the per-order rollup AND the
-- costing-summary KPI (so the frozen COGS margins can never diverge from the /vat-tu dashboard — ADR-039
-- pt 7). One round-trip: scrap+print grams over the last 30 days (the waste factor = scrap ÷ print, guarded
-- print=0→0 in Go), the aux per_order/per_month totals, and the real-orders-30d count. "Real order" mirrors
-- the dashboard net-revenue predicate (dashboard.sql): money landed and not returned — payment_confirmed_at
-- within the window (NULL fails the range → unpaid excluded) AND status <> 'REFUNDED'. The 30-day window is
-- a rolling now()-interval (not a TZ calendar boundary like the dashboard's "today"), so it needs no caller range.
-- name: SnapshotShopInputs :one
SELECT
  (SELECT COALESCE(SUM(qty) FILTER (WHERE kind = 'scrap'), 0)
     FROM filament_consumption WHERE at >= now() - interval '30 days')::bigint AS scrap_qty_30d,
  (SELECT COALESCE(SUM(qty) FILTER (WHERE kind = 'print'), 0)
     FROM filament_consumption WHERE at >= now() - interval '30 days')::bigint AS print_qty_30d,
  (SELECT COALESCE(SUM(amount_vnd) FILTER (WHERE kind = 'per_order'), 0)
     FROM aux_costs)::bigint AS aux_per_order_vnd,
  (SELECT COALESCE(SUM(amount_vnd) FILTER (WHERE kind = 'per_month'), 0)
     FROM aux_costs)::bigint AS aux_per_month_vnd,
  (SELECT count(*)
     FROM orders
    WHERE payment_confirmed_at >= now() - interval '30 days' AND status <> 'REFUNDED')::bigint AS real_orders_30d;

-- PrimaryMachine returns the machine the snapshot attributes machine-hours to (ADR-039 pt 6). is_primary is
-- not enforced unique (000020 ponytail), so pick the most-recently-updated ACTIVE primary (spec-guardian
-- 4c-1 NOTE — robust to a stray second primary or an inactivated one). No primary set → ErrNoRows → the
-- rollup contributes machineVnd 0 (guarded), never a fault.
-- name: PrimaryMachine :one
SELECT * FROM machines WHERE is_primary AND active ORDER BY updated_at DESC, id LIMIT 1;

-- SetOrderItemCostSnapshot writes the frozen COGS blob (the rollup marshals it in Go). Best-effort,
-- post-commit — a failure leaves cost_snapshot NULL ("chưa chốt", backfillable), never blocking the board.
-- name: SetOrderItemCostSnapshot :exec
UPDATE order_items SET cost_snapshot = $2 WHERE id = $1;
