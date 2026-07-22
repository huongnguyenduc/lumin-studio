-- 000005_weddings.down.sql — collapse back to single-couple. Data outside the
-- first wedding is orphaned by design (down migrations are dev-only here).

DROP TABLE admin_config;

ALTER TABLE settings DROP CONSTRAINT settings_pkey;
ALTER TABLE settings ADD COLUMN id BOOLEAN DEFAULT TRUE CHECK (id);
-- Keep only the first wedding's row so the single-row PK can be restored.
DELETE FROM settings WHERE wedding_slug <> (SELECT slug FROM weddings ORDER BY sort_order, slug LIMIT 1);
ALTER TABLE settings DROP COLUMN wedding_slug;
ALTER TABLE settings ADD PRIMARY KEY (id);

DROP INDEX wishes_wedding_created_idx;
ALTER TABLE wishes DROP COLUMN wedding_slug;

DROP INDEX events_wedding_slug_idx;
ALTER TABLE events DROP COLUMN wedding_slug;
ALTER TABLE events DROP COLUMN requested_subdomain;

DROP TABLE weddings;
