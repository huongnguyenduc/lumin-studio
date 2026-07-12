-- 000022_category_menu_fields.up.sql — P3-o slice o-2: the customer-facing menu controls for categories
-- (design "Danh mục — sắp xếp menu khách thấy"). Fully ADDITIVE + backward-compatible:
--   * display_order — the order categories appear in the storefront browse menu (owner drags ⠿ to reorder).
--     Backfilled from today's A→Z name order so the live menu keeps its current look; a new category appends
--     at the end (InsertCategory picks max+1). Same column name/shape as parts/option_choices (000015).
--   * visible       — owner toggle to hide a category from the shopping menu WITHOUT deleting it. Composes
--     with the existing active-product auto-hide in ListCategories: a category shows iff visible AND it has
--     an active product (an owner hide is a second, explicit gate on top of the auto-hide).
--   * description / image_url — admin-only presentation metadata (short blurb + cover image). NOT surfaced on
--     the public Category wire shape (the storefront renders name+slug chips only), so no public-contract
--     widening. image_url holds a shared proofstore image URL, the SAME host as product gallery photos
--     (reuse of the presigned-POST path — no new upload infra). Numbered above 000021 (monotonic).
ALTER TABLE categories
  ADD COLUMN display_order integer NOT NULL DEFAULT 0,
  ADD COLUMN description   text    NOT NULL DEFAULT '',
  ADD COLUMN image_url     text    NOT NULL DEFAULT '',
  ADD COLUMN visible       boolean NOT NULL DEFAULT true;

-- Seed display_order from the current A→Z order (the same total order ListCategories used before this
-- migration) so the live storefront menu is byte-for-byte unchanged until the owner drags a row.
WITH ordered AS (
  SELECT id, (row_number() OVER (ORDER BY name, slug))::integer - 1 AS pos FROM categories
)
UPDATE categories c SET display_order = o.pos FROM ordered o WHERE o.id = c.id;
