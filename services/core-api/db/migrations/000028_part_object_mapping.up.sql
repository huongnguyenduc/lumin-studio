-- 000028 — part↔model-object mapping (f-2). Two columns, one concern: line a product's named PARTS up
-- with the named OBJECTS inside its 3D model, so a later slice (f-5 sprite / f-3 viewer) can render/recolor
-- each part in its own filament colour — the epic goal.
--   • parts.model_object_name — the object/material name (inside the source model) this part maps to.
--     '' = unmapped (the part falls back to its default filament, never grey). Owner-set in the editor.
--     NOT NULL DEFAULT '' mirrors the other optional text columns (model3d_url) — a Go string, no NULL juggling.
--   • products.model_object_names — the LIST of object names the model_ingest step found in the source model,
--     i.e. the editor dropdown's option set. Written ONLY by the render callback (like model3d_url /
--     sprite_sheet_url); UpdateProduct never touches it. NOT NULL DEFAULT '{}' → every existing product
--     back-fills to "no names yet" (populated on the next ingest), and a product is born with none.
ALTER TABLE parts ADD COLUMN model_object_name text NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN model_object_names text[] NOT NULL DEFAULT '{}';
