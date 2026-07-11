-- 000019_filament_consumption.up.sql — Vật tư costing engine, slice 4b (ADR-039). Deduct-on-print:
-- the draw ledger + the catalog standards the deduction reads + the print-job idempotency marker.
--
-- filament_consumption is the print+scrap draw ledger (ADR-039 pt 2) and the SOURCE OF TRUTH for what
-- left the shelf; filament_batches.qty_remaining (000018) is a rebuildable cache (original − Σ drawn).
-- Every FIFO decrement writes exactly ONE row for the ACTUAL qty drawn (clamped at stock, never the
-- requested qty when short — so a shortfall never poisons the weighted-average denominator, pt 4). qty is
-- CHECK(> 0): a draw against zero stock writes no row (nothing left the shelf). cost_vnd is the FIFO
-- actual cost of the drawn qty, FROZEN at draw time (int-VND, ADR-019). kind separates print draws (the
-- deduct-on-print seam) from scrap (the 4c hao-hụt log); scrap needs no bảng riêng (ADR-039 rejected-f).
CREATE TABLE filament_consumption (
  id            uuid        PRIMARY KEY,
  material_id   uuid        NOT NULL REFERENCES filament_materials (id) ON DELETE RESTRICT,
  kind          text        NOT NULL CHECK (kind IN ('print', 'scrap')),
  qty           bigint      NOT NULL CHECK (qty > 0),
  cost_vnd      bigint      NOT NULL CHECK (cost_vnd >= 0),   -- FIFO actual cost of the drawn qty, frozen (ADR-019)
  order_item_id uuid        REFERENCES order_items (id) ON DELETE SET NULL,  -- the printed line (print draws); NULL for scrap or a purged order
  product_name  text,       -- denormalized label so the ledger row survives a catalog rename/delete
  reason        text,       -- scrap reason (4c); NULL for a print draw
  note          text,
  at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX filament_consumption_material_idx ON filament_consumption (material_id, at);
CREATE INDEX filament_consumption_item_idx ON filament_consumption (order_item_id);

-- Catalog standards (ADR-039 pt 3): the est the deduct-on-print reads. Per-part (parts.est_filament_qty)
-- for ADR-037 two-tone products + product-level (products.est_filament_qty) for a flat product; the qty is
-- in the linked material's unit (gram|ml). colors.filament_material_id links a product colour to a
-- shop-wide filament (000018) — nullable (a colour with no linked filament is skipped cleanly by the
-- deduction, ADR-039 "skip sạch"); ON DELETE SET NULL so archiving/removing a material never blocks a
-- colour edit. All additive with DEFAULT 0 / NULL → no backfill, existing rows keep today's behaviour.
ALTER TABLE products ADD COLUMN est_filament_qty bigint NOT NULL DEFAULT 0 CHECK (est_filament_qty >= 0);
ALTER TABLE parts    ADD COLUMN est_filament_qty bigint NOT NULL DEFAULT 0 CHECK (est_filament_qty >= 0);
ALTER TABLE colors   ADD COLUMN filament_material_id uuid REFERENCES filament_materials (id) ON DELETE SET NULL;
CREATE INDEX colors_filament_material_idx ON colors (filament_material_id);

-- Deduct-on-print idempotency marker (ADR-039 pt 4): the atomic claim UPDATE sets this on the FIRST
-- →PRINTING (WHERE filament_deducted_at IS NULL) so a re-drag PRINTING→PACKING→PRINTING, or two staff
-- dragging at once, can never double-deduct. NULL = not yet drawn.
ALTER TABLE print_jobs ADD COLUMN filament_deducted_at timestamptz;
