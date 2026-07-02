-- dashboard.sql — admin dashboard aggregate reads (PR-3i). spec.md §03 (dashboard) / §04 (net revenue).
-- Read-only, no seam/tx: a dashboard snapshot tolerates minor skew between its counts at one-shop scale
-- (spec §03). All money stays raw int VND (no server formatting — always-must #2); counts return raw.
--
-- NET REVENUE (spec §04): "Doanh thu ròng = (đơn đã thu: PAID/PRINTING/SHIPPING/COMPLETED) − (đơn
-- REFUNDED)", and crucially "CANCELLED sau PAID mà không hoàn → shop GIỮ tiền = vẫn tính doanh thu".
-- A naive `status IN (PAID,PRINTING,SHIPPING,COMPLETED)` sum would DROP that CANCELLED-after-PAID
-- revenue (its current status is CANCELLED, not in the list). The revenue predicate is therefore
-- payment-based: an order's total counts iff it was PAID and is not currently REFUNDED. payment_confirmed_at
-- is stamped once at PAID (ConfirmPaymentTx / born-PAID inbox create) and never cleared, so
-- `payment_confirmed_at IN [day_start,day_end)` both (a) selects only paid orders (NULL fails the range
-- comparison → excluded) and (b) is the money-IN instant. `status <> 'REFUNDED'` then drops returned money.
--
-- REVENUE ANCHOR = payment date, NOT creation date (user decision 2026-07-02). "Doanh thu hôm nay" is
-- the cash COLLECTED today: an order counts on the day its payment lands, regardless of when it was
-- placed. This matters because the shop reconciles CK the next morning — a web order placed 23:00 and
-- paid 09:00 the next day is today's revenue on its PAY day, not lost. (An earlier created_at anchor
-- dropped such revenue from every daily figure.) new_orders_today stays on the created_at anchor
-- (orders PLACED today) — the two "today" cards deliberately use different anchors.
--
-- The "today" window is the Asia/Ho_Chi_Minh calendar day, computed by the caller (server clock) and
-- passed as a UTC [day_start, day_end) range — the DB stores timestamptz in UTC and the shop's day is
-- UTC+7, so the boundary can NOT be a UTC-midnight truncation. printing/pending_confirm/paid_waiting_print
-- are all-time snapshots (current queue depth), not windowed.

-- name: DashboardOrderStats :one
SELECT
  count(*) FILTER (
    WHERE created_at >= sqlc.arg('day_start') AND created_at < sqlc.arg('day_end')
  )::bigint AS new_orders_today,
  coalesce(sum(total) FILTER (
    WHERE payment_confirmed_at >= sqlc.arg('day_start') AND payment_confirmed_at < sqlc.arg('day_end')
      AND status <> 'REFUNDED'
  ), 0)::bigint AS revenue_today,
  count(*) FILTER (WHERE status = 'PRINTING')::bigint        AS printing,
  count(*) FILTER (WHERE status = 'PENDING_CONFIRM')::bigint AS pending_confirm,
  count(*) FILTER (WHERE status = 'PAID')::bigint            AS paid_waiting_print
FROM orders;

-- DashboardReviewsWaiting counts published reviews with no shop reply yet — the reviews_waiting_idx
-- partial index (WHERE reply IS NULL) scans only the un-replied hot set.
-- name: DashboardReviewsWaiting :one
SELECT count(*)::bigint AS reviews_waiting
FROM reviews
WHERE reply IS NULL AND status = 'published';

-- DashboardRecentOrders returns the N newest orders with the customer display name for the dashboard
-- strip (orders_created_at_idx backs the ORDER BY). Money stays raw int VND; customer_name is joined.
-- name: DashboardRecentOrders :many
SELECT o.id, o.code, c.name AS customer_name, o.status, o.total, o.created_at
FROM orders o
JOIN customers c ON c.id = o.customer_id
ORDER BY o.created_at DESC
LIMIT sqlc.arg('lim');
