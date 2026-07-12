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

// Integration tests for the P3-p customers surface against real Postgres (testcontainers: skip local
// without Docker, run in CI — ADR-020). They prove the load-bearing properties the pure DTO tests can't:
// the LEFT JOIN aggregate (a customer with no orders still appears with zeroed roll-up), the
// most-recently-active ordering (NULLS LAST puts an order-less customer last), the detail's real
// customer→orders join (newest-first history + server-summed spend + decoded addresses), and an unknown
// id → db.ErrNotFound (→ 404 at the boundary, no leak).

func TestAdminCustomersEndToEnd(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()
	owner := ownerCtx()
	srv := NewServer(slog.New(slog.NewTextHandler(io.Discard, nil)), pool, nil, nil)

	catID := seedCategory(t, ctx, pool)
	prodID := seedProductNamed(t, ctx, pool, catID, "den-mochi", "Đèn Mochi", 200_000)

	// Customer A: contact extras + a saved address + two orders at distinct instants.
	anEmail, anSocial := "an@gmail.com", "m.me/an.79"
	custA := seedCustomerRow(t, ctx, pool, "Nguyễn An", "0901234567", &anEmail, &anSocial,
		[]byte(`[{"province":"TP.HCM","ward":"Bến Thành","street":"123 Lê Lợi"}]`))
	spentA := seedCustomerOrder(t, ctx, pool, prodID, custA, 200_000, "2026-06-10T08:00:00Z") +
		seedCustomerOrder(t, ctx, pool, prodID, custA, 445_000, "2026-06-18T08:00:00Z")

	// Customer B: NO orders (the LEFT JOIN zero case) + no contact extras.
	custB := seedCustomerRow(t, ctx, pool, "Lê Cúc", "0907888222", nil, nil, []byte(`[]`))

	// --- list: both customers; A first (a recent order), B last (no order → NULLS LAST) ---
	list := adminCustomers(t, srv, owner)
	if len(list) != 2 {
		t.Fatalf("list = %d customers, want 2", len(list))
	}
	if list[0].Id != custA || list[0].OrderCount != 2 || list[0].TotalSpent != spentA {
		t.Fatalf("list[0] = %+v, want custA count 2 spent %d", list[0], spentA)
	}
	if list[0].LastOrderAt == nil {
		t.Fatal("custA lastOrderAt should be set (they have orders)")
	}
	if list[1].Id != custB || list[1].OrderCount != 0 || list[1].TotalSpent != 0 || list[1].LastOrderAt != nil {
		t.Fatalf("list[1] = %+v, want custB with zero aggregates + no last order", list[1])
	}

	// --- detail(A): contact + decoded address + summed spend + 2 orders newest-first ---
	d := adminCustomerDetail(t, srv, owner, custA)
	if d.Id != custA || d.Email == nil || string(*d.Email) != anEmail || d.SocialHandle == nil || *d.SocialHandle != anSocial {
		t.Fatalf("detail contact = %+v", d)
	}
	if len(d.Addresses) != 1 || d.Addresses[0].Street != "123 Lê Lợi" {
		t.Fatalf("detail addresses = %+v", d.Addresses)
	}
	if d.TotalSpent != spentA {
		t.Fatalf("detail totalSpent = %d, want %d (server-summed)", d.TotalSpent, spentA)
	}
	if len(d.Orders) != 2 || d.Orders[0].CreatedAt.Before(d.Orders[1].CreatedAt) {
		t.Fatalf("detail orders not newest-first: %+v", d.Orders)
	}

	// --- detail(unknown id) → db.ErrNotFound (→ 404, no leak), never an empty 200 ---
	if _, err := srv.GetAdminCustomer(owner, api.GetAdminCustomerRequestObject{Id: uuid.New()}); !errors.Is(err, db.ErrNotFound) {
		t.Fatalf("unknown customer → err %v, want db.ErrNotFound (→ 404)", err)
	}
}

// seedCustomerRow inserts a bare customer (contact + saved addresses jsonb) and returns its id.
func seedCustomerRow(t *testing.T, ctx context.Context, pool *pgxpool.Pool, name, phone string, email, social *string, addresses []byte) uuid.UUID {
	t.Helper()
	c, err := db.NewIdentity(pool).CreateCustomer(ctx, sqlc.InsertCustomerParams{
		ID: uuid.New(), Name: name, Phone: phone, Email: email, SocialHandle: social, Addresses: addresses,
	})
	if err != nil {
		t.Fatalf("seed customer %s: %v", name, err)
	}
	return c.ID
}

// seedCustomerOrder creates one inbox order (born PAID) for the given customer via the production
// CreateOrderTx seam, stamps its created_at so the newest-first ordering is deterministic, and returns
// the server-computed total (unit price + shipping fee) so the aggregate assertions stay decoupled from
// the pricing math.
func seedCustomerOrder(t *testing.T, ctx context.Context, pool *pgxpool.Pool, prodID, custID uuid.UUID, unitPrice int64, createdAt string) int64 {
	t.Helper()
	var total int64
	orderID := uuid.New()
	if err := pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		code, cerr := db.NewOrders(tx).NextOrderCode(ctx)
		if cerr != nil {
			return cerr
		}
		o, cerr := db.CreateOrderTx(ctx, tx, db.CreateOrderInput{
			ID: orderID, Code: code, Channel: order.ChannelInbox, CustomerID: custID,
			ShippingAddress: order.Address{Province: "Hà Nội", Ward: "Cửa Nam", Street: "12 Lý Thường Kiệt"},
			Items:           []db.NewOrderItem{{ProductID: prodID, Quantity: 1, UnitPrice: unitPrice}},
			ShippingFee:     30_000, At: "2026-07-01T08:00:00Z", ByUser: "seed",
		})
		total = o.Total
		return cerr
	}); err != nil {
		t.Fatalf("seed order for %s: %v", custID, err)
	}
	at, perr := time.Parse(time.RFC3339, createdAt)
	if perr != nil {
		t.Fatalf("parse createdAt %q: %v", createdAt, perr)
	}
	if _, err := pool.Exec(ctx, `UPDATE orders SET created_at=$1 WHERE id=$2`, at, orderID); err != nil {
		t.Fatalf("stamp created_at: %v", err)
	}
	return total
}

// adminCustomers drives GetAdminCustomers and returns the roster.
func adminCustomers(t *testing.T, srv *Server, ctx context.Context) []api.AdminCustomer {
	t.Helper()
	resp, err := srv.GetAdminCustomers(ctx, api.GetAdminCustomersRequestObject{})
	if err != nil {
		t.Fatalf("list customers: %v", err)
	}
	list, ok := resp.(api.GetAdminCustomers200JSONResponse)
	if !ok {
		t.Fatalf("customers list resp = %T, want 200", resp)
	}
	return list
}

// adminCustomerDetail drives GetAdminCustomer and returns the profile.
func adminCustomerDetail(t *testing.T, srv *Server, ctx context.Context, id uuid.UUID) api.AdminCustomerDetail {
	t.Helper()
	resp, err := srv.GetAdminCustomer(ctx, api.GetAdminCustomerRequestObject{Id: id})
	if err != nil {
		t.Fatalf("customer detail: %v", err)
	}
	d, ok := resp.(api.GetAdminCustomer200JSONResponse)
	if !ok {
		t.Fatalf("customer detail resp = %T, want 200", resp)
	}
	return api.AdminCustomerDetail(d)
}
