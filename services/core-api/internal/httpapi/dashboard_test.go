package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/order"
)

// TestGetDashboardRequiresAuth proves the /admin/dashboard route is mounted AND admin-gated
// (classify → authRequired): a request carrying no session cookie is rejected at the boundary with
// 401, before the handler runs — so this needs no DB (serverWithUsers has a nil pool). Also keeps the
// route-mount seam covered now that GetDashboard is no longer a 501 stub.
func TestGetDashboardRequiresAuth(t *testing.T) {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/admin/dashboard", nil)
	testAuthedRouter(serverWithUsers(fakeUsers{})).ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("GET /admin/dashboard (no cookie) = %d, want 401 (admin-gated, fail-closed)", rec.Code)
	}
}

// TestBuildDashboardSnapshot pins the row→DTO slot wiring with DISTINCT values in every field, so a
// swap (e.g. PendingConfirm↔PaidWaitingPrint, both int todo counts) or a mis-sourced ReviewsWaiting
// (it comes from a SEPARATE read, not the stats row) fails. Pure — runs in the Docker-free lane.
func TestBuildDashboardSnapshot(t *testing.T) {
	stats := sqlc.DashboardOrderStatsRow{
		NewOrdersToday:   7,
		RevenueToday:     650_000,
		Printing:         3,
		PendingConfirm:   1,
		PaidWaitingPrint: 2,
	}
	id := uuid.New()
	recent := []sqlc.DashboardRecentOrdersRow{{
		ID: id, Code: "#LMN-1000", CustomerName: "Nguyễn An", Status: order.Paid, Total: 420_000,
		CreatedAt: pgtype.Timestamptz{Time: mustParse(t, "2026-07-02T09:00:00Z"), Valid: true},
	}}
	snap := buildDashboardSnapshot(stats, 5, recent) // reviewsWaiting=5 from the separate read

	if snap.Stats.NewOrdersToday != 7 {
		t.Errorf("newOrdersToday = %d, want 7", snap.Stats.NewOrdersToday)
	}
	if snap.Stats.RevenueToday != 650_000 {
		t.Errorf("revenueToday = %d, want 650000", snap.Stats.RevenueToday)
	}
	if snap.Stats.Printing != 3 {
		t.Errorf("printing = %d, want 3", snap.Stats.Printing)
	}
	if snap.Stats.ReviewsWaiting != 5 {
		t.Errorf("reviewsWaiting = %d, want 5 (from the separate ReviewsWaiting read, not the stats row)", snap.Stats.ReviewsWaiting)
	}
	if snap.Todos.PendingConfirm != 1 {
		t.Errorf("pendingConfirm = %d, want 1", snap.Todos.PendingConfirm)
	}
	if snap.Todos.PaidWaitingPrint != 2 {
		t.Errorf("paidWaitingPrint = %d, want 2", snap.Todos.PaidWaitingPrint)
	}
	if len(snap.RecentOrders) != 1 || snap.RecentOrders[0].Id != id || snap.RecentOrders[0].Total != 420_000 {
		t.Fatalf("recentOrders wrong: %+v", snap.RecentOrders)
	}
}

// hcmDayBounds is the load-bearing correctness of the "today" window: DB timestamps are UTC, the
// shop's day is UTC+7, so the boundary must be ICT-midnight, never UTC-midnight. These are pure
// (no DB) so they run in the Docker-free lane.
func TestHcmDayBounds(t *testing.T) {
	// ICT is UTC+7 → local midnight is the previous UTC day at 17:00Z.
	cases := []struct {
		name      string
		now       string // RFC3339 (UTC)
		wantStart string
		wantEnd   string
	}{
		{
			name:      "mid-morning ICT stays same day",
			now:       "2026-07-02T10:00:00Z", // 17:00 ICT, 2 Jul
			wantStart: "2026-07-01T17:00:00Z", // 00:00 ICT, 2 Jul
			wantEnd:   "2026-07-02T17:00:00Z", // 00:00 ICT, 3 Jul
		},
		{
			name:      "just before ICT midnight",
			now:       "2026-07-02T16:59:59Z", // 23:59:59 ICT, 2 Jul
			wantStart: "2026-07-01T17:00:00Z",
			wantEnd:   "2026-07-02T17:00:00Z",
		},
		{
			name:      "exactly ICT midnight rolls to next day",
			now:       "2026-07-02T17:00:00Z", // 00:00 ICT, 3 Jul
			wantStart: "2026-07-02T17:00:00Z", // 00:00 ICT, 3 Jul
			wantEnd:   "2026-07-03T17:00:00Z",
		},
		{
			name:      "small hours ICT belong to that ICT day",
			now:       "2026-07-01T17:30:00Z", // 00:30 ICT, 2 Jul
			wantStart: "2026-07-01T17:00:00Z",
			wantEnd:   "2026-07-02T17:00:00Z",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			now := mustParse(t, tc.now)
			start, end := hcmDayBounds(now)
			if !start.Equal(mustParse(t, tc.wantStart)) {
				t.Errorf("start = %s, want %s", start.UTC().Format(time.RFC3339), tc.wantStart)
			}
			if !end.Equal(mustParse(t, tc.wantEnd)) {
				t.Errorf("end = %s, want %s", end.UTC().Format(time.RFC3339), tc.wantEnd)
			}
			if got := end.Sub(start); got != 24*time.Hour {
				t.Errorf("window = %s, want 24h (fixed-offset zone, no DST)", got)
			}
			// now must fall in [start, end): the window contains the instant it was derived from.
			if now.Before(start) || !now.Before(end) {
				t.Errorf("now %s not in [%s, %s)", tc.now, start.UTC(), end.UTC())
			}
		})
	}
}

func mustParse(t *testing.T, s string) time.Time {
	t.Helper()
	tm, err := time.Parse(time.RFC3339, s)
	if err != nil {
		t.Fatalf("parse %q: %v", s, err)
	}
	return tm
}

// recentOrdersDTO must render an empty result as a non-nil slice so the JSON is `[]`, not `null`
// (spec §03 zero-state — render, never blank).
func TestRecentOrdersDTOEmptyIsNonNil(t *testing.T) {
	if got := recentOrdersDTO(nil); got == nil {
		t.Fatal("recentOrdersDTO(nil) = nil, want non-nil empty slice (renders [], not null)")
	}
	if got := recentOrdersDTO([]sqlc.DashboardRecentOrdersRow{}); len(got) != 0 || got == nil {
		t.Fatalf("recentOrdersDTO([]) = %v, want non-nil empty", got)
	}
}

// recentOrdersDTO maps every field through unchanged, keeping money raw int VND.
func TestRecentOrdersDTOMapsFields(t *testing.T) {
	id := uuid.New()
	at := mustParse(t, "2026-07-02T09:00:00Z")
	rows := []sqlc.DashboardRecentOrdersRow{{
		ID:           id,
		Code:         "#LMN-1000",
		CustomerName: "Nguyễn An",
		Status:       order.Printing,
		Total:        445000,
		CreatedAt:    pgtype.Timestamptz{Time: at, Valid: true},
	}}
	got := recentOrdersDTO(rows)
	if len(got) != 1 {
		t.Fatalf("len = %d, want 1", len(got))
	}
	r := got[0]
	if r.Id != id || r.Code != "#LMN-1000" || r.CustomerName != "Nguyễn An" ||
		string(r.Status) != string(order.Printing) || r.Total != 445000 || !r.CreatedAt.Equal(at) {
		t.Fatalf("row mapped wrong: %+v", r)
	}
}
