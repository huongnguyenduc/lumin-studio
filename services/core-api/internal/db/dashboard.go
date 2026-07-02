package db

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
)

// Dashboard is the read-only repository for the admin dashboard aggregates (PR-3i): today's order
// stats + net revenue, the all-time queue counts, the reviews-waiting count, and the recent-orders
// list. There is NO write seam here — every method is a plain autocommit read over the pool — and a
// dashboard snapshot tolerates minor skew between its counts at one-shop scale (spec §03). Construct
// over the *pgxpool.Pool (or a pgx.Tx to read a consistent snapshot).
type Dashboard struct {
	q *sqlc.Queries
}

// NewDashboard builds a Dashboard over any sqlc.DBTX (the pool or a pgx.Tx).
func NewDashboard(db sqlc.DBTX) *Dashboard {
	return &Dashboard{q: sqlc.New(db)}
}

// OrderStats returns the today-scoped counts + net revenue and the all-time queue counts in ONE scan.
// dayStart/dayEnd bound the Asia/Ho_Chi_Minh day as a UTC [start,end) range (the caller computes it
// from the server clock). Net revenue follows spec §04: total of orders that have ever been PAID
// (payment_confirmed_at IS NOT NULL) and are not currently REFUNDED — so CANCELLED-after-PAID keeps
// counting (see dashboard.sql), which a naive status-IN sum would silently drop.
func (d *Dashboard) OrderStats(ctx context.Context, dayStart, dayEnd time.Time) (sqlc.DashboardOrderStatsRow, error) {
	return d.q.DashboardOrderStats(ctx, sqlc.DashboardOrderStatsParams{
		DayStart: pgtype.Timestamptz{Time: dayStart, Valid: true},
		DayEnd:   pgtype.Timestamptz{Time: dayEnd, Valid: true},
	})
}

// ReviewsWaiting counts published reviews with no shop reply yet (the owner "todo" signal).
func (d *Dashboard) ReviewsWaiting(ctx context.Context) (int64, error) {
	return d.q.DashboardReviewsWaiting(ctx)
}

// RecentOrders returns the `limit` newest orders with the customer display name, newest first.
func (d *Dashboard) RecentOrders(ctx context.Context, limit int32) ([]sqlc.DashboardRecentOrdersRow, error) {
	return d.q.DashboardRecentOrders(ctx, limit)
}
