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

-- ListAdminOrders is the admin orders table read (P3-b, GET /admin/orders): one page of orders newest-
-- first, optionally filtered to a single status. Unlike the public timeline it joins the customer NAME
-- and, for the "sản phẩm" column, a representative first-item product name + the line-item count (two
-- scalar subqueries — bounded per page, backed by order_items_order_idx, no N+1). The first item is
-- picked by a stable oi.id order: which line represents a multi-item order carries no meaning, only that
-- it is the SAME one every load. The status filter is a nullable narg (NULL = all statuses, "Tất cả").
-- created_at DESC, id DESC give a deterministic total order so OFFSET pagination is stable across pages.
-- Every order has ≥1 item (CreateOrderTx enforces it) so first_item_name is never NULL in practice.
-- name: ListAdminOrders :many
SELECT
  o.id, o.code, c.name AS customer_name, o.channel, o.status, o.total, o.created_at,
  (SELECT p.name
     FROM order_items oi JOIN products p ON p.id = oi.product_id
    WHERE oi.order_id = o.id
    ORDER BY oi.id
    LIMIT 1) AS first_item_name,
  (SELECT count(*) FROM order_items oi WHERE oi.order_id = o.id)::int AS item_count
FROM orders o
JOIN customers c ON c.id = o.customer_id
WHERE sqlc.narg('status')::order_status IS NULL OR o.status = sqlc.narg('status')::order_status
ORDER BY o.created_at DESC, o.id DESC
LIMIT sqlc.arg('page_limit')::int OFFSET sqlc.arg('page_offset')::int;

-- CountAdminOrders is the total for the admin list envelope — the SAME status filter as ListAdminOrders,
-- no sort/limit. It runs as a second autocommit read alongside the list; a concurrent order write between
-- the two can skew the count by one (cosmetic, self-heals next request, never a money value), which a
-- one-shop admin accepts rather than pay for a snapshot tx (same stance as CountActiveProducts).
-- name: CountAdminOrders :one
SELECT count(*) FROM orders o
WHERE sqlc.narg('status')::order_status IS NULL OR o.status = sqlc.narg('status')::order_status;

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

-- SetShippingArtifacts persists the two mandatory SHIPPING artifacts — the carrier tracking code
-- and the QC packing photo (D-P3-6) — on the PRINTING→SHIPPING transition. The status flip itself
-- goes through UpdateOrderStatus (order.Transition guard); the transition handler runs this in the
-- SAME tx so the flip and its mandatory tracking_code + qc_photo_url (spec §04) commit atomically —
-- an order can never reach SHIPPING without both. RETURNING * reflects the new status (already
-- flipped in this tx) plus both artifacts (§3h / §6 D12 / P3-e).
-- name: SetShippingArtifacts :one
UPDATE orders
SET tracking_code = sqlc.arg('tracking_code'),
    qc_photo_url = sqlc.arg('qc_photo_url'),
    updated_at = now()
WHERE id = sqlc.arg('id')
RETURNING *;

-- name: InsertOrderItem :one
INSERT INTO order_items (
  id, order_id, product_id, color_id, option_ids, personalization, quantity, unit_price,
  part_colors, option_choices
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
RETURNING *;

-- ListOrderItems returns an order's line items enriched with the human-readable product name, color
-- name and selected option labels (P3-e admin detail) — joined here so the admin order-detail page
-- shows WHAT TO MAKE, not raw ids (the merged Order DTO carried ids only, useless to a fulfiller).
-- product_name is NOT NULL (product FK is RESTRICT); color_name is NULL when the line has no color;
-- option_labels is a text[] (empty, never NULL) whose order is stable-arbitrary (by label), like the
-- admin list's first-item pick. The Personalization jsonb is unchanged (oi.*).
-- name: ListOrderItems :many
SELECT oi.*,
  p.name AS product_name,
  c.name AS color_name,
  coalesce(
    (SELECT array_agg(o.label ORDER BY o.label)
       FROM options o
       JOIN jsonb_array_elements_text(oi.option_ids) AS sel(id) ON o.id = sel.id::uuid),
    '{}'
  )::text[] AS option_labels
FROM order_items oi
JOIN products p ON p.id = oi.product_id
LEFT JOIN colors c ON c.id = oi.color_id
WHERE oi.order_id = $1;

-- NextOrderCode hands the create tx the next display-code number from order_code_seq (000010).
-- nextval is atomic and collision-free across concurrent callers by construction (§6 D9); the Go
-- seam formats it as `#LMN-<n>`. Called inside the SAME tx as CreateOrder so a code is minted per
-- create attempt (a rolled-back attempt simply burns its number — gaps are expected, codes are
-- display handles, not counts).
-- name: NextOrderCode :one
SELECT nextval('order_code_seq')::bigint AS n;

-- ListPurgeableProofOrders returns orders whose receipt image has outlived the retention window
-- (ADR-035): the order is in a terminal status AND its last transition (orders.updated_at, set by
-- UpdateOrderStatus and never touched again after a close state) is older than the cutoff. The
-- terminal set is passed in from order.TerminalStatuses() so the SQL never hardcodes it. Oldest-first
-- + LIMIT bounds one sweep; a nulled row drops out of the payment_proof_url IS NOT NULL filter next
-- pass. The retention sweeper deletes each Garage object, then clears the reference.
-- name: ListPurgeableProofOrders :many
SELECT id, payment_proof_url
FROM orders
WHERE payment_proof_url IS NOT NULL
  AND status::text = ANY(sqlc.arg('terminal')::text[])
  AND updated_at < sqlc.arg('purge_before')
ORDER BY updated_at
LIMIT sqlc.arg('row_limit');

-- ClearOrderPaymentProof nulls the receipt reference after its Garage object has been deleted
-- (ADR-035 retention). The payment_proof_url IS NOT NULL guard makes a re-run a no-op, so a sweep
-- that deletes the object but crashes before clearing simply retries idempotently next pass.
-- name: ClearOrderPaymentProof :exec
UPDATE orders
SET payment_proof_url = NULL, updated_at = now()
WHERE id = sqlc.arg('id') AND payment_proof_url IS NOT NULL;
