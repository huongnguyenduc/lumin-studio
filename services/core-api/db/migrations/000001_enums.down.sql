-- 000001_enums.down.sql — reverse of 000001_enums.up.sql.
-- No table references these types yet, so the drops are clean (reversibility proven
-- by the migration round-trip test that lands with the first integration test, PR-2b).
DROP TYPE IF EXISTS consent_channel;
DROP TYPE IF EXISTS consent_scope;
DROP TYPE IF EXISTS print_stage;
DROP TYPE IF EXISTS review_status;
DROP TYPE IF EXISTS option_type;
DROP TYPE IF EXISTS product_status;
DROP TYPE IF EXISTS user_role;
DROP TYPE IF EXISTS payment_method;
DROP TYPE IF EXISTS order_channel;
DROP TYPE IF EXISTS order_status;
