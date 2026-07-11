-- 000021_cost_snapshot.up.sql — Vật tư costing engine, slice 4c-2 (ADR-039 pt 5/6). The per-order COGS
-- snapshot + the machine-hours catalog standard the snapshot's machineVnd term reads.
--
-- order_items.cost_snapshot is the frozen COGS blob (ADR-039 pt 5 / ADR-004 atomic jsonb): when a print
-- job first enters PRINTING (the deduct-on-print claim), a best-effort post-commit rollup writes
-- {filamentVnd, machineVnd, wasteVnd, auxVnd, totalVnd, +rate inputs, at}. NULLABLE with NO default is
-- load-bearing (oracle R1): NULL means "chưa chốt" (not costed — old order, unprinted line, or a rollup
-- fault to backfill), which is DISTINCT from a written snapshot whose filamentVnd is ₫0 (a print that drew
-- 0 filament — starved spool). A margin read must never treat NULL as ₫0 COGS (that would inflate margin),
-- so the two states stay separable at the column level. Frozen at print, so "đổi giá vật tư sau không sửa
-- đơn cũ" (design) holds. The filament term is authoritative in-tx (filament_consumption.cost_vnd, 000019);
-- the rollup only reads it back and adds the machine/waste/aux terms — a costing fault NEVER fails a paid
-- order or blocks the board (ADR-039 pt 5).
ALTER TABLE order_items ADD COLUMN cost_snapshot jsonb;

-- products.est_print_minutes is the per-item machine-time standard (ADR-039 pt 3: per-product, not per-part
-- — one job = one physical print run, ADR-007 1:1). machineVnd = est_print_hours × the primary machine's
-- ₫/hour. Stored as EXACT INTEGER MINUTES (the wire/DTO field is estPrintHours, hours; the handler converts
-- hours×60 on write, minutes÷60 on read) so the money freeze does exact integer-rational math (reusing the
-- FIFO draw's ratToVND round-once) with no float in the snapshot and no pgtype.Numeric surface — the codebase
-- has no numeric-column precedent. ponytail: minute granularity for a print-time ESTIMATE (6.5h = 390 min
-- exact); sub-minute precision is not meaningful for an estimate. Additive DEFAULT 0 → no backfill, a product
-- with no set estimate contributes machineVnd 0 (skipped cleanly, like a zero est_filament_qty).
ALTER TABLE products ADD COLUMN est_print_minutes integer NOT NULL DEFAULT 0 CHECK (est_print_minutes >= 0);
