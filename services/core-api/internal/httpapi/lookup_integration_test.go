package httpapi

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/order"
)

// Integration tests for LookupOrder (GET /orders/lookup, PR-P1-n) against real Postgres (testcontainers:
// skip local without Docker, run in CI — ADR-020; startPostgres lives in transition_integration_test.go).
// They drive the FULL public router with NO cookie to prove the route is mounted + classified authPublic,
// and cover the security-critical invariants: BOTH code AND phone must match; unknown-code and phone-
// mismatch are the BYTE-IDENTICAL 404 (no order-existence enumeration); phone format is normalized; the
// response is the minimal PublicOrderTimeline and NEVER leaks the internal Order (customer/address/money/
// proof/note/actor/reason); trackingCode surfaces only once the order reaches SHIPPING.

// seedLookupOrder inserts a customer (known phone) + a PENDING_CONFIRM web order, returning the order id,
// its display code and the stored phone. Uses the exported db seams so the row is exactly what production
// writes (status_history genesis event, server-computed totals).
func seedLookupOrder(t *testing.T, ctx context.Context, pool *pgxpool.Pool) (uuid.UUID, string, string) {
	t.Helper()
	const phone = "0912345678"
	idn := db.NewIdentity(pool)
	cat := db.NewCatalog(pool)

	cust, err := idn.CreateCustomer(ctx, sqlc.InsertCustomerParams{
		ID: uuid.New(), Name: "Trần Bình", Phone: phone,
		Addresses: []byte(`[{"province":"Hà Nội","ward":"Cửa Nam","street":"1 Tràng Tiền"}]`),
	})
	if err != nil {
		t.Fatalf("seed customer: %v", err)
	}
	cate, err := cat.CreateCategory(ctx, sqlc.InsertCategoryParams{ID: uuid.New(), Slug: "den-lp", Name: "Đèn"})
	if err != nil {
		t.Fatalf("seed category: %v", err)
	}
	prod, err := cat.CreateProduct(ctx, sqlc.InsertProductParams{
		ID: uuid.New(), Slug: "den-lookup", Name: "Đèn tra cứu", Description: "", CategoryID: cate.ID,
		BasePrice: 390_000, Dimensions: []byte(`{"w":180,"d":180,"h":240}`), Material: "PLA",
		Images: []byte(`["https://x/1.jpg"]`), Status: sqlc.ProductStatusActive,
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
	if _, err = db.CreateOrderTx(ctx, tx, db.CreateOrderInput{
		ID: orderID, Code: code, Channel: order.ChannelWeb, CustomerID: cust.ID,
		ShippingAddress: order.Address{Province: "Hà Nội", Ward: "Cửa Nam", Street: "1 Tràng Tiền"},
		Items:           []db.NewOrderItem{{ProductID: prod.ID, Quantity: 1, UnitPrice: 390_000}},
		ShippingFee:     30_000, PaymentProofURL: "https://cdn/x.jpg",
		At: "2026-07-01T08:00:00Z", ByUser: "customer",
	}); err != nil {
		t.Fatalf("seed order: %v", err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("commit: %v", err)
	}
	return orderID, code, phone
}

func doLookup(t *testing.T, router http.Handler, code, phone string) *httptest.ResponseRecorder {
	t.Helper()
	q := url.Values{}
	q.Set("code", code) // url.Values.Encode() percent-encodes the '#' in "#LMN-…" so it is a query value, not a fragment
	q.Set("phone", phone)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/orders/lookup?"+q.Encode(), nil))
	return rec
}

func TestLookupOrderEndToEnd(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()
	srv := NewServer(slog.New(slog.NewTextHandler(io.Discard, nil)), pool, nil, nil)
	router := testAuthedRouter(srv)

	orderID, code, phone := seedLookupOrder(t, ctx, pool)

	t.Run("correct code + phone → 200 minimal timeline", func(t *testing.T) {
		rec := doLookup(t, router, code, phone)
		if rec.Code != http.StatusOK {
			t.Fatalf("lookup = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
		}
		var dto api.PublicOrderTimeline
		if err := json.Unmarshal(rec.Body.Bytes(), &dto); err != nil {
			t.Fatalf("decode timeline: %v", err)
		}
		if dto.Code != code {
			t.Errorf("code = %q, want %q", dto.Code, code)
		}
		if dto.Status != api.OrderStatus(order.PendingConfirm) {
			t.Errorf("status = %v, want PENDING_CONFIRM", dto.Status)
		}
		if len(dto.Milestones) != 1 || dto.Milestones[0].Status != api.OrderStatus(order.PendingConfirm) {
			t.Errorf("milestones = %v, want one PENDING_CONFIRM genesis", dto.Milestones)
		}
		if dto.TrackingCode != nil {
			t.Errorf("trackingCode leaked before SHIPPING: %v", *dto.TrackingCode)
		}
	})

	t.Run("phone in +84 form still matches (normalization)", func(t *testing.T) {
		rec := doLookup(t, router, code, "+84912345678")
		if rec.Code != http.StatusOK {
			t.Fatalf("lookup with +84 phone = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
		}
	})

	t.Run("unknown code and phone-mismatch are the BYTE-IDENTICAL 404 (no enumeration)", func(t *testing.T) {
		unknown := doLookup(t, router, "#LMN-0000", phone)
		mismatch := doLookup(t, router, code, "0900000000")
		if unknown.Code != http.StatusNotFound || mismatch.Code != http.StatusNotFound {
			t.Fatalf("statuses = unknown %d / mismatch %d, want 404/404", unknown.Code, mismatch.Code)
		}
		if unknown.Body.String() != mismatch.Body.String() {
			t.Errorf("bodies differ → enumeration signal:\n unknown=%s\n mismatch=%s", unknown.Body.String(), mismatch.Body.String())
		}
		var env api.ErrorEnvelope
		if err := json.Unmarshal(unknown.Body.Bytes(), &env); err != nil {
			t.Fatalf("decode envelope: %v", err)
		}
		if env.Code != codeNotFound {
			t.Errorf("code = %q, want NOT_FOUND", env.Code)
		}
	})

	t.Run("NON-LEAK: 200 body carries only the whitelist, never the internal Order", func(t *testing.T) {
		rec := doLookup(t, router, code, phone)
		var raw map[string]json.RawMessage
		if err := json.Unmarshal(rec.Body.Bytes(), &raw); err != nil {
			t.Fatalf("decode raw: %v", err)
		}
		allowed := map[string]bool{"code": true, "status": true, "milestones": true, "createdAt": true, "trackingCode": true}
		for k := range raw {
			if !allowed[k] {
				t.Errorf("public timeline leaked field %q (allowed: code/status/milestones/createdAt/trackingCode)", k)
			}
		}
		// The internal Order/StatusEvent fields that must NEVER appear.
		for _, banned := range []string{"customer", "shippingAddress", "items", "subtotal", "shippingFee", "total", "paymentProofUrl", "refundProofUrl", "note", "id", "channel", "paymentConfirmedAt"} {
			if _, ok := raw[banned]; ok {
				t.Errorf("public timeline leaked internal field %q", banned)
			}
		}
		// Milestones must expose only {status, at} — never byUser/reason/refundProofUrl.
		var ms []map[string]json.RawMessage
		if err := json.Unmarshal(raw["milestones"], &ms); err != nil {
			t.Fatalf("decode milestones: %v", err)
		}
		for _, m := range ms {
			for k := range m {
				if k != "status" && k != "at" {
					t.Errorf("milestone leaked field %q (allowed: status/at)", k)
				}
			}
		}
	})

	t.Run("trackingCode surfaces once the order reaches SHIPPING", func(t *testing.T) {
		// Walk PENDING_CONFIRM → PAID (owner reconcile) → PRINTING → SHIPPING(+tracking) via the real
		// transition handler, then re-look-up: the public timeline now carries the waybill.
		tracking := "VN-TRACK-777"
		qc := "https://cdn.lumin.test/qc/pack.jpg"
		mustTransition(t, srv, ownerActorCtx(), orderID, "PAID", nil, nil)
		mustTransition(t, srv, ownerActorCtx(), orderID, "PRINTING", nil, nil)
		mustTransition(t, srv, ownerActorCtx(), orderID, "SHIPPING", &tracking, &qc)

		rec := doLookup(t, router, code, phone)
		if rec.Code != http.StatusOK {
			t.Fatalf("lookup after SHIPPING = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
		}
		var dto api.PublicOrderTimeline
		if err := json.Unmarshal(rec.Body.Bytes(), &dto); err != nil {
			t.Fatalf("decode timeline: %v", err)
		}
		if dto.Status != api.OrderStatus(order.Shipping) {
			t.Errorf("status = %v, want SHIPPING", dto.Status)
		}
		if dto.TrackingCode == nil || *dto.TrackingCode != tracking {
			t.Errorf("trackingCode = %v, want %q", dto.TrackingCode, tracking)
		}
		if len(dto.Milestones) != 4 {
			t.Errorf("milestones = %d, want 4 (PENDING_CONFIRM→PAID→PRINTING→SHIPPING)", len(dto.Milestones))
		}
	})

	t.Run("REFUNDED milestone NEVER leaks reason / refundProofUrl (highest-risk non-leak)", func(t *testing.T) {
		// The order is at SHIPPING from the previous subtest. Refund it (owner-only; needs reason +
		// refundProofUrl), then re-look-up: the REFUNDED milestone carries an internal reason + a proof
		// URL in status_history, and BOTH must be stripped from the public timeline (ADR-032). This is the
		// strongest non-leak case — a refund reason is staff-authored free text and the proof is a money doc.
		reason := "Khách đổi ý — hoàn tiền theo chính sách"
		proof := "https://cdn.example/refund-proof-secret.jpg"
		if _, err := srv.TransitionOrder(ownerActorCtx(), api.TransitionOrderRequestObject{
			Id: orderID, Body: &api.TransitionRequest{To: "REFUNDED", Reason: &reason, RefundProofUrl: &proof},
		}); err != nil {
			t.Fatalf("refund transition: %v", err)
		}

		rec := doLookup(t, router, code, phone)
		if rec.Code != http.StatusOK {
			t.Fatalf("lookup after REFUNDED = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
		}
		body := rec.Body.String()
		if strings.Contains(body, reason) || strings.Contains(body, proof) ||
			strings.Contains(body, "reason") || strings.Contains(body, "refundProofUrl") {
			t.Errorf("REFUNDED lookup leaked reason/refundProofUrl into the public timeline: %s", body)
		}
		var dto api.PublicOrderTimeline
		if err := json.Unmarshal(rec.Body.Bytes(), &dto); err != nil {
			t.Fatalf("decode timeline: %v", err)
		}
		if dto.Status != api.OrderStatus(order.Refunded) {
			t.Errorf("status = %v, want REFUNDED", dto.Status)
		}
		if len(dto.Milestones) == 0 || dto.Milestones[len(dto.Milestones)-1].Status != api.OrderStatus(order.Refunded) {
			t.Errorf("last milestone = %v, want REFUNDED close state present", dto.Milestones)
		}
	})
}
