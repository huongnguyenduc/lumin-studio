-- 000004_event_subdomain.up.sql — admin-editable per-event subdomain, so a
-- second wedding can go live on its own hostname with no redeploy (resolved
-- by Host header in wedding-web, see internal/httpapi/admin_events.go).

ALTER TABLE events ADD COLUMN subdomain TEXT UNIQUE;

-- Backfill the live domain onto the pre-existing event so nothing breaks.
UPDATE events SET subdomain = 'giangvahieu.luminstudio.vn' WHERE slug = 'dam-cuoi-1';
