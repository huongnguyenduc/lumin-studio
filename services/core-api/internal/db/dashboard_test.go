package db

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/order"
)

// --- integration (testcontainers; skips without a Docker provider) ---------------------

// dashDayWindow is a wide UTC "today" range for tests that don't probe the boundary (zero-state) — the
// seeded orders get created_at = now() (DB default), so [now-1h, now+1h) captures them without
// depending on the wall-clock's position within the ICT day. Tests that assert the net-revenue anchor
// or the half-open edge use a FIXED window + setDashTimes instead. The hcmDayBounds boundary math
// itself is proven in httpapi (TestHcmDayBounds, Docker-free).
func dashDayWindow() (time.Time, time.Time) {
	now := time.Now().UTC()
	return now.Add(-time.Hour), now.Add(time.Hour)
}

// seedDashOrder creates a committed PENDING_CONFIRM web order (ship 0 → total == unitPrice) and walks
// it through `path` (the sequence of transitions from PENDING_CONFIRM). →PAID goes through
// ConfirmPaymentTx (stamps payment_confirmed_at); every other edge goes through AdvanceStatusTx.
// Callers that need deterministic created_at / payment_confirmed_at override them afterwards with
// setDashTimes. Returns the order id.
func seedDashOrder(t *testing.T, ctx context.Context, pool *pgxpool.Pool, custID, prodID uuid.UUID, unitPrice int64, path ...order.Status) uuid.UUID {
	t.Helper()
	tx := mustBegin(t, ctx, pool)
	o, err := CreateOrderTx(ctx, tx, CreateOrderInput{
		ID: uuid.New(), Code: "LMN-" + uuid.NewString()[:8], Channel: order.ChannelWeb,
		CustomerID: custID, ShippingAddress: shipTo,
		Items:           []NewOrderItem{{ProductID: prodID, Quantity: 1, UnitPrice: unitPrice}},
		ShippingFee:     0,
		PaymentProofURL: "https://cdn.lumin.vn/p.jpg", At: orderAt, ByUser: "khach",
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("commit create: %v", err)
	}
	for _, to := range path {
		applyDashStep(t, ctx, pool, o.ID, to)
	}
	return o.ID
}

func applyDashStep(t *testing.T, ctx context.Context, pool *pgxpool.Pool, id uuid.UUID, to order.Status) {
	t.Helper()
	tx := mustBegin(t, ctx, pool)
	var err error
	switch to {
	case order.Paid:
		_, err = ConfirmPaymentTx(ctx, tx, ConfirmPaymentInput{OrderID: id, ByUser: "chu", At: orderAt})
	case order.Refunded:
		_, err = AdvanceStatusTx(ctx, tx, id, to, order.TransitionContext{
			Role: order.RoleOwner, ByUser: "chu", At: orderAt,
			Reason: "khách đổi ý", RefundProofURL: "https://cdn.lumin.vn/refund.jpg",
		})
	case order.Cancelled:
		_, err = AdvanceStatusTx(ctx, tx, id, to, order.TransitionContext{
			Role: order.RoleOwner, ByUser: "chu", At: orderAt, Reason: "huỷ đơn",
		})
	default:
		_, err = AdvanceStatusTx(ctx, tx, id, to, order.TransitionContext{Role: order.RoleOwner, ByUser: "chu", At: orderAt})
	}
	if err != nil {
		_ = tx.Rollback(ctx)
		t.Fatalf("advance →%s: %v", to, err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("commit →%s: %v", to, err)
	}
}

// setDashTimes overrides an order's created_at (the new-orders anchor) and, when paidAt is non-zero,
// its payment_confirmed_at (the revenue anchor) to deterministic instants — so a test can place an
// order precisely relative to a fixed [start,end) window. A zero paidAt leaves payment_confirmed_at
// untouched (for orders that were never paid).
func setDashTimes(t *testing.T, ctx context.Context, pool *pgxpool.Pool, id uuid.UUID, createdAt, paidAt time.Time) {
	t.Helper()
	var err error
	if paidAt.IsZero() {
		_, err = pool.Exec(ctx, `UPDATE orders SET created_at=$1 WHERE id=$2`, createdAt, id)
	} else {
		_, err = pool.Exec(ctx, `UPDATE orders SET created_at=$1, payment_confirmed_at=$2 WHERE id=$3`, createdAt, paidAt, id)
	}
	if err != nil {
		t.Fatalf("set dash times: %v", err)
	}
}

// TestDashboardNetRevenue is the DASH-01 money invariant (spec §04): revenue_today sums the total of
// orders whose PAYMENT landed in today's window (payment_confirmed_at ∈ [start,end)) and are not
// currently REFUNDED. Two load-bearing cases: (1) CANCELLED-after-PAID keeps counting (shop keeps the
// money) — a naive status-IN sum would drop it; (2) the anchor is the PAYMENT date, not creation:
// an order created before the window but paid inside it COUNTS, and one created inside but paid before
// does NOT. new_orders_today stays on the creation date.
func TestDashboardNetRevenue(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()
	custID, prodID, _ := seedOrderDeps(t, ctx, pool)

	winStart := time.Date(2026, 3, 15, 0, 0, 0, 0, time.UTC)
	winEnd := winStart.Add(24 * time.Hour)
	inWin := winStart.Add(8 * time.Hour)
	beforeWin := winStart.Add(-2 * time.Hour)

	seedAt := func(price int64, created, paid time.Time, path ...order.Status) uuid.UUID {
		id := seedDashOrder(t, ctx, pool, custID, prodID, price, path...)
		setDashTimes(t, ctx, pool, id, created, paid)
		return id
	}
	// Created in-window, paid in-window, revenue-bearing (incl. CANCELLED-after-PAID = 500k).
	seedAt(100_000, inWin, inWin, order.Paid)
	seedAt(200_000, inWin, inWin, order.Paid, order.Printing)
	seedAt(300_000, inWin, inWin, order.Paid, order.Printing, order.Shipping)
	seedAt(400_000, inWin, inWin, order.Paid, order.Printing, order.Shipping, order.Completed)
	seedAt(500_000, inWin, inWin, order.Paid, order.Cancelled) // CANCELLED after PAID — shop keeps money
	// Excluded from revenue: REFUNDED (money returned) + never-paid.
	seedAt(700_000, inWin, inWin, order.Paid, order.Refunded)
	seedAt(900_000, inWin, time.Time{})                    // PENDING_CONFIRM, never paid
	seedAt(1_100_000, inWin, time.Time{}, order.Cancelled) // CANCELLED before paying
	// Payment-date anchor proofs:
	seedAt(999_000, inWin, beforeWin, order.Paid) // paid BEFORE window → NOT revenue (but created in-window → new)
	seedAt(888_000, beforeWin, inWin, order.Paid) // created before, paid in-window → revenue (NOT new)

	stats, err := NewDashboard(pool).OrderStats(ctx, winStart, winEnd)
	if err != nil {
		t.Fatalf("OrderStats: %v", err)
	}

	const wantRevenue = 100_000 + 200_000 + 300_000 + 400_000 + 500_000 + 888_000 // 2_388_000
	if stats.RevenueToday != wantRevenue {
		t.Errorf("revenueToday = %d, want %d (paid-in-window & not-refunded; CANCELLED-after-PAID counts; paid-before-window & REFUNDED & never-paid excluded)", stats.RevenueToday, wantRevenue)
	}
	if stats.NewOrdersToday != 9 { // all created in-window except the 888k (created before)
		t.Errorf("newOrdersToday = %d, want 9 (created-in-window count)", stats.NewOrdersToday)
	}
	if stats.Printing != 1 {
		t.Errorf("printing = %d, want 1", stats.Printing)
	}
	if stats.PaidWaitingPrint != 3 { // the 100k, 999k, 888k orders sit in PAID
		t.Errorf("paidWaitingPrint = %d, want 3", stats.PaidWaitingPrint)
	}
	if stats.PendingConfirm != 1 {
		t.Errorf("pendingConfirm = %d, want 1", stats.PendingConfirm)
	}
}

// TestDashboardWindowBoundary probes the half-open [start,end) edge that DASH-01 requires — a >/>= or
// </<= flip must go red. revenue anchors on payment_confirmed_at; new_orders on created_at.
func TestDashboardWindowBoundary(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()
	custID, prodID, _ := seedOrderDeps(t, ctx, pool)

	winStart := time.Date(2026, 3, 15, 0, 0, 0, 0, time.UTC)
	winEnd := winStart.Add(24 * time.Hour)
	inWin := winStart.Add(8 * time.Hour)

	seedAt := func(price int64, created, paid time.Time, path ...order.Status) {
		id := seedDashOrder(t, ctx, pool, custID, prodID, price, path...)
		setDashTimes(t, ctx, pool, id, created, paid)
	}
	// Revenue edges (payment_confirmed_at), all created in-window so they don't disturb new_orders:
	seedAt(10_000, inWin, winStart, order.Paid)                      // paid == day_start → INCLUDED (>=)
	seedAt(20_000, inWin, winEnd, order.Paid)                        // paid == day_end   → EXCLUDED (<)
	seedAt(40_000, inWin, winEnd.Add(-time.Microsecond), order.Paid) // paid == day_end-1µs → INCLUDED
	// New-orders edges (created_at), never paid:
	seedAt(1, winStart, time.Time{}) // created == day_start → INCLUDED
	seedAt(1, winEnd, time.Time{})   // created == day_end   → EXCLUDED

	stats, err := NewDashboard(pool).OrderStats(ctx, winStart, winEnd)
	if err != nil {
		t.Fatalf("OrderStats: %v", err)
	}
	if stats.RevenueToday != 10_000+40_000 {
		t.Errorf("revenueToday = %d, want 50000 (start included, end excluded, end-1µs included)", stats.RevenueToday)
	}
	// 3 revenue orders created in-window + 1 created == day_start (included); the created==day_end one excluded.
	if stats.NewOrdersToday != 4 {
		t.Errorf("newOrdersToday = %d, want 4 (created day_start included, created day_end excluded)", stats.NewOrdersToday)
	}
}

// TestDashboardZeroState — an empty shop returns zeros and a non-nil empty recent list, never an
// error or a NULL sum (spec §03: render 0/empty, never blank).
func TestDashboardZeroState(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()
	repo := NewDashboard(pool)

	start, end := dashDayWindow()
	stats, err := repo.OrderStats(ctx, start, end)
	if err != nil {
		t.Fatalf("OrderStats: %v", err)
	}
	if stats.NewOrdersToday != 0 || stats.RevenueToday != 0 || stats.Printing != 0 ||
		stats.PendingConfirm != 0 || stats.PaidWaitingPrint != 0 {
		t.Fatalf("zero-state stats = %+v, want all 0", stats)
	}
	rw, err := repo.ReviewsWaiting(ctx)
	if err != nil || rw != 0 {
		t.Fatalf("reviewsWaiting = %d (err %v), want 0", rw, err)
	}
	recent, err := repo.RecentOrders(ctx, 8)
	if err != nil {
		t.Fatalf("RecentOrders: %v", err)
	}
	if len(recent) != 0 {
		t.Fatalf("recentOrders = %d, want 0", len(recent))
	}
}

// TestDashboardReviewsWaiting counts only published reviews with no reply yet.
func TestDashboardReviewsWaiting(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()
	prod := seedProduct(t, ctx, NewCatalog(pool), "den-review", 150000)

	insertReview := func(rating int, status string, reply []byte) {
		if _, err := pool.Exec(ctx,
			`INSERT INTO reviews (id, product_id, rating, status, reply) VALUES ($1,$2,$3,$4,$5)`,
			uuid.New(), prod.ID, rating, status, reply); err != nil {
			t.Fatalf("insert review: %v", err)
		}
	}
	insertReview(5, "published", nil)                         // waiting
	insertReview(4, "published", nil)                         // waiting
	insertReview(5, "published", []byte(`{"body":"cảm ơn"}`)) // replied → excluded
	insertReview(2, "hidden", nil)                            // hidden → excluded

	got, err := NewDashboard(pool).ReviewsWaiting(ctx)
	if err != nil {
		t.Fatalf("ReviewsWaiting: %v", err)
	}
	if got != 2 {
		t.Fatalf("reviewsWaiting = %d, want 2 (published + no reply only)", got)
	}
}

// TestDashboardRecentOrders returns the newest orders first with the joined customer name, capped at
// the limit.
func TestDashboardRecentOrders(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()
	custID, prodID, _ := seedOrderDeps(t, ctx, pool)

	// Three orders with distinct created_at so the DESC ordering is deterministic.
	ids := []uuid.UUID{
		seedDashOrder(t, ctx, pool, custID, prodID, 100_000),
		seedDashOrder(t, ctx, pool, custID, prodID, 200_000),
		seedDashOrder(t, ctx, pool, custID, prodID, 300_000),
	}
	base := time.Now().UTC()
	for i, id := range ids {
		// ids[0] oldest … ids[2] newest.
		if _, err := pool.Exec(ctx, `UPDATE orders SET created_at=$1 WHERE id=$2`, base.Add(time.Duration(i)*time.Minute), id); err != nil {
			t.Fatalf("set created_at: %v", err)
		}
	}

	rows, err := NewDashboard(pool).RecentOrders(ctx, 2) // limit below the 3 seeded
	if err != nil {
		t.Fatalf("RecentOrders: %v", err)
	}
	if len(rows) != 2 {
		t.Fatalf("recentOrders = %d, want 2 (limit)", len(rows))
	}
	// Newest first: ids[2] then ids[1].
	if rows[0].ID != ids[2] || rows[1].ID != ids[1] {
		t.Fatalf("recent order = [%s,%s], want newest-first [%s,%s]", rows[0].ID, rows[1].ID, ids[2], ids[1])
	}
	cust, err := NewIdentity(pool).CustomerByID(ctx, custID)
	if err != nil {
		t.Fatalf("customer: %v", err)
	}
	if rows[0].CustomerName != cust.Name || rows[0].Total != 300_000 {
		t.Fatalf("row0 = {name:%q total:%d}, want {name:%q total:300000}", rows[0].CustomerName, rows[0].Total, cust.Name)
	}
}
