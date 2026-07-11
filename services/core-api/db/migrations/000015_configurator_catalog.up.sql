-- 000015_configurator_catalog.up.sql — ADR-037 product configurator (catalog axis, Stage 2a).
--
-- Adds named PARTS (each with its own color set → the customer picks one color per part) and
-- enumerated OPTION CHOICES (a `choice` option offers S/M/L… each with its own price_delta). Fully
-- ADDITIVE + backward-compatible:
--   * colors.part_id is NULLABLE — NULL = today's flat, product-level color (no backfill of existing
--     products; the flat pricing path in pricing.PriceItem is untouched for them). A color with part_id
--     set belongs to that part.
--   * a `choice` option with ZERO option_choices rows keeps its legacy toggle + options.price_delta
--     (dual-mode, mirrors the nullable part_id); with rows, the price comes from the picked choice.
-- Money columns are int8 (bigint) VND NOT NULL CHECK(>=0) (ADR-019). Parts/choices ON DELETE CASCADE
-- from their parent (delete a part → its colors go; delete an option → its choices go), but a color that
-- an order_item already references is still pinned by that FK (000005, NO ACTION) → deleting such a part
-- raises 23503, which the handler maps to 409 "archive instead" (same reversible stance as DeleteProduct).
--
-- The ORDER-side capture (order_items.part_colors / option_choices jsonb) lands with the pricing +
-- order-capture PR (Stage 2b) — this migration is CATALOG-ONLY, so the money path stays in one reviewable PR.

CREATE TABLE parts (
  id            uuid    PRIMARY KEY,
  product_id    uuid    NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  name          text    NOT NULL,
  display_order integer NOT NULL DEFAULT 0
);
CREATE INDEX parts_product_idx ON parts (product_id);

-- Colors gain an optional part membership. NULL = flat product-level color (legacy/default). When set,
-- the color belongs to that part; the handler pins colors.product_id = parts.product_id (app-level
-- invariant — a part-color is still a color OF the product, part is a sub-grouping), and pricing enforces
-- color ∈ its claimed part (ADR-037, the cross-charge guard).
ALTER TABLE colors ADD COLUMN part_id uuid REFERENCES parts (id) ON DELETE CASCADE;
CREATE INDEX colors_part_idx ON colors (part_id);

CREATE TABLE option_choices (
  id            uuid    PRIMARY KEY,
  option_id     uuid    NOT NULL REFERENCES options (id) ON DELETE CASCADE,
  label         text    NOT NULL,
  description   text    NOT NULL DEFAULT '',
  price_delta   bigint  NOT NULL DEFAULT 0 CHECK (price_delta >= 0),
  display_order integer NOT NULL DEFAULT 0
);
CREATE INDEX option_choices_option_idx ON option_choices (option_id);
