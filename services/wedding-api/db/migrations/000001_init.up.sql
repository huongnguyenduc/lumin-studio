-- 000001_init.up.sql — wedding invitation schema (HANDOFF §4).
--
-- One migration, whole domain: guests, wishes, groups, settings. The site is a
-- fixed-scope side project (one wedding), so the schema lands in one slice
-- instead of per-axis migrations like core-api.
--
-- Runs against the SEPARATE `wedding` database (HANDOFF §6) — never the lumin DB.

-- Host-managed guest groups. Members reference by name (plain TEXT, no FK):
-- deleting a group reassigns its members to 'Khác' in app code (HANDOFF §4).
CREATE TABLE groups (
  name       TEXT PRIMARY KEY,
  sort_order INT NOT NULL DEFAULT 0
);

-- Default groups (HANDOFF §3.2). Host can rename/delete them afterwards.
INSERT INTO groups (name, sort_order) VALUES
  ('Nhà gái', 1),
  ('Nhà trai', 2),
  ('Bạn cô dâu', 3),
  ('Bạn chú rể', 4),
  ('Đồng nghiệp', 5),
  ('Bạn bè', 6);

CREATE TABLE guests (
  -- Slug derived from the label (lowercase, diacritics stripped, kebab-case,
  -- -2/-3… on collision), generated ONCE at creation and immutable on rename —
  -- the id doubles as the invite token in the public link (HANDOFF §4).
  id         TEXT PRIMARY KEY,
  label      TEXT NOT NULL,                          -- salutation shown on the card
  "group"    TEXT NOT NULL DEFAULT 'Bạn bè',
  note       TEXT,                                   -- private, admin-only
  opened_at  TIMESTAMPTZ,                            -- first open only, write-once (set only if NULL)
  rsvp       TEXT CHECK (rsvp IN ('yes', 'no')),     -- NULL = pending; upsert last-write-wins
  rsvp_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Default table order is insertion desc (HANDOFF §3.4).
CREATE INDEX guests_created_at_idx ON guests (created_at DESC);

CREATE TABLE wishes (
  id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  guest_id   TEXT REFERENCES guests(id) ON DELETE SET NULL,  -- NULL for anonymous
  name       TEXT NOT NULL DEFAULT 'Khách mời',
  -- Required, capped ~500 chars (HANDOFF §5 validation) — enforced here so no
  -- code path (admin, future import) can sneak an empty/oversized wish in.
  text       TEXT NOT NULL CHECK (btrim(text) <> '' AND char_length(text) <= 500),
  -- One of the 4 curated presets (HANDOFF §2.7); NULL → default cream.
  color      TEXT CHECK (color IN (
               'rgb(255,251,248)',   -- Trắng ngà
               'rgb(249,241,232)',   -- Kem
               'rgb(248,235,230)',   -- Hồng phấn
               'rgb(238,239,230)'    -- Xanh ô liu
             )),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Wall + admin panel read newest-first (HANDOFF §2.8/§3.6).
CREATE INDEX wishes_created_at_idx ON wishes (created_at DESC);
CREATE INDEX wishes_guest_id_idx ON wishes (guest_id);

-- Site settings (HANDOFF §3.5): a single JSONB row (key→value; Garage object
-- keys or plain strings). `id` is a bool locked to true → the table can never
-- hold a second row, so reads/writes need no key.
CREATE TABLE settings (
  id   BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

INSERT INTO settings DEFAULT VALUES;
