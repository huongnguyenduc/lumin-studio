-- Engrave anchor: owner-picked position on the product's 3D model where a customer's engraving text is
-- projected (storefront decal). Additive + NULLABLE — NULL means no anchor picked, so the storefront
-- falls back to its front-centre raycast heuristic (today's behaviour, unchanged). Picked as one point
-- on the model surface via PATCH /admin/products/{id}/engrave-anchor, so it lives as ONE atomic jsonb
-- blob ({posX,posY,posZ,normX,normY,normZ} — model-space metres + outward surface normal), mirroring
-- model3d_view (ADR-004 grain). No backfill; reversible — dropping the column returns to the heuristic.
ALTER TABLE products ADD COLUMN engrave_anchor jsonb;
