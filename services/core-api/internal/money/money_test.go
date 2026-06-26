package money

import (
	"errors"
	"testing"
	"testing/quick"
)

// MNY-01 — totals are computed server-side and sum(parts) == total.
func TestMNY01PartsSumEqualsTotal(t *testing.T) {
	in := TotalsInput{
		Items: []LineItem{
			{UnitPrice: 390_000, Quantity: 2, ColorDelta: 20_000, OptionDeltas: []int64{15_000, 5_000}},
			{UnitPrice: 120_000, Quantity: 1},
		},
		ShippingFee: 30_000,
	}
	got, err := CalcTotals(in)
	if err != nil {
		t.Fatalf("CalcTotals errored: %v", err)
	}
	wantSubtotal := int64(2*(390_000+20_000+15_000+5_000) + 1*120_000)
	if got.Subtotal != wantSubtotal {
		t.Fatalf("subtotal = %d, want %d", got.Subtotal, wantSubtotal)
	}
	if got.Total != wantSubtotal+30_000 {
		t.Fatalf("total = %d, want %d", got.Total, wantSubtotal+30_000)
	}
	if got.ShippingFee != 30_000 {
		t.Fatalf("shippingFee = %d, want 30000", got.ShippingFee)
	}
}

// MNY-02 — total is derived purely from the parts. TotalsInput has no Total field,
// so a client total is not even representable; changing only the parts changes the
// result. This pins "never trust a client total" at the type level + behaviourally.
func TestMNY02TotalDerivedFromParts(t *testing.T) {
	base := TotalsInput{Items: []LineItem{{UnitPrice: 100_000, Quantity: 1}}, ShippingFee: 0}
	baseTotals, err := CalcTotals(base)
	if err != nil {
		t.Fatalf("base errored: %v", err)
	}
	if baseTotals.Total != 100_000 {
		t.Fatalf("base total = %d, want 100000", baseTotals.Total)
	}
	// Bumping a part (and nothing else) must move the total by exactly that much.
	bumped := TotalsInput{Items: []LineItem{{UnitPrice: 100_000, Quantity: 1, ColorDelta: 7_000}}, ShippingFee: 0}
	bumpedTotals, err := CalcTotals(bumped)
	if err != nil {
		t.Fatalf("bumped errored: %v", err)
	}
	if bumpedTotals.Total-baseTotals.Total != 7_000 {
		t.Fatalf("delta = %d, want 7000", bumpedTotals.Total-baseTotals.Total)
	}
}

func TestCalcTotalsEmptyItems(t *testing.T) {
	got, err := CalcTotals(TotalsInput{Items: nil, ShippingFee: 25_000})
	if err != nil {
		t.Fatalf("empty items errored: %v", err)
	}
	if got.Subtotal != 0 || got.Total != 25_000 {
		t.Fatalf("got %+v, want subtotal 0 total 25000", got)
	}
}

func TestCalcTotalsRejectsInvalid(t *testing.T) {
	cases := map[string]TotalsInput{
		"negative shipping":    {Items: []LineItem{{UnitPrice: 1, Quantity: 1}}, ShippingFee: -1},
		"negative unit price":  {Items: []LineItem{{UnitPrice: -1, Quantity: 1}}},
		"zero quantity":        {Items: []LineItem{{UnitPrice: 1, Quantity: 0}}},
		"negative quantity":    {Items: []LineItem{{UnitPrice: 1, Quantity: -3}}},
		"negative color delta": {Items: []LineItem{{UnitPrice: 1, Quantity: 1, ColorDelta: -1}}},
		"negative opt delta":   {Items: []LineItem{{UnitPrice: 1, Quantity: 1, OptionDeltas: []int64{-1}}}},
	}
	for name, in := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := CalcTotals(in); err == nil {
				t.Fatal("expected an error, got nil")
			} else if !errors.Is(err, ErrInvalidAmount) {
				t.Fatalf("err = %v, want ErrInvalidAmount", err)
			}
		})
	}
}

// A large-but-realistic total computes exactly — the overflow guard must not
// false-positive on big real orders (1e9 VND × 1000 units = 1e12, far below int64).
func TestCalcTotalsLargeButValid(t *testing.T) {
	got, err := CalcTotals(TotalsInput{Items: []LineItem{{UnitPrice: 1_000_000_000, Quantity: 1_000}}, ShippingFee: 50_000})
	if err != nil {
		t.Fatalf("valid large total errored: %v", err)
	}
	if want := int64(1_000_000_000*1_000 + 50_000); got.Total != want {
		t.Fatalf("total = %d, want %d", got.Total, want)
	}
}

// int64 overflow is rejected (wrapped ErrInvalidAmount) rather than silently returning
// a negative total — a malicious quantity / delta must not wrap the authoritative calc.
func TestCalcTotalsRejectsOverflow(t *testing.T) {
	const huge = int64(1) << 62 // ~4.6e18; two of these overflow int64
	cases := map[string]TotalsInput{
		"subtotal sum overflow":        {Items: []LineItem{{UnitPrice: huge, Quantity: 1}, {UnitPrice: huge, Quantity: 1}, {UnitPrice: huge, Quantity: 1}}},
		"line multiply overflow":       {Items: []LineItem{{UnitPrice: huge, Quantity: 3}}},
		"option add overflow":          {Items: []LineItem{{UnitPrice: huge, Quantity: 1, OptionDeltas: []int64{huge, huge}}}},
		"total plus shipping overflow": {Items: []LineItem{{UnitPrice: huge, Quantity: 1}}, ShippingFee: huge},
	}
	for name, in := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := CalcTotals(in); err == nil {
				t.Fatal("expected overflow to be rejected, got nil")
			} else if !errors.Is(err, ErrInvalidAmount) {
				t.Fatalf("err = %v, want ErrInvalidAmount", err)
			}
		})
	}
}

// Property (ADR-027 REC-E): over random bounded non-negative inputs, totals never
// error and sum(parts) == total. Bounds keep products well within int64.
func TestMoneySumEqualsTotalProperty(t *testing.T) {
	f := func(rawUnit, rawColor, rawOpt1, rawOpt2, rawShip uint16, rawQty uint8) bool {
		unit := int64(rawUnit) * 1_000
		color := int64(rawColor)
		opt1, opt2 := int64(rawOpt1), int64(rawOpt2)
		ship := int64(rawShip) * 1_000
		qty := int64(rawQty)%50 + 1 // 1..50
		got, err := CalcTotals(TotalsInput{
			Items:       []LineItem{{UnitPrice: unit, Quantity: qty, ColorDelta: color, OptionDeltas: []int64{opt1, opt2}}},
			ShippingFee: ship,
		})
		if err != nil {
			return false
		}
		wantSubtotal := qty * (unit + color + opt1 + opt2)
		return got.Subtotal == wantSubtotal && got.Total == wantSubtotal+ship && got.ShippingFee == ship
	}
	if err := quick.Check(f, &quick.Config{MaxCount: 1000}); err != nil {
		t.Fatal(err)
	}
}
