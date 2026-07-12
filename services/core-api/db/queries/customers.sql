-- customers.sql — customer + PDPL consent queries (PR-2d). spec.md §02 + vn-compliance.

-- name: InsertCustomer :one
INSERT INTO customers (id, name, phone, email, social_handle, addresses)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: GetCustomerByID :one
SELECT * FROM customers WHERE id = $1;

-- name: GetCustomerByPhone :one
SELECT * FROM customers WHERE phone = $1;

-- ListAdminCustomers rolls every customer up with their order aggregates for the admin Khách hàng
-- list (P3-p). LEFT JOIN so a customer with no orders still appears (count 0, spent 0, last NULL).
-- Money stays raw int-VND: sum(bigint) is numeric, cast back to bigint (coalesced to 0). Ordered
-- most-recently-active first so a customer who just ordered floats to the top; a customer with no
-- orders sorts last, then newest customer. NOT paginated — a made-to-order shop's base is small and
-- the FE searches the whole set (mirrors the products list).
-- ponytail: totalSpent/orderCount count ALL orders regardless of status (rough lifetime value);
-- add a `WHERE o.status IN (paid..completed)` if the shop wants strict "tổng chi", and server
-- paging + a search predicate if the base ever outgrows a single fetch.
-- name: ListAdminCustomers :many
SELECT
  c.id, c.name, c.phone, c.email, c.social_handle,
  count(o.id)                        AS order_count,
  coalesce(sum(o.total), 0)::bigint  AS total_spent,
  max(o.created_at)::timestamptz     AS last_order_at
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.id
GROUP BY c.id
ORDER BY max(o.created_at) DESC NULLS LAST, c.created_at DESC;

-- InsertCustomerWithCredential registers a storefront account (PR-P1-r): a customer row that
-- carries a login credential. addresses defaults to '[]' and social_handle to NULL (a registrant
-- supplies only name/phone/email/password). A duplicate login email is rejected by the
-- customers_login_email_uq partial unique index (23505 → 409 in the handler), so there is no
-- find-then-insert race — the DB is the single arbiter of login-email uniqueness.
-- name: InsertCustomerWithCredential :one
INSERT INTO customers (id, name, phone, email, password_hash)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- GetCustomerByLoginEmail resolves a login (PR-P1-r): only CREDENTIALED customers (password_hash
-- NOT NULL) are candidates, matched case-insensitively on lower(email) — the exact predicate +
-- expression of customers_login_email_uq, so this read rides that index and a guest row (NULL
-- credential, possibly duplicate email) can never be logged into.
-- name: GetCustomerByLoginEmail :one
SELECT * FROM customers
WHERE lower(email) = lower($1) AND password_hash IS NOT NULL;

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
