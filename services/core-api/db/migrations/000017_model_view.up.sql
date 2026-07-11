-- ADR-038: owner-saved default camera pose for a product's 3D viewer. Additive + NULLABLE — NULL means
-- no saved pose, so the storefront <model-viewer> auto-frames (today's behaviour, unchanged). The whole
-- pose is set together via PATCH /admin/products/{id}/model-view, so it lives as ONE atomic jsonb blob
-- ({orbitTheta,orbitPhi,orbitRadius,targetX,targetY,targetZ}) rather than six columns (ADR-004 grain).
-- No backfill: existing + flat products keep NULL. Reversible — dropping the column returns to auto-frame.
ALTER TABLE products ADD COLUMN model3d_view jsonb;
