-- 000007_settings.down.sql — reverse of 000007_settings.up.sql.
-- Drop the tables (their indexes + the setting_bank_audit triggers + the bigserial seq go with them),
-- then the trigger
-- FUNCTION — it is independent of any table, so it must be dropped explicitly or a re-applied up
-- would leave a stale definition. No new enum types were introduced, so the migration-reversibility
-- test (no tables / no enum types remain after all downs) holds with table + function drops alone.
DROP TABLE IF EXISTS setting_bank_audit;
DROP FUNCTION IF EXISTS setting_bank_audit_append_only();
DROP TABLE IF EXISTS settings;
DROP TABLE IF EXISTS reply_templates;
