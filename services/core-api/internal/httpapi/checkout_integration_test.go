package httpapi

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/order"
)

// Integration tests for the CreateOrder handler against real Postgres (testcontainers: skip
// local without Docker, run in CI — ADR-020; startPostgres lives in
// transition_integration_test.go). They drive the handler method with the ctx the auth boundary
// would provide (anonymous for guest web, withActor for staff inbox) and assert the full
// money-in contract: server-derived prices, settings-resolved shipping fee, minted code,
// find-or-create customer + idempotent PDPL consent, genesis statusHistory, and exactly one
// order.created (never order.paid) in the outbox — all committed atomically.

// checkoutFixture is the catalog + settings state the checkout tests price against.
type checkoutFixture struct {
	product      sqlc.Product // active, base 390_000
	colorMint    sqlc.Color   // +20_000, available
	colorSold    sqlc.Color   // unavailable
	optDimmer    sqlc.Option  // choice, +90_000
	optEngrave   sqlc.Option  // text, +50_000, maxChars 20
	otherProduct sqlc.Product // a second active product (for cross-product selections)
	otherColor   sqlc.Color   // belongs to otherProduct
	archived     sqlc.Product // not orderable
}

func seedCheckoutCatalog(t *testing.T, ctx context.Context, pool *pgxpool.Pool) checkoutFixture {
	t.Helper()
	cat := db.NewCatalog(pool)

	category, err := cat.CreateCategory(ctx, sqlc.InsertCategoryParams{ID: uuid.New(), Slug: "den", Name: "Đèn"})
	if err != nil {
		t.Fatalf("seed category: %v", err)
	}
	mkProduct := func(slug string, status sqlc.ProductStatus) sqlc.Product {
		p, perr := cat.CreateProduct(ctx, sqlc.InsertProductParams{
			ID: uuid.New(), Slug: slug, Name: "Đèn " + slug, Description: "ấm áp", CategoryID: category.ID,
			BasePrice: 390_000, Dimensions: []byte(`{"w":180,"d":180,"h":240}`), Material: "PLA",
			Model3dUrl: "https://x/m.glb", Images: []byte(`["https://x/1.jpg"]`), Status: status,
		})
		if perr != nil {
			t.Fatalf("seed product %s: %v", slug, perr)
		}
		return p
	}
	fx := checkoutFixture{
		product:      mkProduct("den-nam", sqlc.ProductStatusActive),
		otherProduct: mkProduct("den-may", sqlc.ProductStatusActive),
		archived:     mkProduct("den-cu", sqlc.ProductStatusArchived),
	}

	mkColor := func(productID uuid.UUID, name string, delta int64, available bool) sqlc.Color {
		c, cerr := cat.CreateColor(ctx, sqlc.InsertColorParams{
			ID: uuid.New(), ProductID: productID, Name: name, Hex: "#a8d8c8", PriceDelta: delta, Available: available,
		})
		if cerr != nil {
			t.Fatalf("seed color %s: %v", name, cerr)
		}
		return c
	}
	fx.colorMint = mkColor(fx.product.ID, "Xanh mint", 20_000, true)
	fx.colorSold = mkColor(fx.product.ID, "Hồng pastel", 10_000, false)
	fx.otherColor = mkColor(fx.otherProduct.ID, "Trắng mây", 0, true)

	maxChars := int32(20)
	fx.optEngrave, err = cat.CreateOption(ctx, sqlc.InsertOptionParams{
		ID: uuid.New(), ProductID: fx.product.ID, Label: "Khắc tên", Description: "khắc chữ",
		Type: sqlc.OptionTypeText, PriceDelta: 50_000, MaxChars: &maxChars,
	})
	if err != nil {
		t.Fatalf("seed engrave option: %v", err)
	}
	fx.optDimmer, err = cat.CreateOption(ctx, sqlc.InsertOptionParams{
		ID: uuid.New(), ProductID: fx.product.ID, Label: "Dimmer", Description: "chỉnh sáng",
		Type: sqlc.OptionTypeChoice, PriceDelta: 90_000,
	})
	if err != nil {
		t.Fatalf("seed dimmer option: %v", err)
	}
	return fx
}

// setShippingRules overwrites settings.shipping_rules, preserving the other config columns.
func setShippingRules(t *testing.T, ctx context.Context, pool *pgxpool.Pool, rulesJSON string) {
	t.Helper()
	settings := db.NewSettings(pool)
	current, err := settings.Get(ctx)
	if err != nil {
		t.Fatalf("read settings: %v", err)
	}
	if _, err := settings.UpdateConfig(ctx, sqlc.UpdateSettingsParams{
		ShopInfo: current.ShopInfo, ShippingRules: []byte(rulesJSON), RefundPolicy: current.RefundPolicy,
	}); err != nil {
		t.Fatalf("set shipping rules: %v", err)
	}
}

// setBankAccount seeds a usable VietQR STK on the settings singleton. The migration seed leaves
// bank_account `{}`, and the P2-a web checkout STK gate rejects a web create against an unconfigured
// shop — so any web-order integration test must seed one. Direct UPDATE (not the audited seam): this is
// test config seeding, not the money-out change path the seam guards (that has its own tests).
func setBankAccount(t *testing.T, ctx context.Context, pool *pgxpool.Pool) {
	t.Helper()
	if _, err := pool.Exec(ctx,
		`UPDATE settings SET bank_account = '{"bin":"970436","accountNumber":"0011001234567","accountName":"LUMIN STUDIO"}' WHERE id = true`); err != nil {
		t.Fatalf("seed bank account: %v", err)
	}
}

func countOutbox(t *testing.T, ctx context.Context, pool *pgxpool.Pool, orderID uuid.UUID, eventType string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM outbox WHERE aggregate_id=$1 AND event_type=$2`, orderID, eventType).Scan(&n); err != nil {
		t.Fatalf("count %s: %v", eventType, err)
	}
	return n
}

func mustCreateOrder(t *testing.T, srv *Server, ctx context.Context, raw string) api.Order {
	t.Helper()
	resp, err := srv.CreateOrder(ctx, api.CreateOrderRequestObject{Body: mkCreateOrderBody(t, raw)})
	if err != nil {
		t.Fatalf("CreateOrder: %v", err)
	}
	created, ok := resp.(api.CreateOrder201JSONResponse)
	if !ok {
		t.Fatalf("resp = %T (%+v), want 201 Order", resp, resp)
	}
	return api.Order(created)
}

// CHK-04 (positive half) + the full guest money path: a guest web order prices every line from
// the catalog, resolves the fee from settings, mints a code, creates customer + consent + order
// + genesis + outbox atomically, and returns the nested DTO. A second order from the same phone
// reuses the customer and does not duplicate the active consent.
func TestCreateOrderWebEndToEnd(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()
	fx := seedCheckoutCatalog(t, ctx, pool)
	setShippingRules(t, ctx, pool, `[{"province":"Hà Nội","fee":30000},{"province":"*","fee":45000}]`)
	setBankAccount(t, ctx, pool) // P2-a: a web create needs a configured STK
	srv := NewServer(slog.New(slog.NewTextHandler(io.Discard, nil)), pool, nil, nil)

	raw := webBody(map[string]any{
		"items": []any{map[string]any{
			"productId":       fx.product.ID.String(),
			"colorId":         fx.colorMint.ID.String(),
			"optionIds":       []string{fx.optDimmer.ID.String(), fx.optEngrave.ID.String()},
			"quantity":        2,
			"personalization": map[string]any{"text": "Miu ơi", "zoneId": "front"},
		}},
		"personalizationAck":   true,
		"engraveEchoConfirmed": true,
	})
	dto := mustCreateOrder(t, srv, ctx, raw) // anonymous ctx — the guest path

	// Server-derived money: 390k base + 20k color + 90k dimmer + 50k engrave = 550k ×2 + 30k fee.
	if dto.Items[0].UnitPrice != 550_000 || dto.Subtotal != 1_100_000 || dto.ShippingFee != 30_000 || dto.Total != 1_130_000 {
		t.Fatalf("money = unit %d subtotal %d fee %d total %d, want 550000/1100000/30000/1130000",
			dto.Items[0].UnitPrice, dto.Subtotal, dto.ShippingFee, dto.Total)
	}
	if dto.Status != "PENDING_CONFIRM" || dto.Channel != "web" {
		t.Fatalf("status/channel = %s/%s, want PENDING_CONFIRM/web", dto.Status, dto.Channel)
	}
	if !strings.HasPrefix(dto.Code, "#LMN-") {
		t.Fatalf("code = %q, want #LMN-…", dto.Code)
	}
	if dto.PaymentProofUrl == nil || *dto.PaymentProofUrl == "" {
		t.Fatal("paymentProofUrl missing on the web order")
	}
	if dto.PaymentConfirmedAt != nil {
		t.Fatal("web order must NOT stamp paymentConfirmedAt at creation")
	}
	// Genesis statusHistory: exactly one from=nil event by the guest sentinel.
	if len(dto.StatusHistory) != 1 || dto.StatusHistory[0].From != nil ||
		dto.StatusHistory[0].To != "PENDING_CONFIRM" || dto.StatusHistory[0].ByUser != byUserCustomer {
		t.Fatalf("genesis = %+v, want {from:nil to:PENDING_CONFIRM byUser:%q}", dto.StatusHistory, byUserCustomer)
	}
	// Outbox: exactly one order.created, never order.paid on the web path (money not confirmed).
	if n := countOutbox(t, ctx, pool, dto.Id, "order.created"); n != 1 {
		t.Fatalf("order.created = %d, want 1", n)
	}
	if n := countOutbox(t, ctx, pool, dto.Id, "order.paid"); n != 0 {
		t.Fatalf("order.paid = %d, want 0 (creation is not payment)", n)
	}
	// PDPL: exactly one ACTIVE order_fulfillment consent for the new customer, channel web.
	var consents int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM consent_grants cg JOIN customers c ON c.id = cg.customer_id
		WHERE c.phone='0901234567' AND cg.scope='order_fulfillment' AND cg.channel='web'
		AND cg.policy_version=$1 AND cg.withdrawn_at IS NULL`, consentPolicyVersion).Scan(&consents); err != nil {
		t.Fatalf("count consents: %v", err)
	}
	if consents != 1 {
		t.Fatalf("active consents = %d, want 1", consents)
	}

	// Second order, same phone, different display name: the customer row is REUSED (find by
	// phone, never overwritten), the consent stays single, the code advances.
	raw2 := webBody(map[string]any{
		"customer": map[string]any{"name": "An Nguyễn", "phone": "0901234567"},
		"items":    []any{map[string]any{"productId": fx.product.ID.String(), "quantity": 1}},
	})
	dto2 := mustCreateOrder(t, srv, ctx, raw2)
	if dto2.Code == dto.Code {
		t.Fatalf("second order minted the same code %q", dto.Code)
	}
	if dto2.Customer.Name != "Nguyễn An" {
		t.Fatalf("returning customer name = %q, want the ORIGINAL row (find-or-create must not overwrite)", dto2.Customer.Name)
	}
	var customers int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM customers WHERE phone='0901234567'`).Scan(&customers); err != nil {
		t.Fatalf("count customers: %v", err)
	}
	if customers != 1 {
		t.Fatalf("customers for the phone = %d, want 1 (found, not duplicated)", customers)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM consent_grants cg JOIN customers c ON c.id = cg.customer_id
		WHERE c.phone='0901234567' AND cg.scope='order_fulfillment' AND cg.withdrawn_at IS NULL`).Scan(&consents); err != nil {
		t.Fatalf("recount consents: %v", err)
	}
	if consents != 1 {
		t.Fatalf("active consents after 2nd order = %d, want still 1 (idempotent)", consents)
	}
}

// CHK-05 (positive half): a staff actor creates an inbox order born PAID — payment_confirmed_at
// stamped, genesis byUser = the staff users.id, wildcard shipping fee, note persisted, and the
// outbox carries order.created only (born-PAID is creation, not a reconcile — no order.paid).
func TestCreateOrderInboxStaffEndToEnd(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()
	fx := seedCheckoutCatalog(t, ctx, pool)
	setShippingRules(t, ctx, pool, `[{"province":"Hà Nội","fee":30000},{"province":"*","fee":45000}]`)
	srv := NewServer(slog.New(slog.NewTextHandler(io.Discard, nil)), pool, nil, nil)

	staff := Actor{ByUser: uuid.NewString(), Role: order.RoleStaff, At: time.Now().UTC()}
	body := map[string]any{
		"channel":         "inbox",
		"customer":        map[string]any{"name": "Trần Bình", "phone": "0912345678", "socialHandle": "@binh.tran"},
		"shippingAddress": map[string]any{"province": "Đà Nẵng", "ward": "Hải Châu", "street": "9 Bạch Đằng"},
		"items":           []any{map[string]any{"productId": fx.product.ID.String(), "quantity": 1}},
		"note":            "Khách quen, giao giờ hành chính",
	}
	rawBytes, _ := json.Marshal(body)
	dto := mustCreateOrder(t, srv, withActor(ctx, staff), string(rawBytes))

	if dto.Status != "PAID" || dto.Channel != "inbox" {
		t.Fatalf("status/channel = %s/%s, want PAID/inbox", dto.Status, dto.Channel)
	}
	if dto.PaymentConfirmedAt == nil {
		t.Fatal("inbox order must stamp paymentConfirmedAt at creation")
	}
	if dto.ShippingFee != 45_000 {
		t.Fatalf("shippingFee = %d, want 45000 (the \"*\" wildcard rule)", dto.ShippingFee)
	}
	if dto.Note == nil || *dto.Note != "Khách quen, giao giờ hành chính" {
		t.Fatalf("note = %v, want persisted", dto.Note)
	}
	if len(dto.StatusHistory) != 1 || dto.StatusHistory[0].ByUser != staff.ByUser {
		t.Fatalf("genesis byUser = %+v, want the staff users.id %q", dto.StatusHistory, staff.ByUser)
	}
	if n := countOutbox(t, ctx, pool, dto.Id, "order.created"); n != 1 {
		t.Fatalf("order.created = %d, want 1", n)
	}
	if n := countOutbox(t, ctx, pool, dto.Id, "order.paid"); n != 0 {
		t.Fatalf("order.paid = %d, want 0 (born-PAID is creation, not reconcile)", n)
	}
	var channel string
	if err := pool.QueryRow(ctx, `SELECT cg.channel FROM consent_grants cg JOIN customers c ON c.id = cg.customer_id
		WHERE c.phone='0912345678' AND cg.scope='order_fulfillment' AND cg.withdrawn_at IS NULL`).Scan(&channel); err != nil {
		t.Fatalf("read consent channel: %v", err)
	}
	if channel != "inbox" {
		t.Fatalf("consent channel = %q, want inbox", channel)
	}
}

// Every pricing/selection rejection maps to its ADR-032 code and fires BEFORE the tx — no
// customer/consent/order row is left behind by a rejected create.
func TestCreateOrderPricingRejectionsIntegration(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()
	fx := seedCheckoutCatalog(t, ctx, pool)
	// Deliberately NO wildcard: an unlisted province must 422, never ₫0.
	setShippingRules(t, ctx, pool, `[{"province":"Hà Nội","fee":30000}]`)
	setBankAccount(t, ctx, pool) // P2-a: STK configured so the NO_SHIPPING_RULE case isn't masked by the STK gate
	srv := NewServer(slog.New(slog.NewTextHandler(io.Discard, nil)), pool, nil, nil)

	item := func(productID string, patch map[string]any) []any {
		m := map[string]any{"productId": productID, "quantity": 1}
		for k, v := range patch {
			m[k] = v
		}
		return []any{m}
	}
	cases := []struct {
		name     string
		raw      string
		wantCode string
	}{
		{"foreign-color", webBody(map[string]any{"items": item(fx.product.ID.String(),
			map[string]any{"colorId": fx.otherColor.ID.String()})}), codeInvalidSelection},
		{"unavailable-color", webBody(map[string]any{"items": item(fx.product.ID.String(),
			map[string]any{"colorId": fx.colorSold.ID.String()})}), codeColorUnavailable},
		{"engrave-too-long", webBody(map[string]any{
			"items": item(fx.product.ID.String(), map[string]any{
				"optionIds":       []string{fx.optEngrave.ID.String()},
				"personalization": map[string]any{"text": strings.Repeat("â", 21), "zoneId": "front"},
			}),
			"personalizationAck": true, "engraveEchoConfirmed": true}), codeEngraveTooLong},
		{"engrave-without-text-option", webBody(map[string]any{
			"items": item(fx.product.ID.String(), map[string]any{
				"personalization": map[string]any{"text": "Miu", "zoneId": "front"},
			}),
			"personalizationAck": true, "engraveEchoConfirmed": true}), codeInvalidSelection},
		{"unknown-product", webBody(map[string]any{"items": item(uuid.NewString(), nil)}), codeProductUnavailable},
		{"archived-product", webBody(map[string]any{"items": item(fx.archived.ID.String(), nil)}), codeProductUnavailable},
		{"no-shipping-rule", webBody(map[string]any{
			"items":           item(fx.product.ID.String(), nil),
			"shippingAddress": map[string]any{"province": "Cà Mau", "ward": "Phường 5", "street": "3 Lý Bôn"},
		}), codeNoShippingRule},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := srv.CreateOrder(ctx, api.CreateOrderRequestObject{Body: mkCreateOrderBody(t, tc.raw)})
			if err == nil {
				t.Fatal("want a pricing rejection, got 201")
			}
			if status, env := mapError(err); status != http.StatusUnprocessableEntity || env.Code != tc.wantCode {
				t.Fatalf("mapError = %d/%s, want 422/%s (err=%v)", status, env.Code, tc.wantCode, err)
			}
		})
	}

	// Rejections happen pre-tx: nothing was persisted for the attempted phone.
	var n int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM customers WHERE phone='0901234567'`).Scan(&n); err != nil {
		t.Fatalf("count customers: %v", err)
	}
	if n != 0 {
		t.Fatalf("customers after rejected creates = %d, want 0 (no partial persistence)", n)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM orders`).Scan(&n); err != nil {
		t.Fatalf("count orders: %v", err)
	}
	if n != 0 {
		t.Fatalf("orders after rejected creates = %d, want 0", n)
	}
}
