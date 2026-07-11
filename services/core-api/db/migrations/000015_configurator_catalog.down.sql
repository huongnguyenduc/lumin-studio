-- 000015_configurator_catalog.down.sql — revert ADR-037 catalog additions (Stage 2a).
-- Drop in reverse dependency order: option_choices first, then colors.part_id (FK → parts) before parts.
-- Reverts a configurator product to flat (any part-colors are removed with their parts).

DROP INDEX IF EXISTS option_choices_option_idx;
DROP TABLE IF EXISTS option_choices;

DROP INDEX IF EXISTS colors_part_idx;
ALTER TABLE colors DROP COLUMN IF EXISTS part_id;

DROP INDEX IF EXISTS parts_product_idx;
DROP TABLE IF EXISTS parts;
