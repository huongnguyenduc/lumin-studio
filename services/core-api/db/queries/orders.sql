-- orders.sql — order spine read/write queries (PR-2e). spec.md §02/§04.
--
-- The seams in internal/db/orders.go orchestrate these inside the caller's transaction so the
-- domain row, the statusHistory append and the outbox event commit as one unit (ADR-006).
-- payment_method is intentionally NOT a CreateOrder param — phase 1 is bank_transfer only, so
-- the column DEFAULT supplies it; add the param when a second method arrives.

-- name: CreateOrder :one
INSERT INTO orders (
  id, code, channel, status, customer_id, shipping_address,
  subtotal, shipping_fee, total, payment_proof_url, payment_confirmed_at, note, status_history
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
RETURNING *;

-- name: GetOrderByID :one
SELECT * FROM orders WHERE id = $1;

-- name: GetOrderByCode :one
SELECT * FROM orders WHERE code = $1;

-- GetOrderForUpdate locks the row for the duration of the caller's tx so a status flip reads
-- and writes the order atomically (no lost-update race between concurrent transitions).
-- name: GetOrderForUpdate :one
SELECT * FROM orders WHERE id = $1 FOR UPDATE;

-- name: ListOrdersByStatus :many
SELECT * FROM orders WHERE status = $1 ORDER BY created_at DESC;

-- ListOrdersByCustomer returns a customer's own orders, newest-first, for the authenticated
-- storefront account history (PR-P1-r, GET /customer/orders). Scoped strictly by customer_id (the
-- verified session subject) — never by phone, which is non-unique. Guest orders placed before the
-- customer registered are NOT auto-linked (claiming an unverified identity's orders is deferred).
-- name: ListOrdersByCustomer :many
SELECT * FROM orders WHERE customer_id = $1 ORDER BY created_at DESC;

-- UpdateOrderStatus persists a transition: the new status, the full appended statusHistory,
-- and — only when supplied — the denormalized refund_proof_url and payment_confirmed_at
-- (COALESCE keeps the existing value when the narg is NULL). The append itself is computed in
-- Go by order.Transition; this statement just writes the result in one UPDATE.
-- name: UpdateOrderStatus :one
UPDATE orders
SET status = sqlc.arg('status'),
    status_history = sqlc.arg('status_history'),
    refund_proof_url = COALESCE(sqlc.narg('refund_proof_url'), refund_proof_url),
    payment_confirmed_at = COALESCE(sqlc.narg('payment_confirmed_at'), payment_confirmed_at),
    updated_at = now()
WHERE id = sqlc.arg('id')
RETURNING *;

-- SetTrackingCode persists the carrier tracking code on the SHIPPING transition. The status
-- flip itself goes through UpdateOrderStatus (order.Transition guard); the transition handler
-- runs this in the SAME tx so the PRINTING→SHIPPING flip and its mandatory tracking_code
-- (spec §04) commit atomically — an order can never reach SHIPPING without its code. RETURNING *
-- reflects both the new status (already flipped in this tx) and the tracking_code (§3h / §6 D12).
-- name: SetTrackingCode :one
UPDATE orders
SET tracking_code = sqlc.arg('tracking_code'),
    updated_at = now()
WHERE id = sqlc.arg('id')
RETURNING *;

-- name: InsertOrderItem :one
INSERT INTO order_items (
  id, order_id, product_id, color_id, option_ids, personalization, quantity, unit_price
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING *;

-- name: ListOrderItems :many
SELECT * FROM order_items WHERE order_id = $1;

-- NextOrderCode hands the create tx the next display-code number from order_code_seq (000010).
-- nextval is atomic and collision-free across concurrent callers by construction (§6 D9); the Go
-- seam formats it as `#LMN-<n>`. Called inside the SAME tx as CreateOrder so a code is minted per
-- create attempt (a rolled-back attempt simply burns its number — gaps are expected, codes are
-- display handles, not counts).
-- name: NextOrderCode :one
SELECT nextval('order_code_seq')::bigint AS n;
