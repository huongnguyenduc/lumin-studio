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

-- name: InsertOrderItem :one
INSERT INTO order_items (
  id, order_id, product_id, color_id, option_ids, personalization, quantity, unit_price
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING *;

-- name: ListOrderItems :many
SELECT * FROM order_items WHERE order_id = $1;
