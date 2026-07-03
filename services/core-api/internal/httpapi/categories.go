package httpapi

import (
	"context"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
)

// GetCategories handles GET /categories (PR-P1-d): the public storefront category list. It is authPublic
// (classify) — no session — and returns the BROWSABLE category taxonomy A→Z (ListCategories scopes to
// categories with at least one ACTIVE product and orders by name, slug). Categories inherit visibility
// transitively through their products, so the query applies the same non-leak-at-the-SQL-source filter as
// the active-only product reads: a category whose only products are draft/archived never surfaces as a
// public chip (no dead-end chip, no unreleased-name leak). No browsable category renders `[]`, never a 404
// (spec §03 zero-state). The response carries a weak ETag + the SAME provisional Cache-Control as the
// /products list (catalogCacheControl — one uniform caching contract across the public catalog reads,
// finalized in P1-f); a matching If-None-Match short-circuits to 304 with no body. r.Context() propagates
// into the read so a client disconnect / 30s timeout cancels it.
func (s *Server) GetCategories(ctx context.Context, request api.GetCategoriesRequestObject) (api.GetCategoriesResponseObject, error) {
	rows, err := db.NewCatalog(s.pool).Categories(ctx)
	if err != nil {
		return nil, err // db error → mapError (handleResponseError) → 500, no leak
	}
	cats := categoriesDTO(rows)

	etag, err := weakETag(cats)
	if err != nil {
		return nil, err // marshal fault → 500 (logged); never emit a bad validator
	}
	// The ETag hashes the response body (the category slice), so a mutated taxonomy changes the hash and a
	// stale client revalidates to a fresh 200. Like the /products list, the 304 still pays the origin read
	// (the body is needed to hash) — the conditional GET saves BANDWIDTH, not origin compute; a real edge
	// cache is the P1-f decision.
	if ifNoneMatch(request.Params.IfNoneMatch, etag) {
		return api.GetCategories304Response{Headers: api.GetCategories304ResponseHeaders{
			ETag: etag, CacheControl: catalogCacheControl,
		}}, nil
	}
	return api.GetCategories200JSONResponse{
		Body:    cats,
		Headers: api.GetCategories200ResponseHeaders{ETag: etag, CacheControl: catalogCacheControl},
	}, nil
}

// categoriesDTO maps category rows to the wire shape. It always returns a non-nil slice (make over the row
// count) so an empty catalog renders JSON `[]`, never `null` (spec §03 zero-state). Categories carry no
// money and no nullable fields, so there is no int-VND or pointer-widening concern here.
func categoriesDTO(rows []sqlc.Category) []api.Category {
	out := make([]api.Category, len(rows))
	for i, c := range rows {
		out[i] = api.Category{
			Id:   c.ID,
			Slug: c.Slug,
			Name: c.Name,
		}
	}
	return out
}
