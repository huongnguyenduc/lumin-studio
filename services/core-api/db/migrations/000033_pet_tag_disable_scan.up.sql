-- 000033_pet_tag_disable_scan.up.sql — two P3-t follow-up gaps found reviewing the first-scan flow:
-- (1) no way to void a compromised/leaked tag, (2) no server-side record of a tag ever being scanned
-- (only finder location-shares were recorded, in lost_events). Plain columns, not a new pet_tag_status
-- value — disabling must work from EITHER ENCODED or ACTIVATED without losing that status (spec §10's
-- 3-state lifecycle stays exactly as documented; disabled is an orthogonal flag).
ALTER TABLE pet_tags
  ADD COLUMN disabled_at    timestamptz,                      -- set → tag is voided; GetByShortID hides it (404) everywhere
  ADD COLUMN scan_count     bigint      NOT NULL DEFAULT 0,    -- bumped on every public GET /pet-tags/{shortId}
  ADD COLUMN last_scanned_at timestamptz;
