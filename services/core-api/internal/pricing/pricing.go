// Package pricing holds the server-authoritative order-intake rules that sit BEFORE the money
// calc (internal/money): it derives each line's effective UnitPrice from the catalog and resolves
// the shipping fee from settings — both server-side, never trusting a client-supplied price
// (conventions.md §Tiền, ADR-019). CalcTotals then sums the derived unit prices; a client total is
// not even representable there. This package is the "authenticity" gate the CreateOrderTx seam
// documents it does NOT perform: it faithfully snapshots whatever UnitPrice it is handed, so the
// checkout handler (PR-3g) MUST route every line through PriceItem first.
//
// It operates directly on the sqlc catalog rows the handler already reads (Product + its Colors +
// Options) — no parallel DTO — so the price can only come from persisted catalog data.
package pricing

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/order"
)

// Sentinel errors for an invalid selection. The checkout handler maps these to HTTP 422 via
// httpapi/errors.go (they never reach the wire verbatim — the i18n messageKey is derived from a
// mapped code, always-must #3). Kept as plain English sentinels: they are internal identifiers,
// not user copy.
var (
	// ErrColorNotForProduct — the selected color id is not one of the product's colors.
	ErrColorNotForProduct = errors.New("pricing: selected color does not belong to the product")
	// ErrColorUnavailable — the selected color exists but is marked unavailable (spec §03 "hết hàng").
	ErrColorUnavailable = errors.New("pricing: selected color is unavailable")
	// ErrOptionNotForProduct — a selected option id is not one of the product's options.
	ErrOptionNotForProduct = errors.New("pricing: selected option does not belong to the product")
	// ErrDuplicateOption — the same option id was selected more than once (would double-charge).
	ErrDuplicateOption = errors.New("pricing: option selected more than once")
	// ErrEngraveNotAllowed — engraving text was given but no engravable (text-type) option was selected.
	ErrEngraveNotAllowed = errors.New("pricing: engraving text requires a text option")
	// ErrEngraveTooLong — the engraving text exceeds the engrave option's maxChars (spec §05).
	ErrEngraveTooLong = errors.New("pricing: engraving exceeds the option's maxChars")
	// ErrPriceOverflow — the derived unit price overflowed int64 (a pathological catalog delta).
	ErrPriceOverflow = errors.New("pricing: unit price overflowed int64")
	// ErrNoShippingRule — no settings.shipping_rules entry (nor a "*" default) matches the province.
	ErrNoShippingRule = errors.New("pricing: no shipping rule matches the destination province")
	// ErrMalformedShippingRules — settings.shipping_rules is not a valid ShippingRule array.
	ErrMalformedShippingRules = errors.New("pricing: settings.shipping_rules is malformed")
)

// Selection is one order line's product choice as it arrives from the client. It carries NO price:
// PriceItem derives the authoritative UnitPrice from the catalog. OptionIDs / ColorID reference
// catalog rows; Personalization is the per-item engraving (nil = none).
type Selection struct {
	ColorID         *uuid.UUID             // nil when no color is chosen
	OptionIDs       []uuid.UUID            // selected option ids (each must belong to the product)
	Personalization *order.Personalization // nil = no engraving; Text validated against the engrave option's maxChars
}

// PriceItem derives the server-authoritative per-unit VND for one line and validates the selection
// against the product's own colors/options. `product` is the intake read (GetProductByID); `colors`
// and `options` are the product's full sets (ListColorsByProduct / ListOptionsByProduct) — passing
// the whole sets lets membership be checked by presence, so a color/option from a DIFFERENT product
// can never be priced in. Returns a wrapped sentinel (see the Err* above) on any invalid selection.
//
// UnitPrice = base_price + selected color delta + Σ selected option deltas. Every summand is a
// non-negative int VND (DB CHECK ≥ 0); the sum is overflow-checked (defense in depth — a malicious
// caller controls the *selection*, not the catalog deltas, but the guard costs nothing).
func PriceItem(product sqlc.Product, colors []sqlc.Color, options []sqlc.Option, sel Selection) (int64, error) {
	unit := product.BasePrice

	if sel.ColorID != nil {
		color, ok := findColor(colors, *sel.ColorID)
		if !ok {
			return 0, ErrColorNotForProduct
		}
		if !color.Available {
			return 0, ErrColorUnavailable
		}
		var overflow bool
		if unit, overflow = addChecked(unit, color.PriceDelta); overflow {
			return 0, ErrPriceOverflow
		}
	}

	seen := make(map[uuid.UUID]struct{}, len(sel.OptionIDs))
	var engrave *sqlc.Option // the text-type option the engraving belongs to, if any is selected
	for _, id := range sel.OptionIDs {
		if _, dup := seen[id]; dup {
			return 0, ErrDuplicateOption
		}
		seen[id] = struct{}{}

		opt, ok := findOption(options, id)
		if !ok {
			return 0, ErrOptionNotForProduct
		}
		if opt.Type == sqlc.OptionTypeText && engrave == nil {
			o := opt
			engrave = &o
		}
		var overflow bool
		if unit, overflow = addChecked(unit, opt.PriceDelta); overflow {
			return 0, ErrPriceOverflow
		}
	}

	if err := validateEngrave(sel.Personalization, engrave); err != nil {
		return 0, err
	}
	return unit, nil
}

// validateEngrave enforces the spec §05 char-limit rule: engraving text (if any) must sit within
// the selected engrave option's maxChars. A nil/empty personalization needs no option. Non-empty
// text with no text-type option selected is rejected — an engraving with no configured zone/limit
// is unpriceable and un-QC-able. maxChars is measured in runes (Vietnamese is multibyte).
func validateEngrave(p *order.Personalization, engrave *sqlc.Option) error {
	if p == nil || strings.TrimSpace(p.Text) == "" {
		return nil
	}
	if engrave == nil {
		return ErrEngraveNotAllowed
	}
	if engrave.MaxChars != nil && utf8.RuneCountInString(p.Text) > int(*engrave.MaxChars) {
		return ErrEngraveTooLong
	}
	return nil
}

func findColor(colors []sqlc.Color, id uuid.UUID) (sqlc.Color, bool) {
	for _, c := range colors {
		if c.ID == id {
			return c, true
		}
	}
	return sqlc.Color{}, false
}

func findOption(options []sqlc.Option, id uuid.UUID) (sqlc.Option, bool) {
	for _, o := range options {
		if o.ID == id {
			return o, true
		}
	}
	return sqlc.Option{}, false
}

// addChecked adds two NON-NEGATIVE int64 VND amounts, reporting true on overflow. Mirrors the
// money package's guard (kept local so pricing owns its derive without exporting money internals).
func addChecked(a, b int64) (int64, bool) {
	s := a + b
	return s, s < a // b >= 0, so a wrap makes the sum smaller than a
}

// ShippingRule is one row of the settings.shipping_rules jsonb table: a province-keyed fee, VN
// address model with NO district (ADR-017). Province "*" is the wildcard default (applied when no
// exact province matches), letting the admin set one flat fallback fee.
type ShippingRule struct {
	Province string `json:"province"`
	Fee      int64  `json:"fee"`
}

// ShippingFee resolves the destination province to a fee over the raw settings.shipping_rules jsonb
// (server computes shippingFee, spec §278). Exact province match wins; a "*" wildcard rule is the
// fallback. Returns ErrNoShippingRule when neither matches (the admin configured no rule for this
// province and no default) so an order can never land with a silently-zero shipping fee — the
// handler surfaces it as 422. A negative or malformed fee is rejected (defense: jsonb has no CHECK).
func ShippingFee(rulesJSON []byte, province string) (int64, error) {
	var rules []ShippingRule
	if len(rulesJSON) > 0 {
		if err := json.Unmarshal(rulesJSON, &rules); err != nil {
			return 0, fmt.Errorf("%w: %v", ErrMalformedShippingRules, err)
		}
	}
	want := strings.TrimSpace(province)
	fallback := int64(-1)
	haveFallback := false
	for _, r := range rules {
		if r.Fee < 0 {
			return 0, fmt.Errorf("%w: negative fee for %q", ErrMalformedShippingRules, r.Province)
		}
		switch strings.TrimSpace(r.Province) {
		case want:
			return r.Fee, nil
		case "*":
			fallback, haveFallback = r.Fee, true
		}
	}
	if haveFallback {
		return fallback, nil
	}
	return 0, ErrNoShippingRule
}
