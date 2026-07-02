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

// dashDayWindow is the wide UTC range the dashboard tests use for "today" — the seeded orders all
// get created_at = now() (DB default), so a window of [now-1h, now+1h) captures exactly the seeded
// set without depending on the wall-clock's position within the ICT day. The hcmDayBounds boundary
// math itself is proven separately in httpapi (TestHcmDayBounds, Docker-free).
func dashDayWindow() (time.Time, time.Time) {
	now := time.Now().UTC()
	return now.Add(-time.Hour), now.Add(time.Hour)
}

// seedDashOrder creates a committed PENDING_CONFIRM web order (ship 0 → total == unitPrice) and walks
// it through `path` (the sequence of transitions from PENDING_CONFIRM). →PAID goes through
// ConfirmPaymentTx (stamps payment_confirmed_at, the paid-ever marker net revenue keys on); every
// other edge goes through AdvanceStatusTx. Returns the order id.
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

// TestDashboardNetRevenue is the DASH-01 money invariant (spec §04): net revenue = total of orders
// that have EVER been PAID (payment_confirmed_at set) and are not currently REFUNDED. The load-bearing
// case is CANCELLED-after-PAID: the shop keeps that money, so it MUST count — a naive
// `status IN (PAID,PRINTING,SHIPPING,COMPLETED)` sum would silently drop it (its status is CANCELLED).
func TestDashboardNetRevenue(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()
	custID, prodID, _ := seedOrderDeps(t, ctx, pool)

	// Revenue-bearing (paid-ever, not refunded): 100k+200k+300k+400k + 500k(CANCELLED-after-PAID).
	seedDashOrder(t, ctx, pool, custID, prodID, 100_000, order.Paid)
	seedDashOrder(t, ctx, pool, custID, prodID, 200_000, order.Paid, order.Printing)
	seedDashOrder(t, ctx, pool, custID, prodID, 300_000, order.Paid, order.Printing, order.Shipping)
	seedDashOrder(t, ctx, pool, custID, prodID, 400_000, order.Paid, order.Printing, order.Shipping, order.Completed)
	seedDashOrder(t, ctx, pool, custID, prodID, 500_000, order.Paid, order.Cancelled) // shop keeps the money
	// Excluded: REFUNDED (money returned) + never-paid (PENDING_CONFIRM, CANCELLED-from-pending).
	seedDashOrder(t, ctx, pool, custID, prodID, 700_000, order.Paid, order.Refunded)
	seedDashOrder(t, ctx, pool, custID, prodID, 900_000)                    // stays PENDING_CONFIRM
	seedDashOrder(t, ctx, pool, custID, prodID, 1_100_000, order.Cancelled) // cancelled before paying

	start, end := dashDayWindow()
	stats, err := NewDashboard(pool).OrderStats(ctx, start, end)
	if err != nil {
		t.Fatalf("OrderStats: %v", err)
	}

	const wantRevenue = 100_000 + 200_000 + 300_000 + 400_000 + 500_000 // 1_500_000
	if stats.RevenueToday != wantRevenue {
		t.Errorf("revenueToday = %d, want %d (CANCELLED-after-PAID keeps money; REFUNDED + never-paid excluded)", stats.RevenueToday, wantRevenue)
	}
	if stats.NewOrdersToday != 8 {
		t.Errorf("newOrdersToday = %d, want 8", stats.NewOrdersToday)
	}
	// All-time queue counts (NOT today-windowed): one order sits in each of PRINTING / PAID /
	// PENDING_CONFIRM at snapshot time.
	if stats.Printing != 1 {
		t.Errorf("printing = %d, want 1", stats.Printing)
	}
	if stats.PaidWaitingPrint != 1 {
		t.Errorf("paidWaitingPrint = %d, want 1", stats.PaidWaitingPrint)
	}
	if stats.PendingConfirm != 1 {
		t.Errorf("pendingConfirm = %d, want 1", stats.PendingConfirm)
	}
}

// TestDashboardTodayWindow proves the today-scoped stats respect the [start,end) window: a backdated
// order is excluded from newOrdersToday/revenueToday, but the all-time queue count still sees it.
func TestDashboardTodayWindow(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()
	custID, prodID, _ := seedOrderDeps(t, ctx, pool)

	today := seedDashOrder(t, ctx, pool, custID, prodID, 100_000, order.Paid)
	old := seedDashOrder(t, ctx, pool, custID, prodID, 999_000, order.Paid)
	// Backdate the second order two days before the window start.
	if _, err := pool.Exec(ctx, `UPDATE orders SET created_at = now() - interval '2 days' WHERE id=$1`, old); err != nil {
		t.Fatalf("backdate: %v", err)
	}
	_ = today

	start, end := dashDayWindow()
	stats, err := NewDashboard(pool).OrderStats(ctx, start, end)
	if err != nil {
		t.Fatalf("OrderStats: %v", err)
	}
	if stats.NewOrdersToday != 1 {
		t.Errorf("newOrdersToday = %d, want 1 (backdated order excluded)", stats.NewOrdersToday)
	}
	if stats.RevenueToday != 100_000 {
		t.Errorf("revenueToday = %d, want 100000 (only today's paid order)", stats.RevenueToday)
	}
	if stats.PaidWaitingPrint != 2 {
		t.Errorf("paidWaitingPrint = %d, want 2 (all-time, incl backdated)", stats.PaidWaitingPrint)
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
