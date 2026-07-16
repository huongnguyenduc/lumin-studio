-- 000029 — products.model3d_structured_url (f-4): the OUTPUT column a `model_ingest` writes for the STRUCTURED
-- glb derivative — named objects/materials preserved (unlike the fused model3d_url), same recenter translation
-- (ADR-038 pose stays aligned). The live viewer (f-3) loads it to recolor each part by object name, else falls
-- back to model3d_url. ONLY writer = the render callback (SetProductModel3dStructuredUrl), exactly like
-- model3d_url (000003) / sprite_sheet_url (000027) — UpdateProduct never touches it. NOT NULL DEFAULT ''
-- mirrors both: every existing product back-fills to '' (no structured glb yet), populated on the next ingest.
ALTER TABLE products ADD COLUMN model3d_structured_url text NOT NULL DEFAULT '';
