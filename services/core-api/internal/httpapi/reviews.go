package httpapi

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
)

// GetProductReviews handles GET /products/{slug}/reviews (PR-P1-l): the public storefront product-review
// list. It is authPublic (classify) — no session. It returns ONLY published reviews for the slug's ACTIVE
// product, newest first, as a paginated page. Two non-leak boundaries hold:
//
//   - product existence: the slug is resolved to an ACTIVE product first; an unknown slug OR a
//     draft/archived product both return the SAME 404 NOT_FOUND (identical to the detail read, so the
//     surface can't be used to probe which products exist — reviews for a hidden product are never served);
//   - review visibility: the published-only filter lives in the SQL (ListReviewsByProduct), never here, so
//     a hidden (moderated-away) review can never leak into the public list no matter what this handler does.
//
// The projection carries no customer_id, so no reviewer PII crosses the wire (PDPL — reviews may be by a
// guest, and exposing a reviewer name is a deliberate later decision, not this endpoint's). It is paginated
// (page/pageSize, bounded here since oapi-codegen ignores the schema min/max — the same DoS bound as the
// catalog list on this public, rate-limit-free endpoint). The response carries a weak ETag + a provisional
// Cache-Control (see catalogCacheControl); a matching If-None-Match short-circuits to 304 with no body.
// ctx propagates into every read so a client disconnect / timeout cancels them.
func (s *Server) GetProductReviews(ctx context.Context, request api.GetProductReviewsRequestObject) (api.GetProductReviewsResponseObject, error) {
	badRequest := api.GetProductReviews400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(envelope(codeValidation))}

	page, pageSize, ok := pageParams(request.Params.Page, request.Params.PageSize)
	if !ok {
		// page < 1, pageSize < 1, or pageSize > maxPageSize — a request-shape violation (400), enforced
		// here because oapi-codegen does not honor the schema's minimum/maximum. Bounds the LIMIT before
		// any DB read on this public, rate-limit-free endpoint.
		return badRequest, nil
	}

	repo := db.NewCatalog(s.pool)

	// Resolve the slug to an ACTIVE product first. A missing slug (db.ErrNotFound → 404) and a
	// draft/archived product (→ db.ErrNotFound → 404) are indistinguishable on the wire — the same
	// catalog-existence non-leak the detail read enforces. Reviews for a hidden product are never served.
	p, err := repo.ProductBySlug(ctx, request.Slug)
	if err != nil {
		return nil, err // db.ErrNotFound → 404 (unknown slug); any other error → 500
	}
	if p.Status != sqlc.ProductStatusActive {
		return nil, db.ErrNotFound
	}

	// Guard the OFFSET before the multiply can overflow: a page far beyond any real review set is an empty
	// page, so clamp the offset to maxCatalogOffset (the LIMIT then returns nothing) rather than let a huge
	// (page-1)*pageSize wrap negative into the SQL OFFSET. The comparison avoids the multiply.
	offset := maxCatalogOffset
	if page-1 <= maxCatalogOffset/pageSize {
		offset = (page - 1) * pageSize
	}

	rows, total, err := repo.ListPublishedReviews(ctx, db.ReviewFilter{
		ProductID: p.ID,
		Limit:     int32(pageSize),
		Offset:    int32(offset),
	})
	if err != nil {
		return nil, err // db error → mapError (handleResponseError) → 500, no leak
	}

	reviews, err := reviewsDTO(rows)
	if err != nil {
		// Corrupt images/reply JSONB is a server data fault (can't happen on the validated write paths:
		// images is NOT NULL DEFAULT '[]') → logged, 500. Hard-fail like the catalog reads rather than
		// hide corruption.
		return nil, err
	}
	list := api.ReviewList{Items: reviews, Page: page, PageSize: pageSize, Total: int(total)}

	etag, err := weakETag(list)
	if err != nil {
		return nil, err // marshal fault → 500 (logged); never emit a bad validator
	}
	if ifNoneMatch(request.Params.IfNoneMatch, etag) {
		return api.GetProductReviews304Response{Headers: api.GetProductReviews304ResponseHeaders{
			ETag: etag, CacheControl: catalogCacheControl,
		}}, nil
	}
	return api.GetProductReviews200JSONResponse{
		Body:    list,
		Headers: api.GetProductReviews200ResponseHeaders{ETag: etag, CacheControl: catalogCacheControl},
	}, nil
}

// reviewsDTO maps the projected published-review rows to the wire Review. Split from the I/O (pure) so the
// field mapping — and the two JSONB decodes (images string array, optional reply object) — is pinned by a
// Docker-free unit test. images is a non-nil empty slice when absent so the JSON renders `[]`, never `null`
// (spec §03 zero-state); reply stays nil (→ JSON null) until the shop has replied. The rows carry no
// customer_id, so there is nothing to project for the author — reviewer identity is deliberately off the wire.
func reviewsDTO(rows []sqlc.ListReviewsByProductRow) ([]api.Review, error) {
	out := make([]api.Review, len(rows))
	for i, r := range rows {
		images := []string{}
		if len(r.Images) > 0 {
			if err := json.Unmarshal(r.Images, &images); err != nil {
				return nil, fmt.Errorf("review %s: decode images jsonb: %w", r.ID, err)
			}
		}
		var reply *api.ReviewReply
		if len(r.Reply) > 0 {
			var rr api.ReviewReply
			if err := json.Unmarshal(r.Reply, &rr); err != nil {
				return nil, fmt.Errorf("review %s: decode reply jsonb: %w", r.ID, err)
			}
			reply = &rr
		}
		out[i] = api.Review{
			Id:        r.ID,
			Rating:    int(r.Rating),
			Body:      r.Body,
			Images:    images,
			Reply:     reply,
			CreatedAt: r.CreatedAt.Time,
		}
	}
	return out, nil
}
