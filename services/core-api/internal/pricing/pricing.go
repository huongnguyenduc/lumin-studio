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

	// --- ADR-037 configurator (per-part colours + per-option choices) ---
	// ErrColorForPartsProduct — a flat ColorID was given for a product that has named parts: a parts
	// product's colours are chosen per-part via PartColors, so a single ColorID is ambiguous.
	ErrColorForPartsProduct = errors.New("pricing: flat color given for a product with parts")
	// ErrPartColorForFlatProduct — a per-part colour was given for a product that has no parts.
	ErrPartColorForFlatProduct = errors.New("pricing: per-part color given for a flat product")
	// ErrMissingPartColor — a product part has no colour selected (every part needs exactly one).
	ErrMissingPartColor = errors.New("pricing: a part has no color selected")
	// ErrDuplicatePartColor — the same part was given a colour more than once.
	ErrDuplicatePartColor = errors.New("pricing: a part's color was selected more than once")
	// ErrColorNotForPart — a selected colour does not belong to the part it was claimed for (the
	// cross-charge guard: pay part-A's delta but pin part-B).
	ErrColorNotForPart = errors.New("pricing: selected color does not belong to the claimed part")
	// ErrOptionNeedsChoice — a `choice` option that offers choices was toggled as a bare option instead
	// of picking one of its choices (it must be selected via OptionChoices).
	ErrOptionNeedsChoice = errors.New("pricing: option requires one of its choices")
	// ErrChoiceNotForOption — a selected choice id is not one of its option's choices (or the option is
	// not a choice option).
	ErrChoiceNotForOption = errors.New("pricing: selected choice does not belong to the option")
	// ErrDuplicateOptionChoice — the same choice-option was picked more than once.
	ErrDuplicateOptionChoice = errors.New("pricing: option choice selected more than once")
)

// Selection is one order line's product choice as it arrives from the client. It carries NO price:
// PriceItem derives the authoritative UnitPrice from the catalog. A flat product uses ColorID; a
// product with parts uses PartColors (one per part, ADR-037). Options split: text options and legacy
// toggle choice-options (no choices) go in OptionIDs; a choice-option that offers choices goes in
// OptionChoices with the picked choice. Personalization is the per-item engraving (nil = none). The
// PartColors/OptionChoices value types live in internal/order (order.PartColorSelection /
// order.OptionChoiceSelection) — they are the SAME snapshots the checkout persists on the line, so the
// priced selection and the stored selection can never drift.
type Selection struct {
	ColorID         *uuid.UUID                    // flat product: the single chosen colour (nil = none)
	PartColors      []order.PartColorSelection    // parts product: exactly one colour per part (ADR-037)
	OptionIDs       []uuid.UUID                   // text options + legacy toggle choice-options (no choices)
	OptionChoices   []order.OptionChoiceSelection // choice-options that offer choices: the picked choice (ADR-037)
	Personalization *order.Personalization        // nil = no engraving; Text validated against the engrave option's maxChars
}

// PriceItem derives the server-authoritative per-unit VND for one line and validates the selection
// against the product's own colours/options/parts/choices. `product` is the intake read
// (GetProductByID); `colors`/`options`/`parts`/`choices` are the product's full sets — passing the
// whole sets lets membership be checked by presence, so a colour/option/part/choice from a DIFFERENT
// product can never be priced in. Returns a wrapped sentinel (see the Err* above) on any invalid
// selection.
//
// UnitPrice = base_price + colour delta(s) + Σ option deltas + Σ choice deltas. Colours (ADR-037): a
// product WITH parts requires exactly one colour per part, each ∈ its claimed part; a flat product
// uses the single ColorID. Options (ADR-037): a `choice` option that offers choices is priced by the
// picked choice (its own delta; the option base is ignored — one price source); text options and
// legacy toggle options are priced by the option delta. Every summand is a non-negative int VND (DB
// CHECK ≥ 0); the sum is overflow-checked (the caller controls the *selection*, not the catalog deltas).
func PriceItem(product sqlc.Product, colors []sqlc.Color, options []sqlc.Option, parts []sqlc.Part, choices []sqlc.OptionChoice, sel Selection) (int64, error) {
	unit := product.BasePrice

	// --- colours: parts mode (one per part) XOR flat mode (single ColorID) ---
	if len(parts) > 0 {
		if sel.ColorID != nil {
			return 0, ErrColorForPartsProduct
		}
		u, err := pricePartColors(unit, parts, colors, sel.PartColors)
		if err != nil {
			return 0, err
		}
		unit = u
	} else {
		if len(sel.PartColors) > 0 {
			return 0, ErrPartColorForFlatProduct
		}
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
	}

	// --- options: legacy toggle/text (OptionIDs) + choice-picks (OptionChoices) ---
	choicesByOption := groupChoicesByOption(choices)

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
		// A choice option that offers choices must be picked via OptionChoices, not toggled here.
		if opt.Type == sqlc.OptionTypeChoice && len(choicesByOption[id]) > 0 {
			return 0, ErrOptionNeedsChoice
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

	chosenOpt := make(map[uuid.UUID]struct{}, len(sel.OptionChoices))
	for _, oc := range sel.OptionChoices {
		if _, dup := chosenOpt[oc.OptionID]; dup {
			return 0, ErrDuplicateOptionChoice
		}
		chosenOpt[oc.OptionID] = struct{}{}
		if _, both := seen[oc.OptionID]; both {
			return 0, ErrDuplicateOption // the same option cannot be both toggled and choice-picked
		}
		opt, ok := findOption(options, oc.OptionID)
		if !ok {
			return 0, ErrOptionNotForProduct
		}
		if opt.Type != sqlc.OptionTypeChoice {
			return 0, ErrChoiceNotForOption
		}
		choice, ok := findChoice(choicesByOption[oc.OptionID], oc.ChoiceID)
		if !ok {
			return 0, ErrChoiceNotForOption
		}
		var overflow bool
		if unit, overflow = addChecked(unit, choice.PriceDelta); overflow {
			return 0, ErrPriceOverflow
		}
	}

	if err := validateEngrave(sel.Personalization, engrave); err != nil {
		return 0, err
	}
	return unit, nil
}

// pricePartColors enforces the ADR-037 per-part colour rule: every part gets EXACTLY one colour, each
// colour ∈ its claimed part (the cross-charge guard — a colour of another part can never be pinned to
// this one). Returns the running unit + Σ part-colour deltas.
func pricePartColors(unit int64, parts []sqlc.Part, colors []sqlc.Color, sel []order.PartColorSelection) (int64, error) {
	chosen := make(map[uuid.UUID]uuid.UUID, len(sel)) // partID -> colorID
	for _, pc := range sel {
		if _, dup := chosen[pc.PartID]; dup {
			return 0, ErrDuplicatePartColor
		}
		chosen[pc.PartID] = pc.ColorID
	}
	for _, part := range parts {
		colorID, ok := chosen[part.ID]
		if !ok {
			return 0, ErrMissingPartColor
		}
		color, ok := findColor(colors, colorID)
		if !ok {
			return 0, ErrColorNotForProduct
		}
		// The colour must belong to THIS part, not merely the product (cross-charge guard).
		if !color.PartID.Valid || uuid.UUID(color.PartID.Bytes) != part.ID {
			return 0, ErrColorNotForPart
		}
		if !color.Available {
			return 0, ErrColorUnavailable
		}
		var overflow bool
		if unit, overflow = addChecked(unit, color.PriceDelta); overflow {
			return 0, ErrPriceOverflow
		}
	}
	// A part-colour naming a part that is not on the product was never consumed by the loop above.
	if len(chosen) > len(parts) {
		return 0, ErrColorNotForPart
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

// groupChoicesByOption buckets a product's option_choices by their option id (ADR-037), so PriceItem
// can tell a choice-option that offers choices from a legacy toggle and validate a choice by presence.
func groupChoicesByOption(choices []sqlc.OptionChoice) map[uuid.UUID][]sqlc.OptionChoice {
	m := make(map[uuid.UUID][]sqlc.OptionChoice, len(choices))
	for _, c := range choices {
		m[c.OptionID] = append(m[c.OptionID], c)
	}
	return m
}

func findChoice(choices []sqlc.OptionChoice, id uuid.UUID) (sqlc.OptionChoice, bool) {
	for _, c := range choices {
		if c.ID == id {
			return c, true
		}
	}
	return sqlc.OptionChoice{}, false
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
