-- 000006_jobs.down.sql — reverse of 000006_jobs.up.sql.
-- Drop the tables first, then the enum types they introduced (asset_job_status / asset_job_type).
-- print_stage belongs to 000001 and stays; order_items / products are earlier migrations and stay.
-- The migration-reversibility test (outbox_test.go) asserts NO tables and NO enum types remain
-- after all downs, so the two new enums MUST be dropped here.
DROP TABLE IF EXISTS print_jobs;
DROP TABLE IF EXISTS asset_jobs;
DROP TYPE IF EXISTS asset_job_type;
DROP TYPE IF EXISTS asset_job_status;
