-- customers.sql — customer + PDPL consent queries (PR-2d). spec.md §02 + vn-compliance.

-- name: InsertCustomer :one
INSERT INTO customers (id, name, phone, email, social_handle, addresses)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: GetCustomerByID :one
SELECT * FROM customers WHERE id = $1;

-- name: GetCustomerByPhone :one
SELECT * FROM customers WHERE phone = $1;

-- name: InsertConsentGrant :one
-- Append a granted purpose. granted_at defaults to now(); withdrawn_at is NULL (active).
INSERT INTO consent_grants (id, customer_id, scope, channel, policy_version)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- InsertConsentGrantIfAbsent appends a grant idempotently: if an ACTIVE grant already exists for
-- (customer, scope, channel) it does nothing, so a returning customer re-checking-out never trips
-- the consent_grants_active_uq partial unique and rolls back their order tx. The ON CONFLICT target
-- mirrors that partial index exactly (predicate included) so Postgres can infer it. PDPL: still one
-- explicit row per active purpose, never a pre-defaulted boolean; re-grant-after-withdrawal is a new
-- row (a withdrawn grant is not "active", so it does not conflict).
-- name: InsertConsentGrantIfAbsent :exec
INSERT INTO consent_grants (id, customer_id, scope, channel, policy_version)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (customer_id, scope, channel) WHERE withdrawn_at IS NULL DO NOTHING;

-- name: WithdrawConsent :exec
-- Mark the active grant for (customer, scope, channel) as withdrawn. Never deletes the row.
UPDATE consent_grants
SET withdrawn_at = now()
WHERE customer_id = $1 AND scope = $2 AND channel = $3 AND withdrawn_at IS NULL;

-- name: ListActiveConsents :many
SELECT * FROM consent_grants
WHERE customer_id = $1 AND withdrawn_at IS NULL
ORDER BY granted_at;
