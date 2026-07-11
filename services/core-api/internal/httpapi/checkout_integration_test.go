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
	"github.com/jackc/pgx/v5/pgtype"
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
		t.Fatalf("resp = %T (%+v), want 201 CreateOrderResult", resp, resp)
	}
	// The 201 body carries the phone-less tracking token (P2-i) alongside the order; every web/inbox
	// create must mint one so the confirmation screen can build the /o/{code}-{token} link.
	if created.TrackingToken == "" {
		t.Fatalf("CreateOrder 201 missing trackingToken (order %s)", created.Order.Code)
	}
	return created.Order
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
	srv := NewServer(slog.New(slog.NewTextHandler(io.Discard, nil)), pool, nil, nil, WithPaymentProofUploads(newTestProofStore()))

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
	srv := NewServer(slog.New(slog.NewTextHandler(io.Discard, nil)), pool, nil, nil, WithPaymentProofUploads(newTestProofStore()))

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

// partsFixture is a single ADR-037 configurator product: two named parts each with its own available
// colour, and a choice-option offering two choices (its own base deliberately huge, to prove the picked
// choice — not the option base — prices the line).
type partsFixture struct {
	product                   uuid.UUID
	partA, partB              uuid.UUID
	colorA, colorB            uuid.UUID
	optSize, choiceS, choiceM uuid.UUID
}

// seedPartsProduct seeds the configurator product the parts-product checkout test prices against. base
// 100_000; partA/Cam +10_000, partB/Trắng +5_000; optSize base 999_999 (ignored — priced by the choice);
// choiceS +0, choiceM +40_000. A happy line therefore costs 100k+10k+5k+40k = 155_000 (mirrors the
// pricing unit test), proving the whole wire → PriceItem → persist → DTO path agrees on the money.
func seedPartsProduct(t *testing.T, ctx context.Context, pool *pgxpool.Pool) partsFixture {
	t.Helper()
	cat := db.NewCatalog(pool)
	category, err := cat.CreateCategory(ctx, sqlc.InsertCategoryParams{ID: uuid.New(), Slug: "den-parts", Name: "Đèn"})
	if err != nil {
		t.Fatalf("seed category: %v", err)
	}
	product, err := cat.CreateProduct(ctx, sqlc.InsertProductParams{
		ID: uuid.New(), Slug: "den-2-phan", Name: "Đèn hai phần", Description: "cấu hình", CategoryID: category.ID,
		BasePrice: 100_000, Dimensions: []byte(`{"w":180,"d":180,"h":240}`), Material: "PLA",
		Model3dUrl: "https://x/m.glb", Images: []byte(`["https://x/1.jpg"]`), Status: sqlc.ProductStatusActive,
	})
	if err != nil {
		t.Fatalf("seed product: %v", err)
	}
	fx := partsFixture{product: product.ID}

	mkPart := func(name string, order int32) uuid.UUID {
		p, perr := cat.CreatePart(ctx, sqlc.InsertPartParams{ID: uuid.New(), ProductID: product.ID, Name: name, DisplayOrder: order})
		if perr != nil {
			t.Fatalf("seed part %s: %v", name, perr)
		}
		return p.ID
	}
	fx.partA, fx.partB = mkPart("Chao đèn", 0), mkPart("Đế", 1)

	mkPartColor := func(part uuid.UUID, name string, delta int64) uuid.UUID {
		c, cerr := cat.CreateColor(ctx, sqlc.InsertColorParams{
			ID: uuid.New(), ProductID: product.ID, Name: name, Hex: "#a8d8c8", Available: true, PriceDelta: delta,
			PartID: pgtype.UUID{Bytes: part, Valid: true},
		})
		if cerr != nil {
			t.Fatalf("seed part colour %s: %v", name, cerr)
		}
		return c.ID
	}
	fx.colorA, fx.colorB = mkPartColor(fx.partA, "Cam", 10_000), mkPartColor(fx.partB, "Trắng", 5_000)

	optSize, err := cat.CreateOption(ctx, sqlc.InsertOptionParams{
		ID: uuid.New(), ProductID: product.ID, Label: "Kích thước", Description: "chọn cỡ",
		Type: sqlc.OptionTypeChoice, PriceDelta: 999_999, // ignored: a choice-option is priced by its picked choice
	})
	if err != nil {
		t.Fatalf("seed choice option: %v", err)
	}
	fx.optSize = optSize.ID
	mkChoice := func(label string, delta int64, order int32) uuid.UUID {
		ch, cerr := cat.CreateOptionChoice(ctx, sqlc.InsertOptionChoiceParams{
			ID: uuid.New(), OptionID: optSize.ID, Label: label, Description: "", PriceDelta: delta, DisplayOrder: order,
		})
		if cerr != nil {
			t.Fatalf("seed choice %s: %v", label, cerr)
		}
		return ch.ID
	}
	fx.choiceS, fx.choiceM = mkChoice("S", 0, 0), mkChoice("M", 40_000, 1)
	return fx
}

// ADR-037 Stage 2b-2: a parts product is now orderable end-to-end. The wire carries per-part colours +
// a picked choice; the server prices from the catalog (155_000, ignoring the choice-option's 999_999
// base), persists the selection snapshot, and the created-order DTO round-trips it back. A quote of the
// SAME selection returns the SAME unit price (quote == charge, oracle note c). Before 2b-2 this order
// 422'd (the wire could not carry the selection, so a part colour was always "missing").
func TestCreateOrderPartsProductEndToEnd(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()
	fx := seedPartsProduct(t, ctx, pool)
	setShippingRules(t, ctx, pool, `[{"province":"Hà Nội","fee":30000}]`)
	setBankAccount(t, ctx, pool)
	srv := NewServer(slog.New(slog.NewTextHandler(io.Discard, nil)), pool, nil, nil, WithPaymentProofUploads(newTestProofStore()))

	raw := webBody(map[string]any{
		"items": []any{map[string]any{
			"productId": fx.product.String(),
			"partColors": []any{
				map[string]any{"partId": fx.partA.String(), "colorId": fx.colorA.String()},
				map[string]any{"partId": fx.partB.String(), "colorId": fx.colorB.String()},
			},
			"optionChoices": []any{
				map[string]any{"optionId": fx.optSize.String(), "choiceId": fx.choiceM.String()},
			},
			"quantity": 2,
		}},
	})
	dto := mustCreateOrder(t, srv, ctx, raw)

	// 100k base + 10k (partA/Cam) + 5k (partB/Trắng) + 40k (choice M) = 155_000; ×2 + 30k fee.
	if dto.Items[0].UnitPrice != 155_000 || dto.Subtotal != 310_000 || dto.ShippingFee != 30_000 || dto.Total != 340_000 {
		t.Fatalf("money = unit %d subtotal %d fee %d total %d, want 155000/310000/30000/340000",
			dto.Items[0].UnitPrice, dto.Subtotal, dto.ShippingFee, dto.Total)
	}
	// A flat product uses colorId; a parts line must NOT carry one.
	if dto.Items[0].ColorId != nil {
		t.Fatalf("parts line carries a flat colorId %v, want none", *dto.Items[0].ColorId)
	}
	// The persisted selection snapshot round-trips back on the DTO (order-independent membership check).
	if dto.Items[0].PartColors == nil || len(*dto.Items[0].PartColors) != 2 {
		t.Fatalf("partColors = %v, want 2 entries", dto.Items[0].PartColors)
	}
	wantPartColors := map[uuid.UUID]uuid.UUID{fx.partA: fx.colorA, fx.partB: fx.colorB}
	for _, pc := range *dto.Items[0].PartColors {
		if wantPartColors[pc.PartId] != pc.ColorId {
			t.Fatalf("partColor %v→%v not in the ordered selection", pc.PartId, pc.ColorId)
		}
	}
	if dto.Items[0].OptionChoices == nil || len(*dto.Items[0].OptionChoices) != 1 ||
		(*dto.Items[0].OptionChoices)[0].OptionId != fx.optSize || (*dto.Items[0].OptionChoices)[0].ChoiceId != fx.choiceM {
		t.Fatalf("optionChoices = %v, want [{%v,%v}]", dto.Items[0].OptionChoices, fx.optSize, fx.choiceM)
	}

	// Quote parity (oracle note c): the SAME selection quoted returns the SAME unit price the order charged.
	qresp, err := srv.QuotePrice(ctx, api.QuotePriceRequestObject{Body: &api.PriceQuoteInput{
		Items: []api.OrderItemInput{{
			ProductId:     fx.product,
			PartColors:    &[]api.PartColorSelection{{PartId: fx.partA, ColorId: fx.colorA}, {PartId: fx.partB, ColorId: fx.colorB}},
			OptionChoices: &[]api.OptionChoiceSelection{{OptionId: fx.optSize, ChoiceId: fx.choiceM}},
			Quantity:      2,
		}},
	}})
	if err != nil {
		t.Fatalf("QuotePrice: %v", err)
	}
	quote, ok := qresp.(api.QuotePrice200JSONResponse)
	if !ok {
		t.Fatalf("quote resp = %T, want 200", qresp)
	}
	if quote.Lines[0].UnitPrice != dto.Items[0].UnitPrice {
		t.Fatalf("quote unit %d != charge unit %d (quote must equal charge)", quote.Lines[0].UnitPrice, dto.Items[0].UnitPrice)
	}
}
