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
