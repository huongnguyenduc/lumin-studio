package db

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/order"
)

const orderAt = "2026-06-26T08:00:00.000Z"

var shipTo = order.Address{Province: "Hà Nội", Ward: "Cửa Nam", Street: "12 Hàng Bài"}

// seedOrderDeps creates the customer + product (+ one color) an order references.
func seedOrderDeps(t *testing.T, ctx context.Context, pool *pgxpool.Pool) (customerID, productID, colorID uuid.UUID) {
	t.Helper()
	cust := seedCustomer(t, ctx, NewIdentity(pool), "0905550000")
	prod := seedProduct(t, ctx, NewCatalog(pool), "den-spine", 250000)
	color, err := NewCatalog(pool).CreateColor(ctx, sqlc.InsertColorParams{
		ID: uuid.New(), ProductID: prod.ID, Name: "Kem sữa", Hex: "#f5f0e1", Available: true, PriceDelta: 0,
	})
	if err != nil {
		t.Fatalf("seed color: %v", err)
	}
	return cust.ID, prod.ID, color.ID
}

func mustBegin(t *testing.T, ctx context.Context, pool *pgxpool.Pool) pgx.Tx {
	t.Helper()
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	return tx
}

func isTransitionErr(t *testing.T, err error, want order.ErrorCode) {
	t.Helper()
	te := new(order.TransitionError)
	if !errors.As(err, &te) || te.Code != want {
		t.Fatalf("err = %v, want %s", err, want)
	}
}

// createCommittedWebOrder creates and commits a PENDING_CONFIRM web order with one item.
func createCommittedWebOrder(t *testing.T, ctx context.Context, pool *pgxpool.Pool, customerID, productID uuid.UUID) sqlc.Order {
	t.Helper()
	tx := mustBegin(t, ctx, pool)
	row, err := CreateOrderTx(ctx, tx, CreateOrderInput{
		ID: uuid.New(), Code: "LMN-" + uuid.NewString()[:8], Channel: order.ChannelWeb,
		CustomerID: customerID, ShippingAddress: shipTo,
		Items:           []NewOrderItem{{ProductID: productID, Quantity: 1, UnitPrice: 250000}},
		ShippingFee:     30000,
		PaymentProofURL: "https://cdn.lumin.vn/proof/abc.jpg",
		At:              orderAt, ByUser: "khach",
	})
	if err != nil {
		t.Fatalf("create order: %v", err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("commit: %v", err)
	}
	return row
}

func TestCreateWebOrderEmitsCreated(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()
	customerID, productID, colorID := seedOrderDeps(t, ctx, pool)

	tx := mustBegin(t, ctx, pool)
	code := "LMN-" + uuid.NewString()[:8]
	row, err := CreateOrderTx(ctx, tx, CreateOrderInput{
		ID: uuid.New(), Code: code, Channel: order.ChannelWeb,
		CustomerID: customerID, ShippingAddress: shipTo,
		Items: []NewOrderItem{
			{ProductID: productID, ColorID: &colorID, OptionIDs: []string{"opt1"},
				Personalization: &order.Personalization{Text: "Bống", ZoneID: "base-front"},
				Quantity:        2, UnitPrice: 250000},
			{ProductID: productID, Quantity: 1, UnitPrice: 120000},
		},
		ShippingFee:     30000,
		PaymentProofURL: "https://cdn.lumin.vn/proof/abc.jpg",
		At:              orderAt, ByUser: "khach",
	})
	if err != nil {
		t.Fatalf("create order: %v", err)
	}

	// Server-computed totals (ADR-019): 250000*2 + 120000*1 = 620000; + ship 30000 = 650000.
	if row.Subtotal != 620000 || row.ShippingFee != 30000 || row.Total != 650000 {
		t.Fatalf("totals = %d/%d/%d, want 620000/30000/650000", row.Subtotal, row.ShippingFee, row.Total)
	}
	if row.Status != order.PendingConfirm {
		t.Fatalf("status = %s, want PENDING_CONFIRM (web entry)", row.Status)
	}
	if row.PaymentConfirmedAt.Valid {
		t.Fatal("web order must NOT have payment_confirmed_at until reconcile")
	}
	if row.ShippingAddress != shipTo {
		t.Fatalf("shipping address round-trip = %+v, want %+v", row.ShippingAddress, shipTo)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("commit: %v", err)
	}

	// order.created emitted on the SAME tx (publish-on-commit).
	if n := countRows(t, ctx, pool, `SELECT count(*) FROM outbox WHERE aggregate_id=$1 AND event_type='order.created'`, row.ID); n != 1 {
		t.Fatalf("order.created rows = %d, want 1", n)
	}

	// Read-back: statusHistory replays to the persisted status; items + jsonb round-trip.
	back, err := NewOrders(pool).ByCode(ctx, code)
	if err != nil {
		t.Fatalf("by code: %v", err)
	}
	if got, err := order.ReplayStatus(back.StatusHistory); err != nil || got != back.Status {
		t.Fatalf("replay = %s (err %v), want %s", got, err, back.Status)
	}
	items, err := NewOrders(pool).Items(ctx, row.ID)
	if err != nil || len(items) != 2 {
		t.Fatalf("items = %d (err %v), want 2", len(items), err)
	}
	var engraved, plain int
	for _, it := range items {
		if it.Personalization != nil {
			engraved++
			if it.Personalization.Text != "Bống" || it.Personalization.ZoneID != "base-front" {
				t.Fatalf("personalization round-trip wrong: %+v", it.Personalization)
			}
			if !it.ColorID.Valid {
				t.Fatal("engraved item should carry the selected color_id")
			}
			var opts []string
			if err := json.Unmarshal(it.OptionIds, &opts); err != nil || len(opts) != 1 || opts[0] != "opt1" {
				t.Fatalf("option_ids round-trip = %v (err %v), want [opt1]", opts, err)
			}
		} else {
			plain++
			if it.ColorID.Valid {
				t.Fatal("plain item should have NULL color_id")
			}
			if string(it.OptionIds) != "[]" {
				t.Fatalf("plain item option_ids = %s, want []", it.OptionIds)
			}
		}
	}
	if engraved != 1 || plain != 1 {
		t.Fatalf("engraved/plain = %d/%d, want 1/1", engraved, plain)
	}
}

func TestCreateWebOrderRequiresProof(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()
	customerID, productID, _ := seedOrderDeps(t, ctx, pool)

	tx := mustBegin(t, ctx, pool)
	code := "LMN-" + uuid.NewString()[:8]
	_, err := CreateOrderTx(ctx, tx, CreateOrderInput{
		ID: uuid.New(), Code: code, Channel: order.ChannelWeb,
		CustomerID: customerID, ShippingAddress: shipTo,
		Items:       []NewOrderItem{{ProductID: productID, Quantity: 1, UnitPrice: 100000}},
		ShippingFee: 0, PaymentProofURL: "", At: orderAt, ByUser: "khach",
	})
	if err == nil {
		t.Fatal("web order without payment proof must be rejected (PROOF_REQUIRED)")
	}
	isTransitionErr(t, err, order.ErrProofRequired)
	_ = tx.Rollback(ctx)
	if n := countRows(t, ctx, pool, `SELECT count(*) FROM orders WHERE code=$1`, code); n != 0 {
		t.Fatalf("orders after rejected create = %d, want 0", n)
	}
}

func TestCreateOrderRejectsEmptyItems(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()
	customerID, _, _ := seedOrderDeps(t, ctx, pool)

	tx := mustBegin(t, ctx, pool)
	id := uuid.New()
	_, err := CreateOrderTx(ctx, tx, CreateOrderInput{
		ID: id, Code: "LMN-" + uuid.NewString()[:8], Channel: order.ChannelWeb,
		CustomerID: customerID, ShippingAddress: shipTo,
		Items:       nil, // no line items — violates OrderSchema items.min(1)
		ShippingFee: 30000, PaymentProofURL: "https://x/p.jpg", At: orderAt, ByUser: "khach",
	})
	if !errors.Is(err, ErrNoItems) {
		t.Fatalf("err = %v, want ErrNoItems (item-less order must be refused)", err)
	}
	_ = tx.Rollback(ctx)
	// The guard runs before any insert: no order, no item, no event leaks.
	if n := countRows(t, ctx, pool, `SELECT count(*) FROM orders WHERE id=$1`, id); n != 0 {
		t.Fatalf("orders after rejected empty create = %d, want 0", n)
	}
	if n := countRows(t, ctx, pool, `SELECT count(*) FROM outbox WHERE aggregate_id=$1`, id); n != 0 {
		t.Fatalf("outbox after rejected empty create = %d, want 0", n)
	}
}

func TestCreateInboxOrderStartsPaid(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()
	customerID, productID, _ := seedOrderDeps(t, ctx, pool)

	tx := mustBegin(t, ctx, pool)
	row, err := CreateOrderTx(ctx, tx, CreateOrderInput{
		ID: uuid.New(), Code: "LMN-" + uuid.NewString()[:8], Channel: order.ChannelInbox,
		CustomerID: customerID, ShippingAddress: shipTo,
		Items:       []NewOrderItem{{ProductID: productID, Quantity: 1, UnitPrice: 100000}},
		ShippingFee: 0, At: orderAt, ByUser: "chu-shop", // inbox: no proof required
	})
	if err != nil {
		t.Fatalf("create inbox order: %v", err)
	}
	if row.Status != order.Paid {
		t.Fatalf("inbox entry status = %s, want PAID", row.Status)
	}
	if !row.PaymentConfirmedAt.Valid {
		t.Fatal("inbox order born PAID must stamp payment_confirmed_at")
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("commit: %v", err)
	}
	// An inbox order never passes through ConfirmPaymentTx — CreateOrderTx is its ONLY chance to
	// populate the fulfillment board (print queue). One item ⇒ one NEED_PRINT card.
	if n := countRows(t, ctx, pool, `SELECT count(*) FROM print_jobs pj JOIN order_items oi ON oi.id = pj.order_item_id WHERE oi.order_id=$1 AND pj.stage='NEED_PRINT'`, row.ID); n != 1 {
		t.Fatalf("print_jobs for inbox-born-PAID order = %d, want 1", n)
	}
}

func TestCreateOrderRollbackIsAtomic(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()
	customerID, productID, _ := seedOrderDeps(t, ctx, pool)

	tx := mustBegin(t, ctx, pool)
	id := uuid.New()
	if _, err := CreateOrderTx(ctx, tx, CreateOrderInput{
		ID: id, Code: "LMN-" + uuid.NewString()[:8], Channel: order.ChannelWeb,
		CustomerID: customerID, ShippingAddress: shipTo,
		Items:       []NewOrderItem{{ProductID: productID, Quantity: 1, UnitPrice: 100000}},
		ShippingFee: 0, PaymentProofURL: "https://x/p.jpg", At: orderAt, ByUser: "khach",
	}); err != nil {
		t.Fatalf("create: %v", err)
	}
	if err := tx.Rollback(ctx); err != nil {
		t.Fatalf("rollback: %v", err)
	}
	// Order row, its items AND the outbox event all vanish together (one commit unit).
	if n := countRows(t, ctx, pool, `SELECT count(*) FROM orders WHERE id=$1`, id); n != 0 {
		t.Fatalf("orders after rollback = %d, want 0", n)
	}
	if n := countRows(t, ctx, pool, `SELECT count(*) FROM outbox WHERE aggregate_id=$1`, id); n != 0 {
		t.Fatalf("outbox after rollback = %d, want 0", n)
	}
}

func TestConfirmPaymentReconcile(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()
	customerID, productID, _ := seedOrderDeps(t, ctx, pool)
	o := createCommittedWebOrder(t, ctx, pool, customerID, productID)

	tx := mustBegin(t, ctx, pool)
	row, err := ConfirmPaymentTx(ctx, tx, ConfirmPaymentInput{OrderID: o.ID, ByUser: "chu-shop", At: "2026-06-26T09:00:00.000Z"})
	if err != nil {
		t.Fatalf("reconcile: %v", err)
	}
	if row.Status != order.Paid || !row.PaymentConfirmedAt.Valid {
		t.Fatalf("after reconcile status=%s confirmedAt.valid=%v, want PAID + stamped", row.Status, row.PaymentConfirmedAt.Valid)
	}
	if len(row.StatusHistory) != 2 {
		t.Fatalf("statusHistory len = %d, want 2 (genesis + reconcile)", len(row.StatusHistory))
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("commit: %v", err)
	}
	if n := countRows(t, ctx, pool, `SELECT count(*) FROM outbox WHERE aggregate_id=$1 AND event_type='order.paid'`, o.ID); n != 1 {
		t.Fatalf("order.paid rows = %d, want 1", n)
	}
	// The reconcile is the web order's ONLY PAID transition — this is its one chance to populate the
	// fulfillment board (print queue). One item ⇒ one NEED_PRINT card.
	if n := countRows(t, ctx, pool, `SELECT count(*) FROM print_jobs pj JOIN order_items oi ON oi.id = pj.order_item_id WHERE oi.order_id=$1 AND pj.stage='NEED_PRINT'`, o.ID); n != 1 {
		t.Fatalf("print_jobs after reconcile = %d, want 1", n)
	}
	back, _ := NewOrders(pool).ByID(ctx, o.ID)
	if got, err := order.ReplayStatus(back.StatusHistory); err != nil || got != order.Paid {
		t.Fatalf("replay = %s (err %v), want PAID", got, err)
	}
}

// The FOR UPDATE lock in GetOrderForUpdate is the load-bearing guarantee of AdvanceStatusTx: two
// transactions racing the SAME order PENDING_CONFIRM→PAID MUST serialize. Exactly one commits PAID;
// the loser blocks on the lock, re-reads the committed PAID state, and is rejected by the state
// machine (PAID→PAID is INVALID_EDGE) — never a double-append or a second order.paid. Without the
// lock both would read PENDING_CONFIRM and lost-update one append; this test would then fail.
func TestConcurrentReconcileSerializes(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()
	customerID, productID, _ := seedOrderDeps(t, ctx, pool)
	o := createCommittedWebOrder(t, ctx, pool, customerID, productID)

	start := make(chan struct{})
	errs := make(chan error, 2)
	for i := 0; i < 2; i++ {
		go func() {
			<-start // release both goroutines together to maximize contention
			tx, err := pool.Begin(ctx)
			if err != nil {
				errs <- err
				return
			}
			if _, err := ConfirmPaymentTx(ctx, tx, ConfirmPaymentInput{OrderID: o.ID, ByUser: "chu", At: orderAt}); err != nil {
				_ = tx.Rollback(ctx)
				errs <- err
				return
			}
			errs <- tx.Commit(ctx)
		}()
	}
	close(start)

	var winners int
	var loserErr error
	for i := 0; i < 2; i++ {
		if err := <-errs; err == nil {
			winners++
		} else {
			loserErr = err
		}
	}
	if winners != 1 {
		t.Fatalf("concurrent reconcile: %d succeeded, want exactly 1 (the FOR UPDATE lock must serialize)", winners)
	}
	isTransitionErr(t, loserErr, order.ErrInvalidEdge) // loser saw PAID, so PAID→PAID is rejected

	// Exactly one order.paid row and exactly 2 statusHistory events (genesis + one reconcile).
	if n := countRows(t, ctx, pool, `SELECT count(*) FROM outbox WHERE aggregate_id=$1 AND event_type='order.paid'`, o.ID); n != 1 {
		t.Fatalf("order.paid rows = %d, want exactly 1 (no double money-in event)", n)
	}
	back, _ := NewOrders(pool).ByID(ctx, o.ID)
	if len(back.StatusHistory) != 2 {
		t.Fatalf("statusHistory len = %d, want 2 (genesis + one reconcile, no lost-update double-append)", len(back.StatusHistory))
	}
}

func TestReconcileIsOwnerOnly(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()
	customerID, productID, _ := seedOrderDeps(t, ctx, pool)
	o := createCommittedWebOrder(t, ctx, pool, customerID, productID)

	tx := mustBegin(t, ctx, pool)
	_, err := AdvanceStatusTx(ctx, tx, o.ID, order.Paid, order.TransitionContext{Role: order.RoleStaff, ByUser: "nv", At: orderAt})
	if err == nil {
		t.Fatal("staff reconcile PENDING_CONFIRM→PAID must be rejected (owner-only, ADR-010)")
	}
	isTransitionErr(t, err, order.ErrRBAC)
	_ = tx.Rollback(ctx)
}

// The REFUNDED transition writes the proof to BOTH the appended StatusEvent AND the order-level
// refund_proof_url column, in one atomic UPDATE — they can never diverge (critique important #1).
func TestRefundProofConsistency(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()
	customerID, productID, _ := seedOrderDeps(t, ctx, pool)
	o := createCommittedWebOrder(t, ctx, pool, customerID, productID)

	// Drive PENDING_CONFIRM → PAID → REFUNDED (both owner-only money edges).
	tx := mustBegin(t, ctx, pool)
	if _, err := AdvanceStatusTx(ctx, tx, o.ID, order.Paid, order.TransitionContext{Role: order.RoleOwner, ByUser: "chu", At: orderAt}); err != nil {
		t.Fatalf("→PAID: %v", err)
	}
	const proof = "https://cdn.lumin.vn/refund/xyz.jpg"
	row, err := AdvanceStatusTx(ctx, tx, o.ID, order.Refunded, order.TransitionContext{
		Role: order.RoleOwner, ByUser: "chu", At: "2026-06-26T10:00:00.000Z",
		Reason: "khách đổi ý", RefundProofURL: proof,
	})
	if err != nil {
		t.Fatalf("→REFUNDED: %v", err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("commit: %v", err)
	}

	if row.RefundProofUrl == nil || *row.RefundProofUrl != proof {
		t.Fatalf("order-level refund_proof_url = %v, want %q", row.RefundProofUrl, proof)
	}
	last := row.StatusHistory[len(row.StatusHistory)-1]
	if last.To != order.Refunded || last.RefundProofURL != proof {
		t.Fatalf("REFUNDED event proof = %+v, want %q", last, proof)
	}
	// The invariant: order-level column == the event's proof, byte for byte.
	if *row.RefundProofUrl != last.RefundProofURL {
		t.Fatalf("denormalized refund_proof_url %q != event proof %q", *row.RefundProofUrl, last.RefundProofURL)
	}

	// Re-read from Postgres (not the in-tx RETURNING) so the invariant is pinned against what
	// actually round-tripped through the column + the status_history sqlc override on the read path.
	back, err := NewOrders(pool).ByID(ctx, o.ID)
	if err != nil {
		t.Fatalf("read-back: %v", err)
	}
	backLast := back.StatusHistory[len(back.StatusHistory)-1]
	if back.RefundProofUrl == nil || *back.RefundProofUrl != proof || backLast.RefundProofURL != proof {
		t.Fatalf("after commit+reread: column=%v event=%q, want both %q", back.RefundProofUrl, backLast.RefundProofURL, proof)
	}
}

func TestAdvanceRejectsInvalidEdge(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()
	customerID, productID, _ := seedOrderDeps(t, ctx, pool)
	o := createCommittedWebOrder(t, ctx, pool, customerID, productID)

	tx := mustBegin(t, ctx, pool)
	_, err := AdvanceStatusTx(ctx, tx, o.ID, order.Shipping, order.TransitionContext{Role: order.RoleOwner, ByUser: "chu", At: orderAt})
	if err == nil {
		t.Fatal("PENDING_CONFIRM→SHIPPING must be rejected (INVALID_EDGE)")
	}
	isTransitionErr(t, err, order.ErrInvalidEdge)
	_ = tx.Rollback(ctx)
}

// A full valid walk persisted hop-by-hop: each append is atomic, and replaying the final
// history reconstructs COMPLETED — the persisted history stays a valid edge chain.
func TestStatusWalkReplays(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()
	customerID, productID, _ := seedOrderDeps(t, ctx, pool)
	o := createCommittedWebOrder(t, ctx, pool, customerID, productID)

	tx := mustBegin(t, ctx, pool)
	hops := []struct {
		to   order.Status
		role order.Role
	}{
		{order.Paid, order.RoleOwner}, // reconcile (owner-only)
		{order.Printing, order.RoleOwner},
		{order.Shipping, order.RoleOwner},
		{order.Completed, order.RoleSystem}, // delivery confirmation (system allowed)
	}
	for _, h := range hops {
		if _, err := AdvanceStatusTx(ctx, tx, o.ID, h.to, order.TransitionContext{Role: h.role, ByUser: "actor", At: orderAt}); err != nil {
			t.Fatalf("→%s: %v", h.to, err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("commit: %v", err)
	}

	back, _ := NewOrders(pool).ByID(ctx, o.ID)
	if len(back.StatusHistory) != 5 {
		t.Fatalf("history len = %d, want 5 (genesis + 4 hops)", len(back.StatusHistory))
	}
	if got, err := order.ReplayStatus(back.StatusHistory); err != nil || got != order.Completed {
		t.Fatalf("replay = %s (err %v), want COMPLETED", got, err)
	}
	// The →PAID hop went through AdvanceStatusTx (not ConfirmPaymentTx), so NO order.paid was
	// emitted: order.paid is exclusively the money-in seam's event (the AdvanceStatusTx footgun).
	if n := countRows(t, ctx, pool, `SELECT count(*) FROM outbox WHERE aggregate_id=$1 AND event_type='order.paid'`, o.ID); n != 0 {
		t.Fatalf("order.paid rows = %d after an AdvanceStatusTx walk, want 0 (only ConfirmPaymentTx emits it)", n)
	}
}

// The DB CHECK(>=0) is the last line of defense if a negative total ever reaches the column
// (the seam computes totals via CalcTotals, which already rejects negatives — this proves the
// constraint independently).
func TestOrderRejectsNegativeMoney(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()
	customerID, _, _ := seedOrderDeps(t, ctx, pool)

	genesis, _ := order.GenesisEvent(order.PendingConfirm, order.TransitionContext{ByUser: "x", At: orderAt})
	_, err := sqlc.New(pool).CreateOrder(ctx, sqlc.CreateOrderParams{
		ID: uuid.New(), Code: "LMN-" + uuid.NewString()[:8], Channel: order.ChannelWeb,
		Status: order.PendingConfirm, CustomerID: customerID, ShippingAddress: shipTo,
		Subtotal: -1, ShippingFee: 0, Total: 0,
		StatusHistory: []order.StatusEvent{genesis},
	})
	if err == nil {
		t.Fatal("subtotal = -1 must violate CHECK (subtotal >= 0)")
	}
}
