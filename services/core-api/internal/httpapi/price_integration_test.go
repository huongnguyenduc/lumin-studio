package httpapi

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
)

// Integration tests for the QuotePrice handler against real Postgres (testcontainers: skip local
// without Docker, run in CI — ADR-020; startPostgres + seedCheckoutCatalog live in the sibling
// integration files). They drive the FULL public router (no cookie) to prove POST /price/quote is
// mounted, classified authPublic, and returns server-authoritative line/subtotal money — plus that
// every selection/product rejection renders its ADR-032 envelope (same PRODUCT_UNAVAILABLE for
// unknown and archived, so the public surface can't probe hidden catalog rows).

// quoteBodyJSON builds a `{"items":[…]}` request body from raw line maps.
func quoteBodyJSON(t *testing.T, items ...map[string]any) string {
	t.Helper()
	raw, err := json.Marshal(map[string]any{"items": items})
	if err != nil {
		t.Fatalf("marshal quote body: %v", err)
	}
	return string(raw)
}

func postQuote(router http.Handler, bodyJSON string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/price/quote", strings.NewReader(bodyJSON))
	req.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(rec, req)
	return rec
}

// A multi-line quote through the public router with NO cookie: proves the mount + authPublic gate,
// and that every unitPrice/lineTotal + the subtotal are server-derived from the catalog (int-VND).
func TestQuotePriceEndToEnd(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()
	fx := seedCheckoutCatalog(t, ctx, pool)
	srv := NewServer(slog.New(slog.NewTextHandler(io.Discard, nil)), pool, nil, nil)
	router := testAuthedRouter(srv)

	body := quoteBodyJSON(t,
		map[string]any{
			"productId":       fx.product.ID.String(),
			"colorId":         fx.colorMint.ID.String(),
			"optionIds":       []string{fx.optDimmer.ID.String(), fx.optEngrave.ID.String()},
			"quantity":        2,
			"personalization": map[string]any{"text": "Miu ơi", "zoneId": "front"},
		},
		map[string]any{"productId": fx.otherProduct.ID.String(), "quantity": 1},
	)
	rec := postQuote(router, body)
	if rec.Code != http.StatusOK {
		t.Fatalf("POST /price/quote (no cookie) = %d, want 200 (mount + authPublic; body=%s)", rec.Code, rec.Body.String())
	}
	if sc := rec.Header().Get("Set-Cookie"); sc != "" {
		t.Errorf("a pricing read set a cookie %q, want none", sc)
	}

	var got api.PriceQuote
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode quote: %v", err)
	}
	if len(got.Lines) != 2 {
		t.Fatalf("lines = %d, want 2", len(got.Lines))
	}
	// line 1: 390k base + 20k color + 90k dimmer + 50k engrave = 550k, ×2 = 1,100,000.
	if got.Lines[0].UnitPrice != 550_000 || got.Lines[0].Quantity != 2 || got.Lines[0].LineTotal != 1_100_000 {
		t.Fatalf("line[0] = %+v, want unit 550000 qty 2 total 1100000", got.Lines[0])
	}
	// line 2: base only, ×1.
	if got.Lines[1].UnitPrice != 390_000 || got.Lines[1].Quantity != 1 || got.Lines[1].LineTotal != 390_000 {
		t.Fatalf("line[1] = %+v, want unit 390000 qty 1 total 390000", got.Lines[1])
	}
	// subtotal = Σ lineTotal; no shipping/tax added.
	if got.Subtotal != 1_490_000 {
		t.Fatalf("subtotal = %d, want 1490000 (line/subtotal only, no shipping)", got.Subtotal)
	}
	// No province in the request → shippingFee/total folded out entirely (byte-identical to the
	// pre-P2-b shape; the omitempty pointers stay nil).
	if got.ShippingFee != nil || got.Total != nil {
		t.Fatalf("no-province quote leaked shippingFee/total: %+v", got)
	}
}

// Every rejection renders its ADR-032 envelope over HTTP. Unknown and archived products both yield
// PRODUCT_UNAVAILABLE (no catalog-existence leak); a bad selection yields INVALID_SELECTION with the
// derived messageKey; an over-limit engrave yields ENGRAVE_TOO_LONG; empty items yields NO_ITEMS.
func TestQuotePriceRejectionsEndToEnd(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()
	fx := seedCheckoutCatalog(t, ctx, pool)
	srv := NewServer(slog.New(slog.NewTextHandler(io.Discard, nil)), pool, nil, nil)
	router := testAuthedRouter(srv)

	line := func(patch map[string]any) map[string]any {
		m := map[string]any{"productId": fx.product.ID.String(), "quantity": 1}
		for k, v := range patch {
			m[k] = v
		}
		return m
	}
	cases := []struct {
		name string
		body string
		want string
	}{
		{"unknown-product", quoteBodyJSON(t, map[string]any{"productId": uuid.NewString(), "quantity": 1}), codeProductUnavailable},
		{"archived-product", quoteBodyJSON(t, map[string]any{"productId": fx.archived.ID.String(), "quantity": 1}), codeProductUnavailable},
		{"foreign-color", quoteBodyJSON(t, line(map[string]any{"colorId": fx.otherColor.ID.String()})), codeInvalidSelection},
		{"unavailable-color", quoteBodyJSON(t, line(map[string]any{"colorId": fx.colorSold.ID.String()})), codeColorUnavailable},
		{"engrave-too-long", quoteBodyJSON(t, line(map[string]any{
			"optionIds":       []string{fx.optEngrave.ID.String()},
			"personalization": map[string]any{"text": strings.Repeat("â", 21), "zoneId": "front"},
		})), codeEngraveTooLong},
		{"empty-items", `{"items":[]}`, codeNoItems},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := postQuote(router, tc.body)
			if rec.Code != http.StatusUnprocessableEntity {
				t.Fatalf("status = %d, want 422 (body=%s)", rec.Code, rec.Body.String())
			}
			var env api.ErrorEnvelope
			if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
				t.Fatalf("decode envelope: %v", err)
			}
			if env.Code != tc.want || env.MessageKey != "errors."+tc.want {
				t.Fatalf("envelope = %s/%s, want %s/errors.%s", env.Code, env.MessageKey, tc.want, tc.want)
			}
		})
	}
}

// quoteBodyProvince builds a `{"items":[…],"province":…}` body — the P2-b path that folds shipping
// + total into the quote.
func quoteBodyProvince(t *testing.T, province string, items ...map[string]any) string {
	t.Helper()
	raw, err := json.Marshal(map[string]any{"items": items, "province": province})
	if err != nil {
		t.Fatalf("marshal quote body: %v", err)
	}
	return string(raw)
}

// P2-b parity — the money-integrity wall: for the SAME personalized cart + province, the quote's
// subtotal/shippingFee/total MUST equal what POST /orders actually charges. A customer who sees a
// total at checkout that differs from what the order records is a dispute. Both paths route the
// engrave-surcharged unit prices through the same pricing.PriceItem + money.CalcTotals, so this pins
// that the quote endpoint feeds CalcTotals the same LineItems + fee CreateOrderTx.lineItems does.
func TestQuotePriceParityWithOrder(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()
	fx := seedCheckoutCatalog(t, ctx, pool)
	setShippingRules(t, ctx, pool, `[{"province":"Hà Nội","fee":30000},{"province":"*","fee":45000}]`)
	setBankAccount(t, ctx, pool) // P2-a: the parity order is a web create, which needs a configured STK
	srv := NewServer(slog.New(slog.NewTextHandler(io.Discard, nil)), pool, nil, nil, WithPaymentProofUploads(newTestProofStore()))
	router := testAuthedRouter(srv)

	// One engraved line: 390k base + 20k color + 90k dimmer + 50k engrave = 550k, ×2.
	item := map[string]any{
		"productId":       fx.product.ID.String(),
		"colorId":         fx.colorMint.ID.String(),
		"optionIds":       []string{fx.optDimmer.ID.String(), fx.optEngrave.ID.String()},
		"quantity":        2,
		"personalization": map[string]any{"text": "Miu ơi", "zoneId": "front"},
	}

	rec := postQuote(router, quoteBodyProvince(t, "Hà Nội", item))
	if rec.Code != http.StatusOK {
		t.Fatalf("quote with province = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	var quote api.PriceQuote
	if err := json.Unmarshal(rec.Body.Bytes(), &quote); err != nil {
		t.Fatalf("decode quote: %v", err)
	}
	if quote.ShippingFee == nil || quote.Total == nil {
		t.Fatalf("province quote omitted shippingFee/total: %+v", quote)
	}

	// webBody defaults shippingAddress.province = "Hà Nội" — matches the quote province.
	order := mustCreateOrder(t, srv, ctx, webBody(map[string]any{
		"items":                []any{item},
		"personalizationAck":   true,
		"engraveEchoConfirmed": true,
	}))

	// The parity assertion: quote money == order money, field for field.
	if quote.Subtotal != order.Subtotal || *quote.ShippingFee != order.ShippingFee || *quote.Total != order.Total {
		t.Fatalf("PARITY BROKEN: quote {subtotal %d fee %d total %d} != order {subtotal %d fee %d total %d}",
			quote.Subtotal, *quote.ShippingFee, *quote.Total, order.Subtotal, order.ShippingFee, order.Total)
	}
	// Concrete numbers too, so BOTH paths can't drift together undetected: 550k×2 + 30k = 1,130,000.
	if quote.Subtotal != 1_100_000 || *quote.ShippingFee != 30_000 || *quote.Total != 1_130_000 {
		t.Fatalf("quote money = subtotal %d fee %d total %d, want 1100000/30000/1130000",
			quote.Subtotal, *quote.ShippingFee, *quote.Total)
	}
}

// A province with no matching shipping rule (and no "*" wildcard) is 422 NO_SHIPPING_RULE — never a
// silent ₫0 total. Mirrors the checkout charge path's guard on the quote surface.
func TestQuotePriceProvinceNoRule(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()
	fx := seedCheckoutCatalog(t, ctx, pool)
	setShippingRules(t, ctx, pool, `[{"province":"Hà Nội","fee":30000}]`) // no wildcard
	srv := NewServer(slog.New(slog.NewTextHandler(io.Discard, nil)), pool, nil, nil)
	router := testAuthedRouter(srv)

	body := quoteBodyProvince(t, "Cà Mau", map[string]any{"productId": fx.product.ID.String(), "quantity": 1})
	rec := postQuote(router, body)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422 (body=%s)", rec.Code, rec.Body.String())
	}
	var env api.ErrorEnvelope
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("decode envelope: %v", err)
	}
	if env.Code != codeNoShippingRule || env.MessageKey != "errors."+codeNoShippingRule {
		t.Fatalf("envelope = %s/%s, want %s/errors.%s", env.Code, env.MessageKey, codeNoShippingRule, codeNoShippingRule)
	}
}
