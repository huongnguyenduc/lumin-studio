package httpapi

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
)

// GetProductBySlug handles GET /products/{slug} (PR-P1-a): the public storefront product-detail read.
// It is authPublic (classify) — no session needed. It returns the ACTIVE product for the slug bundled
// with its named print colors and customization options, or 404 for an unknown slug OR a draft/archived
// product. Both miss cases return the SAME 404 NOT_FOUND on purpose: the public surface must not let a
// caller distinguish a hidden (draft/archived) product from one that never existed (no catalog-existence
// probe — the same non-leak stance the checkout path takes with PRODUCT_UNAVAILABLE). Money crosses the
// wire raw int-VND (basePrice, priceDelta) — never formatted server-side (always-must #2); the frontend
// formats via @lumin/core. r.Context() propagates into every read so a client disconnect / 30s timeout
// cancels them.
func (s *Server) GetProductBySlug(ctx context.Context, request api.GetProductBySlugRequestObject) (api.GetProductBySlugResponseObject, error) {
	repo := db.NewCatalog(s.pool)

	p, err := repo.ProductBySlug(ctx, request.Slug)
	if err != nil {
		// db.ErrNotFound → 404 (unknown slug); any other error → 500.
		return nil, err
	}
	// Active-only: a draft/archived product is 404 to the public — identical to an unknown slug so the
	// response cannot be used to probe which hidden slugs exist. mapError renders db.ErrNotFound → 404.
	if p.Status != sqlc.ProductStatusActive {
		return nil, db.ErrNotFound
	}

	colors, err := repo.ColorsByProduct(ctx, p.ID)
	if err != nil {
		return nil, err
	}
	options, err := repo.OptionsByProduct(ctx, p.ID)
	if err != nil {
		return nil, err
	}

	dto, err := productDTO(p, colors, options)
	if err != nil {
		// Corrupt dimensions/images JSONB is a server data fault, not a client error → logged, 500.
		return nil, err
	}
	return api.GetProductBySlug200JSONResponse(dto), nil
}

// productDTO maps a product row + its colors/options into the wire Product. Split from the I/O (pure) so
// the field mapping — and the two JSONB decodes (dimensions object, images string array) — is pinned by a
// Docker-free unit test. Money stays raw int VND (never formatted server-side, always-must #2). colors,
// options and images are non-nil empty slices when absent so the JSON renders `[]`, never `null`
// (spec §03 zero-state).
func productDTO(p sqlc.Product, colors []sqlc.Color, options []sqlc.Option) (api.Product, error) {
	var dims api.Dimensions
	if err := json.Unmarshal(p.Dimensions, &dims); err != nil {
		return api.Product{}, fmt.Errorf("product %s: decode dimensions jsonb: %w", p.Slug, err)
	}
	images := []string{}
	if len(p.Images) > 0 {
		if err := json.Unmarshal(p.Images, &images); err != nil {
			return api.Product{}, fmt.Errorf("product %s: decode images jsonb: %w", p.Slug, err)
		}
	}
	return api.Product{
		Id:          p.ID,
		Slug:        p.Slug,
		Name:        p.Name,
		Description: p.Description,
		CategoryId:  p.CategoryID,
		BasePrice:   p.BasePrice, // raw int-VND, never formatted server-side (always-must #2)
		Dimensions:  dims,
		Material:    p.Material,
		Model3dUrl:  p.Model3dUrl,
		Images:      images,
		Colors:      colorsDTO(colors),
		Options:     optionsDTO(options),
		Status:      api.ProductStatus(p.Status),
		RatingAvg:   p.RatingAvg,
		ReviewCount: int(p.ReviewCount),
		CreatedAt:   p.CreatedAt.Time,
	}, nil
}

// colorsDTO maps color rows to the wire shape, dropping the internal productId. A nil/empty result yields
// a non-nil empty slice → JSON `[]`, not `null`.
func colorsDTO(rows []sqlc.Color) []api.Color {
	out := make([]api.Color, len(rows))
	for i, c := range rows {
		out[i] = api.Color{
			Id:         c.ID,
			Name:       c.Name,
			Hex:        c.Hex,
			Available:  c.Available,
			PriceDelta: c.PriceDelta, // raw int-VND (may be 0)
		}
	}
	return out
}

// optionsDTO maps option rows to the wire shape, dropping the internal productId and widening the
// nullable max_chars (int32) to the wire *int. A nil/empty result yields a non-nil empty slice → `[]`.
func optionsDTO(rows []sqlc.Option) []api.Option {
	out := make([]api.Option, len(rows))
	for i, o := range rows {
		out[i] = api.Option{
			Id:          o.ID,
			Label:       o.Label,
			Description: o.Description,
			Type:        api.OptionType(o.Type),
			PriceDelta:  o.PriceDelta, // raw int-VND (may be 0)
			MaxChars:    maxCharsPtr(o.MaxChars),
		}
	}
	return out
}

// maxCharsPtr widens the sqlc nullable *int32 to the wire *int (nil stays nil → JSON null).
func maxCharsPtr(v *int32) *int {
	if v == nil {
		return nil
	}
	n := int(*v)
	return &n
}
