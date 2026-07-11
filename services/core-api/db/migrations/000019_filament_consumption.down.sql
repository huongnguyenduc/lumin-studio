-- Reverse of 000019: drop the deduct-on-print draw ledger + standards + marker → back to no-costing
-- (deduct-on-print becomes a no-op the moment these columns/table are gone; 000018 inventory is untouched).
ALTER TABLE print_jobs DROP COLUMN IF EXISTS filament_deducted_at;
DROP INDEX IF EXISTS colors_filament_material_idx;
ALTER TABLE colors   DROP COLUMN IF EXISTS filament_material_id;
ALTER TABLE parts    DROP COLUMN IF EXISTS est_filament_qty;
ALTER TABLE products DROP COLUMN IF EXISTS est_filament_qty;
DROP TABLE IF EXISTS filament_consumption;
