-- 000003_events.up.sql — multi-event support (second wedding: own venue,
-- schedule, guests, groups). Wishes stay a shared wall — not scoped.

CREATE TABLE events (
  slug       TEXT PRIMARY KEY,                       -- immutable, like guests.id
  name       TEXT NOT NULL,                           -- admin label
  sort_order INT NOT NULL DEFAULT 0,
  -- Venue/timeline/ceremony fields (fixed shape — mirrors the Letter/Events
  -- component layout, both hardcoded to exactly 2 timeline stops and 2
  -- ceremony tickets today). Shallow-merged like `settings.data`.
  data       JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- Seed so the pre-existing single-wedding data has a home post-migration.
INSERT INTO events (slug, name, sort_order) VALUES ('dam-cuoi-1', 'Đám cưới 1', 1);

ALTER TABLE guests ADD COLUMN event_slug TEXT NOT NULL DEFAULT 'dam-cuoi-1'
  REFERENCES events(slug);
ALTER TABLE guests ALTER COLUMN event_slug DROP DEFAULT;
CREATE INDEX guests_event_slug_idx ON guests (event_slug);

-- Groups' PK becomes (event_slug, name) — each event manages its own groups.
ALTER TABLE groups DROP CONSTRAINT groups_pkey;
ALTER TABLE groups ADD COLUMN event_slug TEXT NOT NULL DEFAULT 'dam-cuoi-1'
  REFERENCES events(slug);
ALTER TABLE groups ALTER COLUMN event_slug DROP DEFAULT;
ALTER TABLE groups ADD PRIMARY KEY (event_slug, name);
