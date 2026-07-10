package httpapi

import (
	"context"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/testcontainers/testcontainers-go/wait"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/order"
)

// Integration tests for the TransitionOrder handler end to end against real Postgres. They drive
// the handler method directly (the auth middleware is unit-tested separately) with an owner actor
// injected as the boundary would, walking one order PENDING_CONFIRM→PAID→PRINTING→SHIPPING to
// prove: the dispatch footgun (reconcile emits exactly one order.paid, non-money edges emit none —
// PAY-01), and SHIPPING persists its tracking code + QC photo atomically with the status flip (SHP-01).
// testcontainers: skips local (no Docker), runs in CI (ADR-020). The Postgres bring-up mirrors
// internal/db's helper — duplicated because that one is unexported test code in another package.

func skipWithoutDocker(t *testing.T) {
	t.Helper()
	defer func() {
		if r := recover(); r != nil {
			t.Skipf("no healthy Docker provider, skipping integration test: %v", r)
		}
	}()
	testcontainers.SkipIfProviderIsNotHealthy(t)
}

func startPostgres(t *testing.T) *pgxpool.Pool {
	t.Helper()
	skipWithoutDocker(t)
	ctx := context.Background()
	ctr, err := postgres.Run(ctx, "postgres:16-alpine",
		postgres.WithDatabase("lumin_test"),
		postgres.WithUsername("lumin"),
		postgres.WithPassword("lumin"),
		testcontainers.WithWaitStrategy(
			wait.ForLog("database system is ready to accept connections").
				WithOccurrence(2).WithStartupTimeout(60*time.Second)),
	)
	if err != nil {
		t.Fatalf("start postgres container: %v", err)
	}
	t.Cleanup(func() { _ = ctr.Terminate(context.Background()) })

	dsn, err := ctr.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		t.Fatalf("connection string: %v", err)
	}
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("open pool: %v", err)
	}
	t.Cleanup(pool.Close)

	files, err := filepath.Glob(filepath.Join("..", "..", "db", "migrations", "*.up.sql"))
	if err != nil {
		t.Fatalf("glob migrations: %v", err)
	}
	sort.Strings(files)
	for _, f := range files {
		stmts, rerr := os.ReadFile(f)
		if rerr != nil {
			t.Fatalf("read %s: %v", f, rerr)
		}
		if _, eerr := pool.Exec(ctx, string(stmts)); eerr != nil {
			t.Fatalf("apply %s: %v", filepath.Base(f), eerr)
		}
	}
	return pool
}

// seedPendingWebOrder inserts a customer, a product and a PENDING_CONFIRM web order (one item),
// returning the order id. Uses the exported db seams so the row is exactly what production writes.
func seedPendingWebOrder(t *testing.T, ctx context.Context, pool *pgxpool.Pool) uuid.UUID {
	t.Helper()
	idn := db.NewIdentity(pool)
	cat := db.NewCatalog(pool)

	cust, err := idn.CreateCustomer(ctx, sqlc.InsertCustomerParams{
		ID: uuid.New(), Name: "Nguyễn An", Phone: "0901234567",
		Addresses: []byte(`[{"province":"Hà Nội","ward":"Cửa Nam","street":"12 Lý Thường Kiệt"}]`),
	})
	if err != nil {
		t.Fatalf("seed customer: %v", err)
	}
	cate, err := cat.CreateCategory(ctx, sqlc.InsertCategoryParams{ID: uuid.New(), Slug: "den", Name: "Đèn"})
	if err != nil {
		t.Fatalf("seed category: %v", err)
	}
	prod, err := cat.CreateProduct(ctx, sqlc.InsertProductParams{
		ID: uuid.New(), Slug: "den-nam", Name: "Đèn nấm", Description: "ấm áp", CategoryID: cate.ID,
		BasePrice: 390_000, Dimensions: []byte(`{"w":180,"d":180,"h":240}`), Material: "PLA",
		Model3dUrl: "https://x/m.glb", Images: []byte(`["https://x/1.jpg"]`), Status: sqlc.ProductStatusActive,
	})
	if err != nil {
		t.Fatalf("seed product: %v", err)
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	orderID := uuid.New()
	code, err := db.NewOrders(tx).NextOrderCode(ctx)
	if err != nil {
		t.Fatalf("next code: %v", err)
	}
	_, err = db.CreateOrderTx(ctx, tx, db.CreateOrderInput{
		ID: orderID, Code: code, Channel: order.ChannelWeb, CustomerID: cust.ID,
		ShippingAddress: order.Address{Province: "Hà Nội", Ward: "Cửa Nam", Street: "12 Lý Thường Kiệt"},
		Items:           []db.NewOrderItem{{ProductID: prod.ID, Quantity: 1, UnitPrice: 390_000}},
		ShippingFee:     30_000,
		PaymentProofURL: "https://cdn/x.jpg",
		At:              "2026-07-01T08:00:00Z", ByUser: "customer",
	})
	if err != nil {
		t.Fatalf("seed order: %v", err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("commit: %v", err)
	}
	return orderID
}

func ownerActorCtx() context.Context {
	return withActor(context.Background(), Actor{ByUser: uuid.NewString(), Role: order.RoleOwner, At: time.Now().UTC()})
}

func countPaidEvents(t *testing.T, ctx context.Context, pool *pgxpool.Pool, orderID uuid.UUID) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM outbox WHERE aggregate_id=$1 AND event_type='order.paid'`, orderID).Scan(&n); err != nil {
		t.Fatalf("count order.paid: %v", err)
	}
	return n
}

func mustTransition(t *testing.T, srv *Server, ctx context.Context, id uuid.UUID, to api.OrderStatus, tracking, qc *string) api.Order {
	t.Helper()
	resp, err := srv.TransitionOrder(ctx, api.TransitionOrderRequestObject{
		Id: id, Body: &api.TransitionRequest{To: to, TrackingCode: tracking, QcPhotoUrl: qc},
	})
	if err != nil {
		t.Fatalf("transition →%s: %v", to, err)
	}
	ok, isOK := resp.(api.TransitionOrder200JSONResponse)
	if !isOK {
		t.Fatalf("transition →%s resp = %T, want 200 Order", to, resp)
	}
	return api.Order(ok)
}

// PAY-01 + SHP-01: an owner walks an order through its money-in reconcile and on to SHIPPING. The
// reconcile emits exactly one order.paid; the two non-money edges emit none; SHIPPING persists its
// tracking code atomically with the flip.
func TestTransitionWalkEmitsPaidOnceAndPersistsTracking(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()
	orderID := seedPendingWebOrder(t, ctx, pool)
	srv := NewServer(slog.New(slog.NewTextHandler(io.Discard, nil)), pool, nil, nil)

	// PENDING_CONFIRM → PAID (money-in reconcile via ConfirmPaymentTx).
	paid := mustTransition(t, srv, ownerActorCtx(), orderID, "PAID", nil, nil)
	if paid.Status != "PAID" {
		t.Fatalf("status = %s, want PAID", paid.Status)
	}
	if paid.PaymentConfirmedAt == nil {
		t.Fatal("paymentConfirmedAt not stamped on reconcile")
	}
	if n := countPaidEvents(t, ctx, pool, orderID); n != 1 {
		t.Fatalf("order.paid after reconcile = %d, want exactly 1 (PAY-01)", n)
	}

	// PAID → PRINTING (non-money edge via AdvanceStatusTx — must NOT emit order.paid).
	if got := mustTransition(t, srv, ownerActorCtx(), orderID, "PRINTING", nil, nil); got.Status != "PRINTING" {
		t.Fatalf("status = %s, want PRINTING", got.Status)
	}
	if n := countPaidEvents(t, ctx, pool, orderID); n != 1 {
		t.Fatalf("order.paid after PRINTING = %d, want still 1 (footgun: AdvanceStatusTx emits none)", n)
	}

	// PRINTING → SHIPPING with a tracking code + QC photo (flip + both artifacts atomic).
	const qcURL = "https://cdn.lumin.test/qc/pack.jpg"
	shipped := mustTransition(t, srv, ownerActorCtx(), orderID, "SHIPPING", strp("VN-TRACK-123"), strp(qcURL))
	if shipped.Status != "SHIPPING" {
		t.Fatalf("status = %s, want SHIPPING", shipped.Status)
	}
	if shipped.TrackingCode == nil || *shipped.TrackingCode != "VN-TRACK-123" {
		t.Fatalf("DTO trackingCode = %v, want VN-TRACK-123", shipped.TrackingCode)
	}
	if shipped.QcPhotoUrl == nil || *shipped.QcPhotoUrl != qcURL {
		t.Fatalf("DTO qcPhotoUrl = %v, want %q", shipped.QcPhotoUrl, qcURL)
	}
	var persisted, persistedQC *string
	if err := pool.QueryRow(ctx, `SELECT tracking_code, qc_photo_url FROM orders WHERE id=$1`, orderID).Scan(&persisted, &persistedQC); err != nil {
		t.Fatalf("read shipping artifacts: %v", err)
	}
	if persisted == nil || *persisted != "VN-TRACK-123" {
		t.Fatalf("persisted tracking_code = %v, want VN-TRACK-123", persisted)
	}
	if persistedQC == nil || *persistedQC != qcURL {
		t.Fatalf("persisted qc_photo_url = %v, want %q", persistedQC, qcURL)
	}
	if n := countPaidEvents(t, ctx, pool, orderID); n != 1 {
		t.Fatalf("order.paid after SHIPPING = %d, want still 1", n)
	}
	// The nested DTO assembled from real rows carries the customer and the priced item.
	if shipped.Customer.Phone != "0901234567" || len(shipped.Items) != 1 || shipped.Items[0].UnitPrice != 390_000 {
		t.Fatalf("assembled DTO mismatch: customer=%+v items=%+v", shipped.Customer, shipped.Items)
	}
}

// An invalid edge and a transition on a missing order map to their ADR-032 statuses at the
// boundary (409 INVALID_EDGE / 404 NOT_FOUND) rather than a 500.
func TestTransitionErrorsMapToEnvelope(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()
	srv := NewServer(slog.New(slog.NewTextHandler(io.Discard, nil)), pool, nil, nil)

	// Missing order → 404.
	_, err := srv.TransitionOrder(ownerActorCtx(), api.TransitionOrderRequestObject{
		Id: uuid.New(), Body: &api.TransitionRequest{To: "PRINTING"},
	})
	if status, _ := mapError(err); status != 404 {
		t.Fatalf("missing-order status = %d, want 404 (err=%v)", status, err)
	}

	// Invalid edge (PENDING_CONFIRM → SHIPPING) on a real order → 409 INVALID_EDGE. Both SHIPPING
	// boundary artifacts (trackingCode + qcPhotoUrl) are supplied so the request clears the HTTP-edge
	// checks and the DOMAIN edge guard is what rejects it (not a 422 artifact-missing).
	orderID := seedPendingWebOrder(t, ctx, pool)
	_, err = srv.TransitionOrder(ownerActorCtx(), api.TransitionOrderRequestObject{
		Id: orderID, Body: &api.TransitionRequest{To: "SHIPPING", TrackingCode: strp("VN1"), QcPhotoUrl: strp("https://cdn/qc.jpg")},
	})
	if status, env := mapError(err); status != 409 || env.Code != string(order.ErrInvalidEdge) {
		t.Fatalf("invalid-edge = %d/%s, want 409/INVALID_EDGE (err=%v)", status, env.Code, err)
	}
}
