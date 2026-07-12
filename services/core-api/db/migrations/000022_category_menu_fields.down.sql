-- Reverse 000022: drop the category menu-control columns. Reversible → categories fall back to name-A→Z
-- order and every category is visible (today's ListCategories behaviour); the admin-only description/cover
-- image metadata is discarded.
ALTER TABLE categories
  DROP COLUMN display_order,
  DROP COLUMN description,
  DROP COLUMN image_url,
  DROP COLUMN visible;
