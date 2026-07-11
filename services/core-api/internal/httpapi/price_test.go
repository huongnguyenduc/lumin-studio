package httpapi

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"math"
	"testing"

	"github.com/google/uuid"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/money"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/pricing"
)

// quoteFixture builds an active product with one available + one unavailable color, a choice
// option, and a text (engrave) option carrying maxChars — enough to exercise every priceQuoteLine
// branch without a database (mirrors pricing.fixture, which is package-private there).
func quoteFixture() (sqlc.Product, []sqlc.Color, []sqlc.Option, quoteIDs) {
	i := quoteIDs{
		product:  uuid.New(),
		colorOK:  uuid.New(),
		colorOut: uuid.New(),
		optSize:  uuid.New(),
		optText:  uuid.New(),
	}
	p := sqlc.Product{ID: i.product, Status: sqlc.ProductStatusActive, BasePrice: 390_000}
	colors := []sqlc.Color{
		{ID: i.colorOK, ProductID: i.product, Name: "Trắng", Available: true, PriceDelta: 20_000},
		{ID: i.colorOut, ProductID: i.product, Name: "Vàng", Available: false, PriceDelta: 15_000},
	}
	max := int32(12)
	options := []sqlc.Option{
		{ID: i.optSize, ProductID: i.product, Label: "Cỡ lớn", Type: sqlc.OptionTypeChoice, PriceDelta: 50_000},
		{ID: i.optText, ProductID: i.product, Label: "Khắc tên", Type: sqlc.OptionTypeText, PriceDelta: 30_000, MaxChars: &max},
	}
	return p, colors, options, i
}

type quoteIDs struct {
	product, colorOK, colorOut, optSize, optText uuid.UUID
}

func TestPriceQuoteLineBaseOnly(t *testing.T) {
	p, colors, options, i := quoteFixture()
	line, err := priceQuoteLine(p, colors, options, nil, nil, api.OrderItemInput{ProductId: i.product, Quantity: 1})
	if err != nil {
		t.Fatalf("priceQuoteLine: %v", err)
	}
	if line.UnitPrice != 390_000 || line.LineTotal != 390_000 || line.Quantity != 1 {
		t.Fatalf("line = %+v, want unit/total 390000 qty 1", line)
	}
}

func TestPriceQuoteLineColorAndOptions(t *testing.T) {
	p, colors, options, i := quoteFixture()
	line, err := priceQuoteLine(p, colors, options, nil, nil, api.OrderItemInput{
		ProductId:       i.product,
		ColorId:         &i.colorOK,
		OptionIds:       &[]uuid.UUID{i.optSize, i.optText},
		Personalization: &api.Personalization{Text: "An", ZoneId: "front"},
		Quantity:        3,
	})
	if err != nil {
		t.Fatalf("priceQuoteLine: %v", err)
	}
	// unit = 390000 base + 20000 color + 50000 size + 30000 engrave = 490000; lineTotal = ×3.
	if line.UnitPrice != 490_000 || line.LineTotal != 1_470_000 || line.Quantity != 3 {
		t.Fatalf("line = %+v, want unit 490000 total 1470000 qty 3", line)
	}
}

// A selection referencing catalog rows that don't belong together (or an over-limit engrave)
// surfaces the pricing sentinel verbatim — mapError turns each into its 422 envelope. The engrave
// case uses a >12-rune string to prove the rune-count (not byte-count) maxChars gate.
func TestPriceQuoteLineRejectsInvalidSelection(t *testing.T) {
	p, colors, options, i := quoteFixture()
	other := uuid.New()
	long := "chuỗi khắc vượt quá mười hai ký tự" // > 12 runes
	cases := map[string]struct {
		it   api.OrderItemInput
		want error
	}{
		"color from another product":  {api.OrderItemInput{ProductId: i.product, ColorId: &other, Quantity: 1}, pricing.ErrColorNotForProduct},
		"unavailable color":           {api.OrderItemInput{ProductId: i.product, ColorId: &i.colorOut, Quantity: 1}, pricing.ErrColorUnavailable},
		"option from another product": {api.OrderItemInput{ProductId: i.product, OptionIds: &[]uuid.UUID{other}, Quantity: 1}, pricing.ErrOptionNotForProduct},
		"duplicate option":            {api.OrderItemInput{ProductId: i.product, OptionIds: &[]uuid.UUID{i.optSize, i.optSize}, Quantity: 1}, pricing.ErrDuplicateOption},
		"engrave without a text option": {api.OrderItemInput{
			ProductId:       i.product,
			OptionIds:       &[]uuid.UUID{i.optSize},
			Personalization: &api.Personalization{Text: "An", ZoneId: "front"},
			Quantity:        1,
		}, pricing.ErrEngraveNotAllowed},
		"engrave too long": {api.OrderItemInput{
			ProductId:       i.product,
			OptionIds:       &[]uuid.UUID{i.optText},
			Personalization: &api.Personalization{Text: long, ZoneId: "front"},
			Quantity:        1,
		}, pricing.ErrEngraveTooLong},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := priceQuoteLine(p, colors, options, nil, nil, tc.it); !errors.Is(err, tc.want) {
				t.Fatalf("err = %v, want %v", err, tc.want)
			}
		})
	}
}

// A pathological catalog delta that overflows the unit price surfaces pricing.ErrPriceOverflow
// (→ INVALID_AMOUNT), never a wrapped-negative price.
func TestPriceQuoteLineUnitOverflow(t *testing.T) {
	productID := uuid.New()
	optID := uuid.New()
	p := sqlc.Product{ID: productID, Status: sqlc.ProductStatusActive, BasePrice: math.MaxInt64 - 10}
	options := []sqlc.Option{{ID: optID, ProductID: productID, Type: sqlc.OptionTypeChoice, PriceDelta: 100}}
	it := api.OrderItemInput{ProductId: productID, OptionIds: &[]uuid.UUID{optID}, Quantity: 1}
	if _, err := priceQuoteLine(p, nil, options, nil, nil, it); !errors.Is(err, pricing.ErrPriceOverflow) {
		t.Fatalf("err = %v, want ErrPriceOverflow", err)
	}
}

// The line-total multiply is overflow-guarded by money.CalcTotals: a huge unit × quantity is
// rejected as INVALID_AMOUNT even though the unit price itself is representable.
func TestPriceQuoteLineQuantityOverflow(t *testing.T) {
	p, colors, options, i := quoteFixture()
	p.BasePrice = math.MaxInt64
	it := api.OrderItemInput{ProductId: i.product, Quantity: 2}
	if _, err := priceQuoteLine(p, colors, options, nil, nil, it); !errors.Is(err, money.ErrInvalidAmount) {
		t.Fatalf("err = %v, want money.ErrInvalidAmount", err)
	}
}

// A non-positive quantity is rejected by the shared money guard (mirrors CalcTotals qty<=0), not
// silently priced as a ₫0 line.
func TestPriceQuoteLineNonPositiveQuantity(t *testing.T) {
	p, colors, options, i := quoteFixture()
	it := api.OrderItemInput{ProductId: i.product, Quantity: 0}
	if _, err := priceQuoteLine(p, colors, options, nil, nil, it); !errors.Is(err, money.ErrInvalidAmount) {
		t.Fatalf("err = %v, want money.ErrInvalidAmount", err)
	}
}

// quoteTotals is Σ lineTotal (the value a client could add up, but computed with the guarded money
// math so the aggregate is server-authoritative) plus the folded-in shipping fee. fee 0 → subtotal
// only; a fee → total == subtotal + fee, the same CalcTotals the order charge path runs (P2-b parity).
func TestQuoteTotalsSumsLineTotals(t *testing.T) {
	lines := []api.PriceQuoteLine{
		{UnitPrice: 550_000, Quantity: 2, LineTotal: 1_100_000},
		{UnitPrice: 390_000, Quantity: 1, LineTotal: 390_000},
	}
	got, err := quoteTotals(lines, 0)
	if err != nil {
		t.Fatalf("quoteTotals: %v", err)
	}
	if got.Subtotal != 1_490_000 {
		t.Fatalf("subtotal = %d, want 1490000 (Σ lineTotal)", got.Subtotal)
	}
	withFee, err := quoteTotals(lines, 30_000)
	if err != nil {
		t.Fatalf("quoteTotals(fee): %v", err)
	}
	if withFee.Subtotal != 1_490_000 || withFee.ShippingFee != 30_000 || withFee.Total != 1_520_000 {
		t.Fatalf("with fee = subtotal %d fee %d total %d, want 1490000/30000/1520000",
			withFee.Subtotal, withFee.ShippingFee, withFee.Total)
	}
}

// The reason quoteTotals routes through money.CalcTotals rather than a naive Σ: two lines that
// EACH fit int64 but whose sum overflows must surface INVALID_AMOUNT, never a wrapped-negative
// subtotal. A mutant that dropped the aggregate guard and returned a plain sum would pass every
// other test but fail this one.
func TestQuoteTotalsCrossLineOverflow(t *testing.T) {
	lines := []api.PriceQuoteLine{
		{UnitPrice: math.MaxInt64, Quantity: 1, LineTotal: math.MaxInt64},
		{UnitPrice: math.MaxInt64, Quantity: 1, LineTotal: math.MaxInt64},
	}
	if _, err := quoteTotals(lines, 0); !errors.Is(err, money.ErrInvalidAmount) {
		t.Fatalf("err = %v, want money.ErrInvalidAmount (cross-line overflow)", err)
	}
}

// The pre-DB request-shape branches (nil body, empty items, over the item cap) resolve BEFORE any
// catalog read, so they are provable Docker-free with a nil pool. This pins that a malformed body
// is a 400 VALIDATION, an empty cart is 422 NO_ITEMS, and an over-cap items[] is a 400 (the DoS
// guard the schema's maxItems declares but oapi-codegen does not enforce).
func TestQuotePricePreDBRejections(t *testing.T) {
	srv := NewServer(slog.New(slog.NewTextHandler(io.Discard, nil)), nil, nil, nil)
	ctx := context.Background()

	t.Run("nil body is 400 VALIDATION", func(t *testing.T) {
		resp, err := srv.QuotePrice(ctx, api.QuotePriceRequestObject{Body: nil})
		if err != nil {
			t.Fatalf("err = %v, want a typed 400 response", err)
		}
		bad, ok := resp.(api.QuotePrice400JSONResponse)
		if !ok {
			t.Fatalf("resp = %T, want QuotePrice400JSONResponse", resp)
		}
		if bad.Code != codeValidation {
			t.Fatalf("code = %q, want %s", bad.Code, codeValidation)
		}
	})

	t.Run("empty items is 422 NO_ITEMS", func(t *testing.T) {
		_, err := srv.QuotePrice(ctx, api.QuotePriceRequestObject{Body: &api.PriceQuoteInput{Items: nil}})
		if !errors.Is(err, db.ErrNoItems) {
			t.Fatalf("err = %v, want db.ErrNoItems", err)
		}
	})

	t.Run("over the item cap is 400 VALIDATION (before any DB read)", func(t *testing.T) {
		items := make([]api.OrderItemInput, maxQuoteItems+1)
		for i := range items {
			items[i] = api.OrderItemInput{ProductId: uuid.New(), Quantity: 1}
		}
		resp, err := srv.QuotePrice(ctx, api.QuotePriceRequestObject{Body: &api.PriceQuoteInput{Items: items}})
		if err != nil {
			t.Fatalf("err = %v, want a typed 400 response (nil pool ⇒ the cap must fire pre-DB)", err)
		}
		bad, ok := resp.(api.QuotePrice400JSONResponse)
		if !ok {
			t.Fatalf("resp = %T, want QuotePrice400JSONResponse", resp)
		}
		if bad.Code != codeValidation {
			t.Fatalf("code = %q, want %s", bad.Code, codeValidation)
		}
	})
}
