-- 000014_order_qc_photo.up.sql — QC packing photo for the PRINTING→SHIPPING gate (P3-e, D-P3-6).
-- spec.md §04 · docs/plans/phase-3-admin.md. Mirrors tracking_code exactly: a nullable text column,
-- a DENORMALIZED artifact of the SHIPPING transition, written in the SAME atomic tx as the status
-- flip (SetShippingArtifacts) so an order can never reach SHIPPING without its QC photo. Populated
-- only on →SHIPPING; NULL for every order that has not shipped. Numbered above 000013 (monotonic).
ALTER TABLE orders ADD COLUMN qc_photo_url text; -- QC packing photo (set on SHIPPING, alongside tracking_code)
