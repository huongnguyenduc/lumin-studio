package db

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/money"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/order"
)

// Orders is the read repository for the order spine (orders, order_items). Writes that must
// span the domain row + statusHistory append + an outbox event go through the transactional
// SEAMS below (CreateOrderTx / ConfirmPaymentTx / AdvanceStatusTx), which take a pgx.Tx so the
// publish-on-commit contract (ADR-006) is structural. Construct over the pool or a tx.
type Orders struct {
	q *sqlc.Queries
}

// NewOrders builds an Orders over any sqlc.DBTX (the pool or a pgx.Tx).
func NewOrders(db sqlc.DBTX) *Orders {
	return &Orders{q: sqlc.New(db)}
}

// ByID returns the order, or ErrNotFound.
func (o *Orders) ByID(ctx context.Context, id uuid.UUID) (sqlc.Order, error) {
	row, err := o.q.GetOrderByID(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return sqlc.Order{}, ErrNotFound
	}
	return row, err
}

// ByCode returns the order with the given display code, or ErrNotFound.
func (o *Orders) ByCode(ctx context.Context, code string) (sqlc.Order, error) {
	row, err := o.q.GetOrderByCode(ctx, code)
	if errors.Is(err, pgx.ErrNoRows) {
		return sqlc.Order{}, ErrNotFound
	}
	return row, err
}

// ByStatus lists orders in a status, newest first (the admin queue/dashboard read).
func (o *Orders) ByStatus(ctx context.Context, status order.Status) ([]sqlc.Order, error) {
	return o.q.ListOrdersByStatus(ctx, status)
}

// Items lists an order's line items.
func (o *Orders) Items(ctx context.Context, orderID uuid.UUID) ([]sqlc.OrderItem, error) {
	return o.q.ListOrderItems(ctx, orderID)
}

// ErrNoItems is returned when a create is attempted with no line items. The authoritative
// contract requires at least one (packages/core OrderSchema: items.min(1)); this seam is the
// server-authoritative write path, so it enforces the floor rather than persisting a degenerate
// item-less order. (Cardinality can't be a column CHECK, and money.CalcTotals deliberately
// accepts zero items, so the rule lives here.)
var ErrNoItems = errors.New("order: at least one item required")

// NewOrderItem is one validated line to persist with a new order. UnitPrice is the EFFECTIVE
// per-unit VND (base + color delta + option deltas already folded in by the caller's pricing);
// it is snapshotted onto the row so the order stays self-contained if catalog prices change.
//
// The seam validates UnitPrice only for non-negativity / int64-overflow and sum(parts)==total
// (via money.CalcTotals) — NOT its authenticity. Slice-3's checkout handler MUST derive UnitPrice
// server-side from the catalog (base price + the selected color/option deltas) and never trust a
// client-supplied price; this seam will faithfully snapshot whatever it is given.
type NewOrderItem struct {
	ProductID       uuid.UUID
	ColorID         *uuid.UUID // nil when the product has no color choice
	OptionIDs       []string
	Personalization *order.Personalization // nil = no engraving
	Quantity        int32
	UnitPrice       int64
}

// CreateOrderInput is the server-authoritative input to create an order. There is NO subtotal
// or total field: CreateOrderTx computes them via money.CalcTotals from the item unit prices +
// ShippingFee (ADR-019 — a client total is never trusted). The entry status is derived from
// Channel via order.InitialStatusForChannel (web requires a non-empty PaymentProofURL).
type CreateOrderInput struct {
	ID              uuid.UUID
	Code            string
	Channel         order.Channel
	CustomerID      uuid.UUID
	ShippingAddress order.Address
	Items           []NewOrderItem
	ShippingFee     int64
	PaymentProofURL string // CK receipt image; required for web, optional/empty for inbox
	Note            string
	At              string // ISO-8601 UTC creation instant (recorded on the genesis StatusEvent)
	ByUser          string // actor recorded on the genesis StatusEvent
}

// orderCreatedPayload / orderPaidPayload are the outbox event bodies. They carry only what a
// consumer needs and can be reconstructed from the source row — int VND only, no blobs
// (ADR-006). The relay (slice 3) forwards these verbatim to NATS.
type orderCreatedPayload struct {
	OrderID    uuid.UUID     `json:"orderId"`
	Code       string        `json:"code"`
	Channel    order.Channel `json:"channel"`
	Status     order.Status  `json:"status"`
	CustomerID uuid.UUID     `json:"customerId"`
	Total      int64         `json:"total"`
}

type orderPaidPayload struct {
	OrderID uuid.UUID `json:"orderId"`
	Code    string    `json:"code"`
	Total   int64     `json:"total"`
	PaidAt  string    `json:"paidAt"`
}

// CreateOrderTx inserts the order row + its items + the genesis StatusEvent and enqueues an
// `order.created` outbox event — ALL within tx. The single commit means the order and its
// event can never diverge (publish-on-commit, ADR-006). The entry status comes from
// order.InitialStatusForChannel; an inbox order is born PAID and stamps payment_confirmed_at at
// creation (payment was confirmed in the DM), while a web order starts PENDING_CONFIRM awaiting
// reconcile. Totals are server-computed via money.CalcTotals. Caller owns the commit.
func CreateOrderTx(ctx context.Context, tx pgx.Tx, in CreateOrderInput) (sqlc.Order, error) {
	q := sqlc.New(tx)

	if len(in.Items) == 0 {
		return sqlc.Order{}, ErrNoItems
	}

	status, err := order.InitialStatusForChannel(in.Channel, in.PaymentProofURL != "")
	if err != nil {
		return sqlc.Order{}, err
	}

	genesis, err := order.GenesisEvent(status, order.TransitionContext{ByUser: in.ByUser, At: in.At})
	if err != nil {
		return sqlc.Order{}, err
	}

	totals, err := money.CalcTotals(money.TotalsInput{
		Items:       lineItems(in.Items),
		ShippingFee: in.ShippingFee,
	})
	if err != nil {
		return sqlc.Order{}, err
	}

	// An order that enters at PAID (inbox) records the confirmation instant now.
	var confirmedAt pgtype.Timestamptz
	if status == order.Paid {
		at, perr := time.Parse(time.RFC3339Nano, in.At)
		if perr != nil {
			return sqlc.Order{}, fmt.Errorf("order: parse confirmed_at: %w", perr)
		}
		confirmedAt = pgtype.Timestamptz{Time: at, Valid: true}
	}

	row, err := q.CreateOrder(ctx, sqlc.CreateOrderParams{
		ID:                 in.ID,
		Code:               in.Code,
		Channel:            in.Channel,
		Status:             status,
		CustomerID:         in.CustomerID,
		ShippingAddress:    in.ShippingAddress,
		Subtotal:           totals.Subtotal,
		ShippingFee:        totals.ShippingFee,
		Total:              totals.Total,
		PaymentProofUrl:    nullStr(in.PaymentProofURL),
		PaymentConfirmedAt: confirmedAt,
		Note:               nullStr(in.Note),
		StatusHistory:      []order.StatusEvent{genesis},
	})
	if err != nil {
		return sqlc.Order{}, fmt.Errorf("order: create %s: %w", in.Code, err)
	}

	for _, it := range in.Items {
		if _, err := q.InsertOrderItem(ctx, sqlc.InsertOrderItemParams{
			ID:              uuid.New(),
			OrderID:         row.ID,
			ProductID:       it.ProductID,
			ColorID:         nullUUID(it.ColorID),
			OptionIds:       optionIDsJSON(it.OptionIDs),
			Personalization: it.Personalization,
			Quantity:        it.Quantity,
			UnitPrice:       it.UnitPrice,
		}); err != nil {
			return sqlc.Order{}, fmt.Errorf("order: insert item for %s: %w", in.Code, err)
		}
	}

	payload, err := json.Marshal(orderCreatedPayload{
		OrderID: row.ID, Code: row.Code, Channel: row.Channel,
		Status: row.Status, CustomerID: row.CustomerID, Total: row.Total,
	})
	if err != nil {
		return sqlc.Order{}, fmt.Errorf("order: marshal created payload: %w", err)
	}
	if err := EnqueueOutbox(ctx, tx, OutboxEvent{
		ID:            uuid.New(),
		AggregateType: "order",
		AggregateID:   row.ID,
		EventType:     "order.created",
		Payload:       payload,
		DedupKey:      dedupKey(row.ID, "order.created"),
	}); err != nil {
		return sqlc.Order{}, err
	}
	return row, nil
}

// ConfirmPaymentInput reconciles a web order PENDING_CONFIRM → PAID. This is owner-only money-in
// (ADR-010): the seam fixes the role to owner so a staff caller cannot reconcile.
type ConfirmPaymentInput struct {
	OrderID uuid.UUID
	ByUser  string // the owner performing the reconcile
	At      string // ISO-8601 UTC instant
}

// ConfirmPaymentTx flips an order to PAID (owner-only reconcile), appends the statusHistory
// event, stamps payment_confirmed_at, and enqueues `order.paid` — all within tx. It is the
// money-in emit-seam: the state flip and the event commit atomically (ADR-006).
func ConfirmPaymentTx(ctx context.Context, tx pgx.Tx, in ConfirmPaymentInput) (sqlc.Order, error) {
	row, err := AdvanceStatusTx(ctx, tx, in.OrderID, order.Paid, order.TransitionContext{
		Role: order.RoleOwner, ByUser: in.ByUser, At: in.At,
	})
	if err != nil {
		return sqlc.Order{}, err
	}

	payload, err := json.Marshal(orderPaidPayload{
		OrderID: row.ID, Code: row.Code, Total: row.Total, PaidAt: in.At,
	})
	if err != nil {
		return sqlc.Order{}, fmt.Errorf("order: marshal paid payload: %w", err)
	}
	if err := EnqueueOutbox(ctx, tx, OutboxEvent{
		ID:            uuid.New(),
		AggregateType: "order",
		AggregateID:   row.ID,
		EventType:     "order.paid",
		Payload:       payload,
		DedupKey:      dedupKey(row.ID, "order.paid"),
	}); err != nil {
		return sqlc.Order{}, err
	}
	return row, nil
}

// AdvanceStatusTx applies one status transition WITHIN tx. It locks the order row
// (SELECT … FOR UPDATE — no lost-update race between concurrent transitions), runs
// order.Transition on the CURRENT persisted state (edge / RBAC / actor / timestamp / reason /
// refund-proof rules + the statusHistory append), then writes the new status and the full
// appended history in a single UPDATE. Two columns are denormalized from the transition in the
// SAME statement so they can never diverge from the history:
//   - → PAID stamps payment_confirmed_at to the transition instant;
//   - → REFUNDED copies the event's refundProofUrl into refund_proof_url.
//
// It emits NO outbox event — a caller that needs one (ConfirmPaymentTx) enqueues it on the same
// tx. Returns ErrNotFound for an unknown order and a *order.TransitionError on any rule
// violation (both surface to the HTTP layer in slice 3).
//
// FOOTGUN: do NOT carry the money-in reconcile (PENDING_CONFIRM → PAID) through this seam in
// production code — it flips state and stamps payment_confirmed_at but emits no `order.paid`, so
// downstream (the slice-3 relay/consumers) would never learn the order was paid. Reconcile-to-PAID
// must go through ConfirmPaymentTx, the only seam that emits `order.paid`. This seam is for the
// non-money-in edges (PRINTING/SHIPPING/COMPLETED/CANCELLED/REFUNDED) and for driving an order to
// a given state in tests; TestStatusWalkReplays asserts an AdvanceStatusTx walk emits no order.paid.
func AdvanceStatusTx(ctx context.Context, tx pgx.Tx, orderID uuid.UUID, to order.Status, tctx order.TransitionContext) (sqlc.Order, error) {
	q := sqlc.New(tx)

	cur, err := q.GetOrderForUpdate(ctx, orderID)
	if errors.Is(err, pgx.ErrNoRows) {
		return sqlc.Order{}, ErrNotFound
	}
	if err != nil {
		return sqlc.Order{}, fmt.Errorf("order: lock %s: %w", orderID, err)
	}

	next, err := order.Transition(order.Order{Status: cur.Status, StatusHistory: cur.StatusHistory}, to, tctx)
	if err != nil {
		return sqlc.Order{}, err // *order.TransitionError — invalid edge / RBAC / missing reason / proof
	}

	params := sqlc.UpdateOrderStatusParams{
		ID:            orderID,
		Status:        next.Status,
		StatusHistory: next.StatusHistory,
	}
	last := next.StatusHistory[len(next.StatusHistory)-1]
	if to == order.Refunded {
		proof := last.RefundProofURL // denormalized copy of the latest REFUNDED event's proof
		params.RefundProofUrl = &proof
	}
	if to == order.Paid {
		at, perr := time.Parse(time.RFC3339Nano, tctx.At)
		if perr != nil {
			return sqlc.Order{}, fmt.Errorf("order: parse confirmed_at: %w", perr)
		}
		params.PaymentConfirmedAt = pgtype.Timestamptz{Time: at, Valid: true}
	}

	row, err := q.UpdateOrderStatus(ctx, params)
	if errors.Is(err, pgx.ErrNoRows) {
		return sqlc.Order{}, ErrNotFound
	}
	if err != nil {
		return sqlc.Order{}, fmt.Errorf("order: update status %s→%s: %w", cur.Status, to, err)
	}
	return row, nil
}

// lineItems maps order items to money.LineItem. Deltas are already folded into UnitPrice (the
// row snapshots the effective unit price), so ColorDelta/OptionDeltas are zero here — the total
// still flows through the one authoritative CalcTotals path.
func lineItems(items []NewOrderItem) []money.LineItem {
	out := make([]money.LineItem, len(items))
	for i, it := range items {
		out[i] = money.LineItem{UnitPrice: it.UnitPrice, Quantity: int64(it.Quantity)}
	}
	return out
}

// optionIDsJSON marshals selected option ids to a jsonb array, defaulting to `[]` (never NULL).
func optionIDsJSON(ids []string) []byte {
	if len(ids) == 0 {
		return []byte("[]")
	}
	b, err := json.Marshal(ids)
	if err != nil { // string slices never fail to marshal; fall back to an empty array
		return []byte("[]")
	}
	return b
}

// nullUUID converts an optional uuid to the pgtype.UUID a nullable column expects.
func nullUUID(id *uuid.UUID) pgtype.UUID {
	if id == nil {
		return pgtype.UUID{Valid: false}
	}
	return pgtype.UUID{Bytes: *id, Valid: true}
}

// nullStr maps "" to a NULL text param and any other value to a non-NULL one.
func nullStr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// dedupKey builds the idempotency key for a singleton order event (one order.created /
// order.paid per order). The UNIQUE(dedup_key) index rejects a buggy double-insert.
func dedupKey(orderID uuid.UUID, eventType string) string {
	return fmt.Sprintf("order:%s:%s", orderID, eventType)
}
