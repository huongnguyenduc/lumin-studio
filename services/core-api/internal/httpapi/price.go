package httpapi

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/money"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/pricing"
)

// maxQuoteItems caps the lines a single quote may price. POST /price/quote is public and
// unauthenticated with no rate limit until the edge WAF (router.go), and each line costs a catalog
// round-trip — so an unbounded items[] is a read amplifier that could exhaust the DB pool. A real
// cart never approaches 50 distinct configured lines; over the cap is a 400 VALIDATION. The schema
// declares maxItems:50 for the contract, but oapi-codegen does not enforce it at runtime — this does.
const maxQuoteItems = 50

// QuotePrice handles POST /price/quote (PR-P1-b; shipping added P2-b): the public storefront pricing
// preview. It is authPublic (classify) — no session — and computes each requested line's
// server-authoritative unit price and line total plus the aggregate subtotal. When the request names a
// province (P2-b) it also folds in shippingFee (resolved from settings via the SAME pricing.ShippingFee
// the checkout charge path uses) and total; without one the response is line/subtotal only,
// byte-identical to the pre-P2-b shape. It persists nothing.
//
// MONEY (ADR-019 / always-must #2): the wire input carries no price. Every unit price is derived
// from the catalog via pricing.PriceItem — the same authenticity gate checkout's priceLine uses —
// and the arithmetic runs through money.CalcTotals (its addChecked/mulChecked guard qty overflow).
// Unlike CreateOrder, this endpoint does NOT loud-reject client-sent money keys (checkout's
// clientMoneyFields): OrderItemInput has no price field so a smuggled unitPrice is dropped by
// decode, and — the decisive difference — a quote persists nothing and its RESPONSE is the
// authoritative price, so there is no hidden divergence to surface. The schema omission IS the
// guarantee here (deliberate, user-confirmed 2026-07-03).
//
// A non-active or unknown product is 422 PRODUCT_UNAVAILABLE (never a bare 404 on this public
// route — same non-leak stance as checkout). r.Context() propagates into every catalog read so a
// client disconnect / timeout cancels them.
func (s *Server) QuotePrice(ctx context.Context, request api.QuotePriceRequestObject) (api.QuotePriceResponseObject, error) {
	if request.Body == nil {
		// Decode failures are caught by the strict RequestErrorHandlerFunc; this covers a nil
		// body reaching the handler (mirrors checkout.go / transition.go).
		return api.QuotePrice400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(envelope(codeValidation))}, nil
	}
	items := request.Body.Items
	if len(items) == 0 {
		// minItems:1 is not runtime-enforced by oapi-codegen — reject an empty quote with the
		// same code the checkout intake uses (422 NO_ITEMS), not a silent empty subtotal.
		return nil, db.ErrNoItems
	}
	if len(items) > maxQuoteItems {
		// Over the documented maxItems cap: a request-shape violation → 400 VALIDATION. Enforced
		// here because oapi-codegen ignores maxItems (see maxQuoteItems). Bounds the DB fan-out on
		// this public endpoint before any catalog read runs.
		return api.QuotePrice400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(envelope(codeValidation))}, nil
	}

	cat := db.NewCatalog(s.pool)
	lines := make([]api.PriceQuoteLine, 0, len(items))
	for _, it := range items {
		line, err := s.quoteLine(ctx, cat, it)
		if err != nil {
			return nil, err // domain/db error → mapError (handleResponseError)
		}
		lines = append(lines, line)
	}

	// A named province (P2-b) folds shipping into the quote; blank/absent → line/subtotal only.
	province := ""
	if request.Body.Province != nil {
		province = strings.TrimSpace(*request.Body.Province)
	}
	var fee int64
	if province != "" {
		settings, serr := db.NewSettings(s.pool).Get(ctx)
		if serr != nil {
			if errors.Is(serr, db.ErrNotFound) {
				// The settings singleton is migration-seeded; its absence is a server-config fault,
				// not a client 404. Break the ErrNotFound chain (%v, not %w) so mapError renders a
				// logged 500 instead of an unlogged NOT_FOUND (mirrors checkout.go).
				return nil, fmt.Errorf("quote: settings singleton missing (unseeded?): %v", serr)
			}
			return nil, serr
		}
		// Same authority as the checkout charge path (checkout.go) → the quote's fee/total equal what
		// POST /orders will charge for this cart+province. No matching rule → 422 NO_SHIPPING_RULE
		// (errors.go), never a silent ₫0.
		if fee, serr = pricing.ShippingFee(settings.ShippingRules, province); serr != nil {
			return nil, serr
		}
	}

	totals, err := quoteTotals(lines, fee)
	if err != nil {
		// money.ErrInvalidAmount → 422 INVALID_AMOUNT. Includes a cross-line int64 overflow: an
		// absurd cart whose lines each fit but whose sum does not is rejected, never wrapped negative.
		return nil, err
	}
	// shippingFee/total appear ONLY when a province was given — otherwise the pointers stay nil and
	// omitempty drops them, keeping the response byte-identical to the pre-P2-b shape.
	resp := api.PriceQuote{Lines: lines, Subtotal: totals.Subtotal}
	if province != "" {
		resp.ShippingFee = &totals.ShippingFee
		resp.Total = &totals.Total
	}
	return api.QuotePrice200JSONResponse(resp), nil
}

// quoteTotals sums the line totals through the guarded money math (money.CalcTotals) and folds in the
// shipping fee. It is split out and PURE so the cross-line overflow guard — the ONLY behaviour it adds
// over a naive Σ, since subtotal == Σ lineTotal by construction — is unit-testable: two lines that each
// fit int64 but whose sum does not must surface INVALID_AMOUNT, never a wrapped-negative subtotal.
// pricing.PriceItem already summed base + deltas into each UnitPrice, so the LineItem gets zero deltas
// (feeding ColorDelta/OptionDeltas here would re-add them — money.go:95-106). It routes the SAME
// LineItems + fee through money.CalcTotals that CreateOrderTx.lineItems does (orders.go), so a quote's
// subtotal/shippingFee/total equal the order's for the same cart+province (parity). fee is 0 when the
// request named no province — the handler then omits Total/ShippingFee from the response.
func quoteTotals(lines []api.PriceQuoteLine, fee int64) (money.Totals, error) {
	items := make([]money.LineItem, len(lines))
	for i, l := range lines {
		items[i] = money.LineItem{UnitPrice: l.UnitPrice, Quantity: int64(l.Quantity)}
	}
	return money.CalcTotals(money.TotalsInput{Items: items, ShippingFee: fee})
}

// quoteLine reads one requested line's product + full color/option sets and prices it. A missing
// or non-active product is PRODUCT_UNAVAILABLE (never a bare 404 on this public route). The catalog
// I/O is split from the pure pricing in priceQuoteLine so the money math stays Docker-free testable.
func (s *Server) quoteLine(ctx context.Context, cat *db.Catalog, it api.OrderItemInput) (api.PriceQuoteLine, error) {
	product, err := cat.ProductByID(ctx, it.ProductId)
	if errors.Is(err, db.ErrNotFound) {
		return api.PriceQuoteLine{}, errProductUnavailable
	}
	if err != nil {
		return api.PriceQuoteLine{}, err
	}
	if product.Status != sqlc.ProductStatusActive {
		return api.PriceQuoteLine{}, errProductUnavailable
	}
	colors, err := cat.ColorsByProduct(ctx, product.ID)
	if err != nil {
		return api.PriceQuoteLine{}, err
	}
	options, err := cat.OptionsByProduct(ctx, product.ID)
	if err != nil {
		return api.PriceQuoteLine{}, err
	}
	parts, err := cat.PartsByProduct(ctx, product.ID)
	if err != nil {
		return api.PriceQuoteLine{}, err
	}
	choices, err := cat.ChoicesByProduct(ctx, product.ID)
	if err != nil {
		return api.PriceQuoteLine{}, err
	}
	return priceQuoteLine(product, colors, options, parts, choices, it)
}

// priceQuoteLine derives one line's server-authoritative unit price and line total. It is PURE
// (no DB) so the pricing + money math is unit-tested without a database. It routes the selection
// through pricing.PriceItem (validates color/option membership, engrave maxChars by rune count,
// unit overflow) and computes the line total with the guarded money math — never a raw multiply.
func priceQuoteLine(product sqlc.Product, colors []sqlc.Color, options []sqlc.Option, parts []sqlc.Part, choices []sqlc.OptionChoice, it api.OrderItemInput) (api.PriceQuoteLine, error) {
	// Same Selection shape the checkout charge path builds (checkout.go priceLine), including the ADR-037
	// per-part colours + per-choice picks — so a quote's unit price equals what POST /orders will charge
	// for the same configured line (quote/charge parity).
	unit, err := pricing.PriceItem(product, colors, options, parts, choices, pricing.Selection{
		ColorID:         it.ColorId,
		OptionIDs:       optionIDsFrom(it.OptionIds),
		PartColors:      partColorSelectionsFrom(it.PartColors),
		OptionChoices:   optionChoiceSelectionsFrom(it.OptionChoices),
		Personalization: personalizationFrom(it.Personalization),
	})
	if err != nil {
		return api.PriceQuoteLine{}, err
	}
	// Line total via a single-item CalcTotals (.Subtotal = qty×unit): reuses the shared overflow
	// guard and the qty>0 check rather than reimplementing the multiply at the HTTP edge.
	lt, err := money.CalcTotals(money.TotalsInput{Items: []money.LineItem{{UnitPrice: unit, Quantity: int64(it.Quantity)}}})
	if err != nil {
		return api.PriceQuoteLine{}, err
	}
	return api.PriceQuoteLine{UnitPrice: unit, Quantity: it.Quantity, LineTotal: lt.Subtotal}, nil
}
