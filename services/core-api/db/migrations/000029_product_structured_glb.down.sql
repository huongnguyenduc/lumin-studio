-- Reverse 000029: drop the structured-glb column (round-trips cleanly, like 000027's sprite_sheet_url drop).
-- The live viewer falls back to model3d_url (the fused glb) — no per-part recolor, the pre-f-4 state.
ALTER TABLE products DROP COLUMN model3d_structured_url;
