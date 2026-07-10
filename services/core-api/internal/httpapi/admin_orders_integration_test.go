package httpapi

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/order"
)

// TestGetAdminOrdersEndToEnd exercises the full GetAdminOrders handler over a real Postgres: seed three
// orders (a 2-item web order, a 1-item inbox order, a 1-item web order) with distinct created_at, then
// assert the list newest-first, the status filter, the pagination envelope, and the joined DTO fields
// (customer name + first-item name + item count + channel). Proves the route is wired, the two reads run,
// and the DTO assembles from the join. The pure slot-wiring is covered Docker-free in TestAdminOrderSummariesDTO.
func TestGetAdminOrdersEndToEnd(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()

	catID := seedCategory(t, ctx, pool)
	mochi := seedProductNamed(t, ctx, pool, catID, "mochi", "Đèn Mochi", 390_000)
	origami := seedProductNamed(t, ctx, pool, catID, "origami", "Kệ Origami", 120_000)

	// A: newest, 2-item web order (PENDING_CONFIRM), total = 390k + 120k + 30k ship = 540k.
	orderA := seedAdminOrder(t, ctx, pool, adminOrderSeed{
		customer: "Nguyễn An", channel: order.ChannelWeb, createdAt: "2026-07-03T08:00:00Z",
		items: []db.NewOrderItem{{ProductID: mochi, Quantity: 1, UnitPrice: 390_000}, {ProductID: origami, Quantity: 1, UnitPrice: 120_000}},
	})
	// B: middle, 1-item inbox order → born PAID.
	seedAdminOrder(t, ctx, pool, adminOrderSeed{
		customer: "Trần Bình", channel: order.ChannelInbox, createdAt: "2026-07-02T08:00:00Z",
		items: []db.NewOrderItem{{ProductID: mochi, Quantity: 1, UnitPrice: 390_000}},
	})
	// C: oldest, 1-item web order (PENDING_CONFIRM).
	seedAdminOrder(t, ctx, pool, adminOrderSeed{
		customer: "Lê Cúc", channel: order.ChannelWeb, createdAt: "2026-07-01T08:00:00Z",
		items: []db.NewOrderItem{{ProductID: origami, Quantity: 1, UnitPrice: 120_000}},
	})

	srv := NewServer(slog.New(slog.NewTextHandler(io.Discard, nil)), pool, nil, nil)

	// --- No filter: all three, newest-first (created_at DESC). ---
	all := listAdmin(t, srv, ctx, api.GetAdminOrdersParams{})
	if all.Total != 3 || len(all.Items) != 3 {
		t.Fatalf("no filter: total=%d len=%d, want 3/3", all.Total, len(all.Items))
	}
	if all.Items[0].CustomerName != "Nguyễn An" || all.Items[1].CustomerName != "Trần Bình" || all.Items[2].CustomerName != "Lê Cúc" {
		t.Fatalf("order not newest-first: %s, %s, %s", all.Items[0].CustomerName, all.Items[1].CustomerName, all.Items[2].CustomerName)
	}

	// --- DTO fields on the 2-item web order A. ---
	a := all.Items[0]
	if a.Id != orderA || a.ItemCount != 2 || a.Total != 540_000 ||
		string(a.Channel) != string(order.ChannelWeb) || string(a.Status) != string(order.PendingConfirm) {
		t.Fatalf("order A DTO wrong: %+v (want itemCount 2, total 540000, web, PENDING_CONFIRM)", a)
	}
	if a.FirstItemName != "Đèn Mochi" && a.FirstItemName != "Kệ Origami" {
		t.Fatalf("order A firstItemName = %q, want one of the two seeded item names", a.FirstItemName)
	}
	// The inbox order is born PAID and carries channel=inbox.
	b := all.Items[1]
	if string(b.Channel) != string(order.ChannelInbox) || string(b.Status) != string(order.Paid) ||
		b.ItemCount != 1 || b.FirstItemName != "Đèn Mochi" {
		t.Fatalf("order B DTO wrong: %+v (want inbox, PAID, itemCount 1, 'Đèn Mochi')", b)
	}

	// --- Status filter: PENDING_CONFIRM matches only the two web orders (A, C). ---
	pending := order.PendingConfirm
	stParam := api.OrderStatus(pending)
	filtered := listAdmin(t, srv, ctx, api.GetAdminOrdersParams{Status: &stParam})
	if filtered.Total != 2 || len(filtered.Items) != 2 {
		t.Fatalf("filter PENDING_CONFIRM: total=%d len=%d, want 2/2", filtered.Total, len(filtered.Items))
	}
	for _, it := range filtered.Items {
		if string(it.Status) != string(order.PendingConfirm) {
			t.Fatalf("filtered row has status %s, want PENDING_CONFIRM", it.Status)
		}
	}

	// --- Pagination: pageSize 2 → page 1 has [A,B], page 2 has [C]; total stays 3 on both. ---
	p1, ps2 := 1, 2
	page1 := listAdmin(t, srv, ctx, api.GetAdminOrdersParams{Page: &p1, PageSize: &ps2})
	if page1.Total != 3 || len(page1.Items) != 2 || page1.Items[0].CustomerName != "Nguyễn An" {
		t.Fatalf("page 1: total=%d len=%d first=%q, want 3/2/'Nguyễn An'", page1.Total, len(page1.Items), page1.Items[0].CustomerName)
	}
	p2 := 2
	page2 := listAdmin(t, srv, ctx, api.GetAdminOrdersParams{Page: &p2, PageSize: &ps2})
	if page2.Total != 3 || len(page2.Items) != 1 || page2.Items[0].CustomerName != "Lê Cúc" {
		t.Fatalf("page 2: total=%d len=%d first=%q, want 3/1/'Lê Cúc'", page2.Total, len(page2.Items), page2.Items[0].CustomerName)
	}
}

// TestGetAdminOrdersEmptyIsRenderable: no orders → an empty (non-nil) items slice + total 0, so the JSON
// renders `{"items":[],...}` not null (spec §03 zero-state), and a status filter that matches nothing is 0.
func TestGetAdminOrdersEmptyIsRenderable(t *testing.T) {
	pool := startPostgres(t)
	srv := NewServer(slog.New(slog.NewTextHandler(io.Discard, nil)), pool, nil, nil)
	got := listAdmin(t, srv, context.Background(), api.GetAdminOrdersParams{})
	if got.Total != 0 || got.Items == nil || len(got.Items) != 0 {
		t.Fatalf("empty DB = total %d items %#v, want total 0 + non-nil empty slice", got.Total, got.Items)
	}
}

// TestGetAdminOrdersRejectsBadInput: a page below 1 and a status outside the enum are both 400 (the
// runtime bounds oapi-codegen skips), proven end-to-end so the reject happens before any read.
func TestGetAdminOrdersRejectsBadInput(t *testing.T) {
	pool := startPostgres(t)
	srv := NewServer(slog.New(slog.NewTextHandler(io.Discard, nil)), pool, nil, nil)
	ctx := context.Background()

	badPage := 0
	if resp, _ := srv.GetAdminOrders(ctx, api.GetAdminOrdersRequestObject{Params: api.GetAdminOrdersParams{Page: &badPage}}); !is400(resp) {
		t.Fatalf("page 0 → %T, want GetAdminOrders400JSONResponse", resp)
	}
	bogus := api.OrderStatus("NOT_A_STATUS")
	if resp, _ := srv.GetAdminOrders(ctx, api.GetAdminOrdersRequestObject{Params: api.GetAdminOrdersParams{Status: &bogus}}); !is400(resp) {
		t.Fatalf("bogus status → %T, want GetAdminOrders400JSONResponse", resp)
	}
}

func is400(resp api.GetAdminOrdersResponseObject) bool {
	_, ok := resp.(api.GetAdminOrders400JSONResponse)
	return ok
}

// listAdmin calls the handler and unwraps the 200 body, failing on any other outcome.
func listAdmin(t *testing.T, srv *Server, ctx context.Context, params api.GetAdminOrdersParams) api.AdminOrderList {
	t.Helper()
	resp, err := srv.GetAdminOrders(ctx, api.GetAdminOrdersRequestObject{Params: params})
	if err != nil {
		t.Fatalf("GetAdminOrders: %v", err)
	}
	ok, isOK := resp.(api.GetAdminOrders200JSONResponse)
	if !isOK {
		t.Fatalf("response type = %T, want GetAdminOrders200JSONResponse", resp)
	}
	return api.AdminOrderList(ok)
}

// TestGetAdminOrderEndToEnd exercises GetAdminOrder over a real Postgres: seed a 2-item web order, read it
// by id, and assert the FULL internal detail the admin table row (P3-b summary) does not carry — customer
// PII (name + phone), the line items, the money (subtotal/shippingFee/total, raw int-VND), the payment
// proof url, and the complete statusHistory (the born PENDING_CONFIRM event with its actor). Then a random
// id returns db.ErrNotFound (→ 404 at the boundary, no leak). The pure row→DTO mapping is pinned Docker-free
// in TestToOrderDTOFullMapping; this proves the route is wired and assembleOrderDTO reads items + customer.
func TestGetAdminOrderEndToEnd(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()

	catID := seedCategory(t, ctx, pool)
	mochi := seedProductNamed(t, ctx, pool, catID, "mochi", "Đèn Mochi", 390_000)
	origami := seedProductNamed(t, ctx, pool, catID, "origami", "Kệ Origami", 120_000)

	orderID := seedAdminOrder(t, ctx, pool, adminOrderSeed{
		customer: "Nguyễn An", channel: order.ChannelWeb, createdAt: "2026-07-03T08:00:00Z",
		items: []db.NewOrderItem{
			{ProductID: mochi, Quantity: 1, UnitPrice: 390_000},
			{ProductID: origami, Quantity: 1, UnitPrice: 120_000},
		},
	})

	srv := NewServer(slog.New(slog.NewTextHandler(io.Discard, nil)), pool, nil, nil)
	got := getAdminOrder(t, srv, ctx, orderID)

	// Header: web order born PENDING_CONFIRM, with its display code.
	if got.Id != orderID || got.Code == "" ||
		string(got.Channel) != string(order.ChannelWeb) || string(got.Status) != string(order.PendingConfirm) {
		t.Fatalf("order header wrong: id=%v code=%q channel=%s status=%s", got.Id, got.Code, got.Channel, got.Status)
	}
	// Customer PII + shipping address — the fields the public PublicOrderTimeline whitelist omits (ADR-032).
	if got.Customer.Name != "Nguyễn An" || got.Customer.Phone != "0901234567" {
		t.Fatalf("customer PII wrong: %+v", got.Customer)
	}
	if got.ShippingAddress.Province != "Hà Nội" || got.ShippingAddress.Ward != "Cửa Nam" {
		t.Fatalf("shipping address wrong: %+v", got.ShippingAddress)
	}
	// Both seeded line items are present.
	if len(got.Items) != 2 {
		t.Fatalf("items = %d, want 2", len(got.Items))
	}
	// Money, raw int-VND (server-computed, never formatted here): subtotal 510k + ship 30k = total 540k.
	if got.Subtotal != 510_000 || got.ShippingFee != 30_000 || got.Total != 540_000 {
		t.Fatalf("money wrong: subtotal=%d ship=%d total=%d, want 510000/30000/540000", got.Subtotal, got.ShippingFee, got.Total)
	}
	// Payment proof url present (web order born with a receipt) — omitted by the public timeline.
	if got.PaymentProofUrl == nil || *got.PaymentProofUrl == "" {
		t.Fatalf("paymentProofUrl = %v, want the seeded receipt url", got.PaymentProofUrl)
	}
	// statusHistory carries the born PENDING_CONFIRM event WITH its actor — the public timeline drops byUser.
	if len(got.StatusHistory) != 1 || string(got.StatusHistory[0].To) != string(order.PendingConfirm) ||
		got.StatusHistory[0].ByUser != "seed" {
		t.Fatalf("statusHistory wrong: %+v", got.StatusHistory)
	}

	// Unknown id → db.ErrNotFound, which mapError renders as a uniform 404 NOT_FOUND (no leak).
	if _, err := srv.GetAdminOrder(ctx, api.GetAdminOrderRequestObject{Id: uuid.New()}); !errors.Is(err, db.ErrNotFound) {
		t.Fatalf("unknown id → err %v, want db.ErrNotFound (→ 404)", err)
	}
}

// getAdminOrder calls the detail handler and unwraps the 200 Order body, failing on any other outcome.
func getAdminOrder(t *testing.T, srv *Server, ctx context.Context, id uuid.UUID) api.Order {
	t.Helper()
	resp, err := srv.GetAdminOrder(ctx, api.GetAdminOrderRequestObject{Id: id})
	if err != nil {
		t.Fatalf("GetAdminOrder: %v", err)
	}
	ok, isOK := resp.(api.GetAdminOrder200JSONResponse)
	if !isOK {
		t.Fatalf("response type = %T, want GetAdminOrder200JSONResponse", resp)
	}
	return api.Order(ok)
}

func seedCategory(t *testing.T, ctx context.Context, pool *pgxpool.Pool) uuid.UUID {
	t.Helper()
	cate, err := db.NewCatalog(pool).CreateCategory(ctx, sqlc.InsertCategoryParams{ID: uuid.New(), Slug: "den", Name: "Đèn"})
	if err != nil {
		t.Fatalf("seed category: %v", err)
	}
	return cate.ID
}

func seedProductNamed(t *testing.T, ctx context.Context, pool *pgxpool.Pool, catID uuid.UUID, slug, name string, price int64) uuid.UUID {
	t.Helper()
	p, err := db.NewCatalog(pool).CreateProduct(ctx, sqlc.InsertProductParams{
		ID: uuid.New(), Slug: slug, Name: name, Description: "x", CategoryID: catID,
		BasePrice: price, Dimensions: []byte(`{"w":180,"d":180,"h":240}`), Material: "PLA",
		Model3dUrl: "https://x/m.glb", Images: []byte(`["https://x/1.jpg"]`), Status: sqlc.ProductStatusActive,
	})
	if err != nil {
		t.Fatalf("seed product %s: %v", slug, err)
	}
	return p.ID
}

type adminOrderSeed struct {
	customer  string
	channel   order.Channel
	createdAt string // RFC3339 — set explicitly so the newest-first ordering is deterministic
	items     []db.NewOrderItem
}

// seedAdminOrder creates a customer + an order (via the production CreateOrderTx seam so the born status
// matches the channel: web → PENDING_CONFIRM, inbox → PAID) with the given items, then stamps created_at to
// the requested instant so the list's created_at-DESC ordering is deterministic across seeds. Returns the
// order id.
func seedAdminOrder(t *testing.T, ctx context.Context, pool *pgxpool.Pool, s adminOrderSeed) uuid.UUID {
	t.Helper()
	cust, err := db.NewIdentity(pool).CreateCustomer(ctx, sqlc.InsertCustomerParams{
		ID: uuid.New(), Name: s.customer, Phone: "0901234567", Addresses: []byte(`[]`),
	})
	if err != nil {
		t.Fatalf("seed customer %s: %v", s.customer, err)
	}

	proof := ""
	if s.channel == order.ChannelWeb {
		proof = "https://cdn/x.jpg" // web is born PENDING_CONFIRM only with a receipt (InitialStatusForChannel)
	}
	orderID := uuid.New()
	if err := pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		code, cerr := db.NewOrders(tx).NextOrderCode(ctx)
		if cerr != nil {
			return cerr
		}
		_, cerr = db.CreateOrderTx(ctx, tx, db.CreateOrderInput{
			ID: orderID, Code: code, Channel: s.channel, CustomerID: cust.ID,
			ShippingAddress: order.Address{Province: "Hà Nội", Ward: "Cửa Nam", Street: "12 Lý Thường Kiệt"},
			Items:           s.items, ShippingFee: 30_000, PaymentProofURL: proof,
			At: "2026-07-01T08:00:00Z", ByUser: "seed",
		})
		return cerr
	}); err != nil {
		t.Fatalf("seed order (%s): %v", s.customer, err)
	}

	at, perr := time.Parse(time.RFC3339, s.createdAt)
	if perr != nil {
		t.Fatalf("parse createdAt %q: %v", s.createdAt, perr)
	}
	if _, err := pool.Exec(ctx, `UPDATE orders SET created_at=$1 WHERE id=$2`, at, orderID); err != nil {
		t.Fatalf("stamp created_at: %v", err)
	}
	return orderID
}
