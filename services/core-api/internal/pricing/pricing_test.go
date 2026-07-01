package pricing

import (
	"errors"
	"math"
	"testing"
	"testing/quick"

	"github.com/google/uuid"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/order"
)

// fixture builds a product with one available + one unavailable color and a choice option + a
// text (engrave) option carrying maxChars, so a single struct exercises every PriceItem branch.
func fixture() (sqlc.Product, []sqlc.Color, []sqlc.Option, ids) {
	i := ids{
		product:  uuid.New(),
		colorOK:  uuid.New(),
		colorOut: uuid.New(),
		optSize:  uuid.New(),
		optText:  uuid.New(),
	}
	p := sqlc.Product{ID: i.product, BasePrice: 390_000}
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

type ids struct {
	product, colorOK, colorOut, optSize, optText uuid.UUID
}

func TestPriceItemBaseOnly(t *testing.T) {
	p, colors, options, _ := fixture()
	got, err := PriceItem(p, colors, options, Selection{})
	if err != nil {
		t.Fatalf("PriceItem: %v", err)
	}
	if got != 390_000 {
		t.Fatalf("unit = %d, want 390000 (base only)", got)
	}
}

func TestPriceItemColorAndOptions(t *testing.T) {
	p, colors, options, i := fixture()
	got, err := PriceItem(p, colors, options, Selection{
		ColorID:         &i.colorOK,
		OptionIDs:       []uuid.UUID{i.optSize, i.optText},
		Personalization: &order.Personalization{Text: "An", ZoneID: "front"},
	})
	if err != nil {
		t.Fatalf("PriceItem: %v", err)
	}
	// 390000 base + 20000 color + 50000 size + 30000 engrave
	if want := int64(490_000); got != want {
		t.Fatalf("unit = %d, want %d", got, want)
	}
}

func TestPriceItemRejectsInvalidSelection(t *testing.T) {
	p, colors, options, i := fixture()
	other := uuid.New()
	long := "chuỗi khắc vượt quá mười hai ký tự" // > 12 runes
	cases := map[string]struct {
		sel  Selection
		want error
	}{
		"color from another product":  {Selection{ColorID: &other}, ErrColorNotForProduct},
		"unavailable color":           {Selection{ColorID: &i.colorOut}, ErrColorUnavailable},
		"option from another product": {Selection{OptionIDs: []uuid.UUID{other}}, ErrOptionNotForProduct},
		"duplicate option":            {Selection{OptionIDs: []uuid.UUID{i.optSize, i.optSize}}, ErrDuplicateOption},
		"engrave too long": {Selection{
			OptionIDs:       []uuid.UUID{i.optText},
			Personalization: &order.Personalization{Text: long, ZoneID: "front"},
		}, ErrEngraveTooLong},
		"engrave without a text option": {Selection{
			OptionIDs:       []uuid.UUID{i.optSize},
			Personalization: &order.Personalization{Text: "An", ZoneID: "front"},
		}, ErrEngraveNotAllowed},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := PriceItem(p, colors, options, tc.sel); !errors.Is(err, tc.want) {
				t.Fatalf("err = %v, want %v", err, tc.want)
			}
		})
	}
}

// Engrave text at exactly maxChars (12 runes) is allowed; multibyte Vietnamese is counted in runes,
// not bytes (12 accented runes are ~24 bytes — a byte count would wrongly reject).
func TestPriceItemEngraveBoundary(t *testing.T) {
	p, colors, options, i := fixture()
	twelve := "ĐặngThuHằng!" // 12 runes
	if _, err := PriceItem(p, colors, options, Selection{
		OptionIDs:       []uuid.UUID{i.optText},
		Personalization: &order.Personalization{Text: twelve, ZoneID: "front"},
	}); err != nil {
		t.Fatalf("12-rune engrave rejected: %v", err)
	}
}

// A pathological catalog delta near int64 max is rejected as overflow rather than wrapping to a
// negative unit price. The caller controls the selection, not the deltas, but the guard is cheap.
func TestPriceItemOverflow(t *testing.T) {
	i := ids{product: uuid.New(), optSize: uuid.New()}
	p := sqlc.Product{ID: i.product, BasePrice: math.MaxInt64 - 10}
	options := []sqlc.Option{{ID: i.optSize, ProductID: i.product, Type: sqlc.OptionTypeChoice, PriceDelta: 100}}
	if _, err := PriceItem(p, nil, options, Selection{OptionIDs: []uuid.UUID{i.optSize}}); !errors.Is(err, ErrPriceOverflow) {
		t.Fatalf("err = %v, want ErrPriceOverflow", err)
	}
}

func TestShippingFee(t *testing.T) {
	rules := []byte(`[{"province":"Hà Nội","fee":25000},{"province":"*","fee":40000}]`)
	if fee, err := ShippingFee(rules, "Hà Nội"); err != nil || fee != 25_000 {
		t.Fatalf("exact: fee=%d err=%v, want 25000 nil", fee, err)
	}
	if fee, err := ShippingFee(rules, "Cà Mau"); err != nil || fee != 40_000 {
		t.Fatalf("wildcard fallback: fee=%d err=%v, want 40000 nil", fee, err)
	}
}

func TestShippingFeeNoMatch(t *testing.T) {
	rules := []byte(`[{"province":"Hà Nội","fee":25000}]`) // no "*" default
	if _, err := ShippingFee(rules, "Cà Mau"); !errors.Is(err, ErrNoShippingRule) {
		t.Fatalf("err = %v, want ErrNoShippingRule", err)
	}
	// The default-empty settings.shipping_rules jsonb (`[]`) also has no match.
	if _, err := ShippingFee([]byte(`[]`), "Hà Nội"); !errors.Is(err, ErrNoShippingRule) {
		t.Fatalf("empty rules err = %v, want ErrNoShippingRule", err)
	}
}

func TestShippingFeeRejectsMalformed(t *testing.T) {
	if _, err := ShippingFee([]byte(`{not json`), "Hà Nội"); !errors.Is(err, ErrMalformedShippingRules) {
		t.Fatalf("bad json err = %v, want ErrMalformedShippingRules", err)
	}
	if _, err := ShippingFee([]byte(`[{"province":"Hà Nội","fee":-1}]`), "Hà Nội"); !errors.Is(err, ErrMalformedShippingRules) {
		t.Fatalf("negative fee err = %v, want ErrMalformedShippingRules", err)
	}
}

// Property: over random bounded non-negative catalog values, PriceItem returns exactly
// base + colorDelta + Σ optionDeltas — pinning "the price is the sum of catalog parts, never a
// client value" behaviourally (the type already omits any client price).
func TestPriceItemIsSumOfCatalogParts(t *testing.T) {
	f := func(base, colorDelta uint32, optDeltas []uint16) bool {
		productID := uuid.New()
		colorID := uuid.New()
		p := sqlc.Product{ID: productID, BasePrice: int64(base)}
		colors := []sqlc.Color{{ID: colorID, ProductID: productID, Available: true, PriceDelta: int64(colorDelta)}}

		want := int64(base) + int64(colorDelta)
		options := make([]sqlc.Option, 0, len(optDeltas))
		optIDs := make([]uuid.UUID, 0, len(optDeltas))
		for _, d := range optDeltas {
			id := uuid.New()
			options = append(options, sqlc.Option{ID: id, ProductID: productID, Type: sqlc.OptionTypeChoice, PriceDelta: int64(d)})
			optIDs = append(optIDs, id)
			want += int64(d)
		}

		got, err := PriceItem(p, colors, options, Selection{ColorID: &colorID, OptionIDs: optIDs})
		return err == nil && got == want && got >= 0
	}
	if err := quick.Check(f, &quick.Config{MaxCount: 500}); err != nil {
		t.Fatalf("pricing property failed: %v", err)
	}
}
