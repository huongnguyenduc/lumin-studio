-- Move the engrave anchor from the PRODUCT (one spot for the whole model) onto each TEXT option
-- (ADR-037) — a product with two engraving fields ("Khắc mặt trước" + "Khắc mặt sau") needs two
-- independent surface spots, one per option, not one shared spot the second field can't use. Same
-- shape as products.engrave_anchor (one atomic jsonb blob: model-space metres + outward normal),
-- additive + NULLABLE (no anchor picked → the storefront front-centre heuristic, unchanged). No
-- backfill — pre-launch, no anchors picked in prod yet.
ALTER TABLE options ADD COLUMN engrave_anchor jsonb;
ALTER TABLE products DROP COLUMN engrave_anchor;
