package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/order"
)

// TestGetAdminOrdersRequiresAuth proves the /admin/orders route is mounted AND admin-gated (classify →
// authRequired default): a request with no session cookie is rejected at the boundary with 401, before the
// handler runs — so it needs no DB (serverWithUsers has a nil pool). The classify table entry in
// TestClassifyFailsClosed locks the class; this locks the mounted route.
func TestGetAdminOrdersRequiresAuth(t *testing.T) {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/admin/orders", nil)
	testAuthedRouter(serverWithUsers(fakeUsers{})).ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("GET /admin/orders (no cookie) = %d, want 401 (admin-gated, fail-closed)", rec.Code)
	}
}

// TestAdminOrderSummariesDTO pins the row→DTO slot wiring with DISTINCT values in every field, so any swap
// (e.g. code↔customerName, channel↔status) or a mis-widened enum fails. Pure — runs in the Docker-free lane.
func TestAdminOrderSummariesDTO(t *testing.T) {
	id := uuid.New()
	at := mustParse(t, "2026-07-02T09:00:00Z")
	rows := []sqlc.ListAdminOrdersRow{{
		ID:            id,
		Code:          "#LMN-2048",
		CustomerName:  "Nguyễn An",
		Channel:       order.ChannelWeb,
		Status:        order.Printing,
		Total:         445_000,
		CreatedAt:     pgtype.Timestamptz{Time: at, Valid: true},
		FirstItemName: "Đèn Mochi",
		ItemCount:     2,
	}}
	got := adminOrderSummariesDTO(rows)
	if len(got) != 1 {
		t.Fatalf("len = %d, want 1", len(got))
	}
	r := got[0]
	if r.Id != id || r.Code != "#LMN-2048" || r.CustomerName != "Nguyễn An" ||
		r.FirstItemName != "Đèn Mochi" || r.ItemCount != 2 ||
		string(r.Channel) != string(order.ChannelWeb) || string(r.Status) != string(order.Printing) ||
		r.Total != 445_000 || !r.CreatedAt.Equal(at) {
		t.Fatalf("row mapped wrong: %+v", r)
	}
}

// adminOrderSummariesDTO must render an empty result as a non-nil slice so the JSON is `[]`, not `null`
// (spec §03 zero-state — render, never blank).
func TestAdminOrderSummariesDTOEmptyIsNonNil(t *testing.T) {
	if got := adminOrderSummariesDTO(nil); got == nil {
		t.Fatal("adminOrderSummariesDTO(nil) = nil, want non-nil empty slice (renders [], not null)")
	}
	if got := adminOrderSummariesDTO([]sqlc.ListAdminOrdersRow{}); len(got) != 0 || got == nil {
		t.Fatalf("adminOrderSummariesDTO([]) = %v, want non-nil empty", got)
	}
}

// TestAdminOrdersPageParams covers the defaults for omitted params and the bounds oapi-codegen does not
// enforce (page < 1, pageSize < 1, pageSize > max are all 400 at the call site).
func TestAdminOrdersPageParams(t *testing.T) {
	intp := func(n int) *int { return &n }
	cases := []struct {
		name         string
		page, size   *int
		wantPage     int
		wantPageSize int
		wantOK       bool
	}{
		{"defaults when omitted", nil, nil, 1, adminOrdersDefaultPageSize, true},
		{"explicit within bounds", intp(3), intp(10), 3, 10, true},
		{"max page size ok", intp(1), intp(adminOrdersMaxPageSize), 1, adminOrdersMaxPageSize, true},
		{"page below 1 rejected", intp(0), nil, 0, 0, false},
		{"page size below 1 rejected", intp(1), intp(0), 0, 0, false},
		{"page size over max rejected", intp(1), intp(adminOrdersMaxPageSize + 1), 0, 0, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			page, size, ok := adminOrdersPageParams(tc.page, tc.size)
			if ok != tc.wantOK || page != tc.wantPage || size != tc.wantPageSize {
				t.Fatalf("adminOrdersPageParams(%v,%v) = (%d,%d,%v), want (%d,%d,%v)",
					tc.page, tc.size, page, size, ok, tc.wantPage, tc.wantPageSize, tc.wantOK)
			}
		})
	}
}

// TestAdminOrdersStatusFilter: nil → nil (all statuses); every OrderStatus enum value is accepted; an
// unknown token is rejected (400) so it can never reach the query's `::order_status` cast or silently
// widen the filter to "all".
func TestAdminOrdersStatusFilter(t *testing.T) {
	if got, ok := adminOrdersStatusFilter(nil); got != nil || !ok {
		t.Fatalf("nil param = (%v,%v), want (nil,true) — all statuses", got, ok)
	}
	for _, s := range order.Statuses {
		p := api.OrderStatus(s)
		got, ok := adminOrdersStatusFilter(&p)
		if !ok || got == nil || *got != s {
			t.Fatalf("status %q = (%v,%v), want (&%q,true)", s, got, ok, s)
		}
	}
	bogus := api.OrderStatus("NOT_A_STATUS")
	if got, ok := adminOrdersStatusFilter(&bogus); ok || got != nil {
		t.Fatalf("bogus status = (%v,%v), want (nil,false) — 400", got, ok)
	}
}
