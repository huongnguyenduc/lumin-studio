-- 000005_weddings.up.sql — multi-couple support: a `weddings` row per couple
-- (own settings, wishes wall, events, guests via events, and an optional
-- couple password for a scoped admin login). The pre-existing single-couple
-- data becomes wedding 'giang-hieu'.

CREATE TABLE weddings (
  slug          TEXT PRIMARY KEY,               -- immutable, like events.slug
  name          TEXT NOT NULL,                  -- admin label, e.g. 'Giang & Hiếu'
  sort_order    INT NOT NULL DEFAULT 0,
  password_hash TEXT,                           -- bcrypt; NULL = couple login disabled
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO weddings (slug, name, sort_order) VALUES ('giang-hieu', 'Giang & Hiếu', 1);

ALTER TABLE events ADD COLUMN wedding_slug TEXT NOT NULL DEFAULT 'giang-hieu'
  REFERENCES weddings(slug);
ALTER TABLE events ALTER COLUMN wedding_slug DROP DEFAULT;
CREATE INDEX events_wedding_slug_idx ON events (wedding_slug);

ALTER TABLE wishes ADD COLUMN wedding_slug TEXT NOT NULL DEFAULT 'giang-hieu'
  REFERENCES weddings(slug);
ALTER TABLE wishes ALTER COLUMN wedding_slug DROP DEFAULT;
CREATE INDEX wishes_wedding_created_idx ON wishes (wedding_slug, created_at DESC);

-- settings: single global row → one row per wedding.
ALTER TABLE settings ADD COLUMN wedding_slug TEXT REFERENCES weddings(slug);
UPDATE settings SET wedding_slug = 'giang-hieu';
ALTER TABLE settings ALTER COLUMN wedding_slug SET NOT NULL;
ALTER TABLE settings DROP CONSTRAINT settings_pkey;
ALTER TABLE settings DROP COLUMN id;
ALTER TABLE settings ADD PRIMARY KEY (wedding_slug);

-- Couple-requested subdomain change (full hostname), pending master review.
-- Master approves → copied into subdomain + cleared; rejects → cleared.
ALTER TABLE events ADD COLUMN requested_subdomain TEXT;

-- Master password hash — set from the admin UI; the ADMIN_PASSWORD env stays
-- as bootstrap/fallback while this is NULL. Single-row pattern like old settings.
CREATE TABLE admin_config (
  id                   BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  master_password_hash TEXT
);
INSERT INTO admin_config DEFAULT VALUES;
