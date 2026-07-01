-- 000009_user_credentials.down.sql — reverse of 000009_user_credentials.up.sql.
ALTER TABLE users DROP COLUMN IF EXISTS password_hash;
