-- 000016_order_item_configurator.up.sql — ADR-037 order-side capture (Stage 2b-2).
-- The catalog side (parts + option_choices, nullable colors.part_id) landed in 000015; this
-- migration adds the ORDER-side snapshot: what the customer actually picked, per line.
--
-- part_colors    — []{partId,colorId}: the colour chosen for each named part of a parts product
--                  (ADR-037). Empty [] for a flat product (which uses the existing color_id column).
-- option_choices — []{optionId,choiceId}: the picked choice for each choice-option that offers
--                  choices. Empty [] when a line has none (text/toggle options stay in option_ids).
--
-- ADR-004 (jsonb snapshot, NOT child tables — one line's selection is read whole with the line) ·
-- ADR-037 (additive capture). Both are NOT NULL DEFAULT '[]' so every existing/flat line already
-- reads as "no per-part/per-choice selection" without a backfill, and the code never sees NULL.
-- The pricing gate (internal/pricing.PriceItem) validates membership before a line is ever written,
-- so these columns are a faithful snapshot, not a trusted input — the price is re-derived server-side.

ALTER TABLE order_items
  ADD COLUMN part_colors    jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN option_choices jsonb NOT NULL DEFAULT '[]';
