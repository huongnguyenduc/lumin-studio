package httpapi

import (
	"context"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db"
)

// TestGetDashboardEndToEnd exercises the full GetDashboard handler over a real Postgres: seed one
// web order, reconcile it to PAID, then assert the assembled DashboardSnapshot — newOrdersToday, net
// revenue (raw int VND), and the recent-orders row with its joined customer name. Proves the route is
// wired, the reads run, and the DTO assembles; the query-level invariants are proven in
// db.TestDashboard* and the boundary math in TestHcmDayBounds (Docker-free).
func TestGetDashboardEndToEnd(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()
	orderID := seedPendingWebOrder(t, ctx, pool)

	// Reconcile PENDING_CONFIRM → PAID so the order becomes revenue-bearing (total 420_000). The
	// confirm instant must be "today" (server clock) because revenueToday anchors on payment_confirmed_at
	// (the cash-in date), and GetDashboard windows on hcmDayBounds(time.Now()).
	paidAt := time.Now().UTC().Format(time.RFC3339Nano)
	if err := pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		_, err := db.ConfirmPaymentTx(ctx, tx, db.ConfirmPaymentInput{OrderID: orderID, ByUser: "chu", At: paidAt})
		return err
	}); err != nil {
		t.Fatalf("reconcile: %v", err)
	}

	srv := NewServer(slog.New(slog.NewTextHandler(io.Discard, nil)), pool, nil, nil)
	resp, err := srv.GetDashboard(ctx, api.GetDashboardRequestObject{})
	if err != nil {
		t.Fatalf("GetDashboard: %v", err)
	}
	snap, ok := resp.(api.GetDashboard200JSONResponse)
	if !ok {
		t.Fatalf("response type = %T, want GetDashboard200JSONResponse", resp)
	}

	if snap.Stats.NewOrdersToday != 1 {
		t.Errorf("newOrdersToday = %d, want 1", snap.Stats.NewOrdersToday)
	}
	if snap.Stats.RevenueToday != 420_000 {
		t.Errorf("revenueToday = %d, want 420000 (390000 item + 30000 ship, paid)", snap.Stats.RevenueToday)
	}
	if len(snap.RecentOrders) != 1 {
		t.Fatalf("recentOrders = %d, want 1", len(snap.RecentOrders))
	}
	r := snap.RecentOrders[0]
	if r.Id != orderID || r.CustomerName != "Nguyễn An" || string(r.Status) != "PAID" || r.Total != 420_000 {
		t.Fatalf("recent order = %+v, want {id:%s name:'Nguyễn An' status:PAID total:420000}", r, orderID)
	}
}
