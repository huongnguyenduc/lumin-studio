-- 000004_identity.up.sql — identity + PDPL consent axis (Core slice 2, PR-2d).
-- spec.md §02 (Customer/User) + vn-compliance (PDPL, ADR-015) + ADR-017 (address).
--
-- consent_grants is APPEND-then-mark: one row per granted purpose, never a boolean, never
-- pre-defaulted true; withdrawal sets withdrawn_at (never hard-delete) for an auditable
-- trail. A partial UNIQUE index enforces at most one ACTIVE grant per (customer,scope,
-- channel) while allowing re-grant-after-withdrawal as a new row.
-- addresses is jsonb Address[] (province/ward/street + name/phone) with NO district key
-- (ADR-017). user_role excludes 'system' (a runtime actor only, not a stored role).
-- This migration also adds the reviews.customer_id FK deferred from 000003 (forward-only).

CREATE TABLE customers (
  id            uuid        PRIMARY KEY,
  name          text        NOT NULL CHECK (char_length(name) BETWEEN 2 AND 60),
  phone         text        NOT NULL,                 -- VN phone; exact format validated app-side (spec §05)
  email         text,
  social_handle text,                                 -- singular per packages/core CustomerSchema (ADR-003 contract); spec §02 prose "socialHandles[]" is advisory/stale
  addresses     jsonb       NOT NULL DEFAULT '[]',    -- Address[]: province/ward/street (+name/phone), NO district
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX customers_phone_idx ON customers (phone);

CREATE TABLE consent_grants (
  id             uuid            PRIMARY KEY,
  customer_id    uuid            NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  scope          consent_scope   NOT NULL,
  channel        consent_channel NOT NULL,
  granted_at     timestamptz     NOT NULL DEFAULT now(),
  policy_version text            NOT NULL,
  withdrawn_at   timestamptz                          -- NULL = active; set on withdrawal (never hard-delete)
);
CREATE INDEX consent_grants_customer_idx ON consent_grants (customer_id);
CREATE UNIQUE INDEX consent_grants_active_uq
  ON consent_grants (customer_id, scope, channel) WHERE withdrawn_at IS NULL;

CREATE TABLE users (
  id     uuid      PRIMARY KEY,
  name   text      NOT NULL,
  email  text      NOT NULL UNIQUE,
  role   user_role NOT NULL,
  active boolean   NOT NULL DEFAULT true
);

-- The FK deferred from 000003 (catalog landed before identity). ON DELETE SET NULL so a
-- PDPL erasure of a customer keeps their reviews but unlinks the identity.
ALTER TABLE reviews
  ADD CONSTRAINT reviews_customer_id_fkey
  FOREIGN KEY (customer_id) REFERENCES customers (id) ON DELETE SET NULL;
