-- 000013_customer_credentials.up.sql — storefront customer login credential (Phase 1, PR-P1-r).
-- ADR-030: core-api owns authentication (self-issued JWT). PR-3e-1 added password_hash to the
-- admin `users`; this adds the mirror column to `customers` for the SEPARATE storefront realm
-- (a different signing secret + cookie — an admin JWT can never validate as a customer session).
--
-- NULLABLE on purpose: `customers` is guest-shaped (a row is created by phone at checkout with no
-- credential). password_hash IS NULL means "guest, no login" and always fails the bcrypt compare
-- (auth.VerifyPassword still burns one comparison so the null path is timing-indistinguishable —
-- no email enumeration). A row gains a credential only via POST /customer/register.
ALTER TABLE customers ADD COLUMN password_hash text;

-- A credentialed customer MUST have an email (it is the login handle). Guests keep email NULL/
-- duplicate; only rows with a password require one. Enforced in the DB so no code path can persist
-- a login-less-email account. Existing guest rows (password_hash IS NULL) all satisfy it.
ALTER TABLE customers
  ADD CONSTRAINT customers_credential_needs_email
  CHECK (password_hash IS NULL OR email IS NOT NULL);

-- The login email is unique ACROSS CREDENTIALED customers only (partial index): register rejects a
-- duplicate at the DB (23505 → 409), so two accounts can never share a login email, while guest rows
-- keep their non-unique/NULL emails. lower(email) makes it case-insensitive (matches normalizeEmail).
CREATE UNIQUE INDEX customers_login_email_uq
  ON customers (lower(email)) WHERE password_hash IS NOT NULL;
