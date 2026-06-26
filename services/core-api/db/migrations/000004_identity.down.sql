-- 000004_identity.down.sql — reverse of 000004_identity.up.sql.
-- Drop the reviews FK first (it references customers), then the tables that reference
-- customers, then customers.
ALTER TABLE reviews DROP CONSTRAINT IF EXISTS reviews_customer_id_fkey;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS consent_grants;
DROP TABLE IF EXISTS customers;
