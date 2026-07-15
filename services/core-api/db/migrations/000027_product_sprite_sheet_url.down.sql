-- Reverse 000027: drop the sprite_sheet_url column (round-trips cleanly, mirroring 000017's model3d_view
-- drop). Storefront/callback fall back to the pre-ADR-049 state — no sprite output path.
ALTER TABLE products DROP COLUMN sprite_sheet_url;
