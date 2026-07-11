-- 000020_machines_aux.up.sql — Vật tư costing engine, slice 4c-1 (ADR-039 pt 6/7). The cost-input tables
-- the per-order COGS rollup (4c-2) reads: machine depreciation + allocated auxiliary costs. Both are
-- OWNER-curated rate inputs; the ₫/hour and per-order allocation are DERIVED (never stored — ADR-039 pt 8),
-- so nothing here is a frozen money amount. Scrap needs NO table (a filament_consumption row kind='scrap',
-- 000019 — ADR-039 rejected-f); the scrap endpoint reuses the deduct-on-print draw helper.
--
-- machines: one row per printer. ₫/hour = purchase_price_vnd / (depreciation_months × expected_hours_per_month),
-- derived in the DTO (the CHECKs > 0 make the divisor safe). is_primary marks the printer the 4c-2 snapshot
-- attributes machine-hours to (printer-API auto-attribution is Phase-5, ADR-039 pt 6 ceiling); active =
-- soft-hide (an inactive machine's rate is excluded from the rollup). ponytail: is_primary is NOT enforced
-- unique here — the 4c-2 rollup picks the most-recently-updated active primary (LIMIT 1), robust to a stray
-- second primary; add radio-unset if multi-printer attribution ever matters.
CREATE TABLE machines (
  id                       uuid        PRIMARY KEY,
  name                     text        NOT NULL,
  purchase_price_vnd       bigint      NOT NULL CHECK (purchase_price_vnd >= 0),   -- int-VND (ADR-019)
  depreciation_months      integer     NOT NULL CHECK (depreciation_months > 0),
  expected_hours_per_month integer     NOT NULL CHECK (expected_hours_per_month > 0),
  is_primary               boolean     NOT NULL DEFAULT false,
  active                   boolean     NOT NULL DEFAULT true,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

-- aux_costs: the shop's auxiliary/overhead lines (điện, phần mềm, mặt bằng…). kind splits a fixed per-order
-- cost from a monthly cost the 4c-2 rollup amortizes over the real-orders-30d count (guard-div-0). amount_vnd
-- is int-VND (ADR-019); the per-order allocation is derived at rollup time, not stored.
CREATE TABLE aux_costs (
  id         uuid        PRIMARY KEY,
  label      text        NOT NULL,
  kind       text        NOT NULL CHECK (kind IN ('per_order', 'per_month')),
  amount_vnd bigint      NOT NULL CHECK (amount_vnd >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
