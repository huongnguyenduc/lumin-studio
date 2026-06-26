// Package money holds the server-authoritative money rules: int-VND validation and
// CalcTotals (subtotal + shippingFee → total). The server is the source of truth for
// totals — a client-supplied total is NEVER trusted (conventions.md §Tiền, ADR-019).
// This ports the server half of packages/core/src/money.ts.
//
// Amounts are int64 VND (no decimals): the integer type gives the "int VND" invariant
// for free, so the only remaining checks are non-negative amounts and a positive
// quantity. Display formatting (formatVnd → "390.000₫") stays in packages/core for the
// TS frontends; a Go formatter for server-rendered surfaces (email / OG cards) lands
// with those surfaces, keeping this file to the calc invariant.
//
// MUTATION-GATE ANCHORS (forward-compat, mirrors money.ts): the hash-prefixed markers
// SUBTOTAL / TOTAL each on their own code line. Keep them single-line and intact.
package money

import (
	"errors"
	"fmt"
)

// ErrInvalidAmount is returned for a negative VND amount or a non-positive quantity.
var ErrInvalidAmount = errors.New("money: invalid amount")

// LineItem is one priced order line. The server recomputes from these fields and
// never trusts a precomputed line or order total.
type LineItem struct {
	UnitPrice    int64   // int VND
	Quantity     int64   // must be positive
	ColorDelta   int64   // int VND, may be 0
	OptionDeltas []int64 // each int VND
}

// TotalsInput intentionally has NO total field — the server computes it (ADR-019),
// so a client total is not even representable here.
type TotalsInput struct {
	Items       []LineItem
	ShippingFee int64 // int VND
}

// Totals is the server-computed result.
type Totals struct {
	Subtotal    int64
	ShippingFee int64
	Total       int64
}

// errOverflow (wrapping ErrInvalidAmount) is returned when a computation exceeds the
// int64 range. The server rejects absurd magnitudes rather than silently wrapping to a
// negative total — defense-in-depth on the authoritative money path, where a malicious
// quantity is the realistic vector. Real VND orders sit ~12+ orders of magnitude below
// this ceiling, so no genuine order is affected.
var errOverflow = fmt.Errorf("%w: số tiền vượt giới hạn int64 (tràn số)", ErrInvalidAmount)

// assertNonNegVND rejects a negative VND amount with a labelled error.
func assertNonNegVND(n int64, label string) error {
	if n < 0 {
		return fmt.Errorf("%w: %s không được âm", ErrInvalidAmount, label)
	}
	return nil
}

// addChecked adds two NON-NEGATIVE int64 amounts, reporting false on overflow.
func addChecked(a, b int64) (int64, bool) {
	s := a + b
	return s, s >= a // b >= 0, so a wrap makes the sum smaller than a
}

// mulChecked multiplies two NON-NEGATIVE int64 amounts, reporting false on overflow.
func mulChecked(a, b int64) (int64, bool) {
	if a == 0 || b == 0 {
		return 0, true
	}
	p := a * b
	return p, p/a == b
}

// CalcTotals computes server-authoritative totals from line items + shippingFee. It
// NEVER trusts a client-supplied total. Returns ErrInvalidAmount (wrapped) on a negative
// amount, a non-positive quantity, or an int64 overflow.
func CalcTotals(in TotalsInput) (Totals, error) {
	if err := assertNonNegVND(in.ShippingFee, "Phí vận chuyển"); err != nil {
		return Totals{}, err
	}
	var subtotal int64
	for _, item := range in.Items {
		if err := assertNonNegVND(item.UnitPrice, "Đơn giá"); err != nil {
			return Totals{}, err
		}
		if item.Quantity <= 0 {
			return Totals{}, fmt.Errorf("%w: Số lượng phải là số nguyên dương", ErrInvalidAmount)
		}
		if err := assertNonNegVND(item.ColorDelta, "Chênh lệch màu"); err != nil {
			return Totals{}, err
		}
		unit, ok := addChecked(item.UnitPrice, item.ColorDelta)
		if !ok {
			return Totals{}, errOverflow
		}
		for _, d := range item.OptionDeltas {
			if err := assertNonNegVND(d, "Chênh lệch tuỳ chọn"); err != nil {
				return Totals{}, err
			}
			if unit, ok = addChecked(unit, d); !ok {
				return Totals{}, errOverflow
			}
		}
		line, ok := mulChecked(item.Quantity, unit) // #SUBTOTAL
		if !ok {
			return Totals{}, errOverflow
		}
		if subtotal, ok = addChecked(subtotal, line); !ok {
			return Totals{}, errOverflow
		}
	}
	total, ok := addChecked(subtotal, in.ShippingFee) // #TOTAL
	if !ok {
		return Totals{}, errOverflow
	}
	return Totals{Subtotal: subtotal, ShippingFee: in.ShippingFee, Total: total}, nil
}
