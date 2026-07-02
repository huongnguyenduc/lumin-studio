package httpapi

import (
	"context"
	"time"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
)

// recentOrdersLimit caps the dashboard's recent-orders strip — the dashboard shows a short "recent
// orders" list, not the paginated orders table (that is its own page). 8 rows fills the card.
const recentOrdersLimit = 8

// hcmOffsetSeconds is Vietnam's fixed UTC offset (Indochina Time, UTC+7). Vietnam has observed no DST
// since 1975, so a fixed zone is both correct AND container-safe: it needs no tzdata files, which a
// scratch/distroless image may lack (time.LoadLocation("Asia/Ho_Chi_Minh") would fail there). The
// shop's "today" is a calendar day in this zone, never a UTC-midnight day.
const hcmOffsetSeconds = 7 * 60 * 60

// GetDashboard handles GET /admin/dashboard (PR-3i): the admin dashboard aggregate snapshot. It is
// admin-gated (classify → authRequired: owner AND staff both view), so the auth middleware guarantees
// a resolved actor in context; the read itself is actor-independent (a dashboard is not per-user).
// Returns raw int-VND amounts, counts, and OrderStatus enums — NO server-formatted money and NO
// translated labels (the frontend, PR-3j, formats via @lumin/core and resolves label keys; always-must
// #2/#3). r.Context() is propagated into every read so a client disconnect / 30s timeout cancels them.
//
// The three reads are separate autocommit queries (not one tx): a dashboard snapshot tolerates minor
// skew between its counts at one-shop scale (spec §03), and a read-only snapshot buys no correctness
// invariant worth a transaction here.
func (s *Server) GetDashboard(ctx context.Context, _ api.GetDashboardRequestObject) (api.GetDashboardResponseObject, error) {
	dayStart, dayEnd := hcmDayBounds(time.Now())

	repo := db.NewDashboard(s.pool)
	stats, err := repo.OrderStats(ctx, dayStart, dayEnd)
	if err != nil {
		return nil, err
	}
	reviewsWaiting, err := repo.ReviewsWaiting(ctx)
	if err != nil {
		return nil, err
	}
	recent, err := repo.RecentOrders(ctx, recentOrdersLimit)
	if err != nil {
		return nil, err
	}

	return api.GetDashboard200JSONResponse(api.DashboardSnapshot{
		Stats: api.DashboardStats{
			NewOrdersToday: int(stats.NewOrdersToday),
			RevenueToday:   stats.RevenueToday, // raw int-VND, never formatted server-side
			Printing:       int(stats.Printing),
			ReviewsWaiting: int(reviewsWaiting),
		},
		Todos: api.DashboardTodos{
			PendingConfirm:   int(stats.PendingConfirm),
			PaidWaitingPrint: int(stats.PaidWaitingPrint),
		},
		RecentOrders: recentOrdersDTO(recent),
	}), nil
}

// hcmDayBounds returns the UTC [start, end) range for the Asia/Ho_Chi_Minh calendar day containing
// `now`. DB timestamps are UTC; the shop's day is UTC+7, so "today" is NOT a UTC-midnight truncation
// (a UTC-midnight window would attribute the 00:00–07:00 ICT slice to the wrong day). Split from the
// handler and pure so the boundary math is unit-testable without a database or a live clock. A
// fixed-offset zone has no DST, so every day is exactly 24h → end = start + 24h.
func hcmDayBounds(now time.Time) (time.Time, time.Time) {
	hcm := time.FixedZone("ICT", hcmOffsetSeconds)
	local := now.In(hcm)
	start := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, hcm)
	return start.UTC(), start.Add(24 * time.Hour).UTC()
}

// recentOrdersDTO maps the recent-orders read rows to the wire shape. A nil/empty result yields a
// non-nil empty slice so the JSON renders `[]`, not `null` (spec §03 zero-state — render 0/empty,
// never blank). Money stays raw int VND.
func recentOrdersDTO(rows []sqlc.DashboardRecentOrdersRow) []api.RecentOrder {
	out := make([]api.RecentOrder, len(rows))
	for i, r := range rows {
		out[i] = api.RecentOrder{
			Id:           r.ID,
			Code:         r.Code,
			CustomerName: r.CustomerName,
			Status:       api.OrderStatus(r.Status),
			Total:        r.Total,
			CreatedAt:    r.CreatedAt.Time,
		}
	}
	return out
}
