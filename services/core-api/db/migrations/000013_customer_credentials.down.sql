-- 000013_customer_credentials.down.sql — reverse the customer login credential (PR-P1-r).
-- Drop in reverse dependency order: the partial unique index, then the CHECK, then the column.
DROP INDEX IF EXISTS customers_login_email_uq;
ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_credential_needs_email;
ALTER TABLE customers DROP COLUMN IF EXISTS password_hash;
