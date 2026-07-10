-- 000014_order_qc_photo.down.sql — drop the QC packing photo column.
ALTER TABLE orders DROP COLUMN qc_photo_url;
