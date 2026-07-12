package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
)

// admin_reviews.go — the review-moderation surface (P3-m): list every review (published + hidden) with its
// product + reviewer names, and moderate one (publish/hide and/or reply). Both ops are owner+staff
// (authRequired — staff moderates reviews, spec §08), NOT owner-only: a review reply is customer service, not
// a catalog power. The public review list stays published-only at its SQL source (ListReviewsByProduct), so
// nothing here can leak a hidden review to the storefront; the reviewer name is admin-only PII (PDPL), served
// only behind the admin auth wall. No outbox — moderation is an internal content decision, not a domain event.

// maxReviewReplyChars caps a shop reply (belt against a pathological blob; the UI textarea keeps well under
// it). Measured in runes — Vietnamese is multibyte.
const maxReviewReplyChars = 2000

// GetAdminReviews handles GET /admin/reviews (admin-gated read; owner+staff). It returns EVERY review, newest
// first, optionally filtered to one status — the moderation surface, unlike the public published-only list.
func (s *Server) GetAdminReviews(ctx context.Context, request api.GetAdminReviewsRequestObject) (api.GetAdminReviewsResponseObject, error) {
	status, ok := parseReviewStatusFilter(request.Params.Status)
	if !ok {
		// A status value outside the enum (only reachable if the generated binding is bypassed). Reject
		// rather than silently list all.
		return api.GetAdminReviews400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(envelope(codeValidation))}, nil
	}
	rows, err := db.NewCatalog(s.pool).AdminReviews(ctx, status)
	if err != nil {
		return nil, err
	}
	reviews, err := adminReviewSummaries(rows)
	if err != nil {
		return nil, err // corrupt images/reply jsonb → 500 (logged), like the public reviews read
	}
	return api.GetAdminReviews200JSONResponse(reviews), nil
}

// UpdateAdminReview handles PATCH /admin/reviews/{id} (owner+staff). It applies a status flip and/or a reply.
// An empty body (neither field) → 400; a blank/over-long reply → 400; unknown id → 404. Returns 204 (the FE
// re-reads the list). The reply timestamp is server-stamped so a client can't backdate a reply.
func (s *Server) UpdateAdminReview(ctx context.Context, request api.UpdateAdminReviewRequestObject) (api.UpdateAdminReviewResponseObject, error) {
	if request.Body == nil {
		return api.UpdateAdminReview400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(envelope(codeValidation))}, nil
	}
	arg, ok := buildReviewModeration(request.Id, *request.Body, time.Now().UTC())
	if !ok {
		return api.UpdateAdminReview400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(envelope(codeValidation))}, nil
	}
	if err := db.NewCatalog(s.pool).ModerateReview(ctx, arg); err != nil {
		return nil, err // db.ErrNotFound → 404
	}
	return api.UpdateAdminReview204Response{}, nil
}

// buildReviewModeration validates a ReviewModeration body and builds the UPDATE params, server-stamping the
// reply timestamp `at`. It enforces "at least one field present" (an empty body is a no-op → 400), a valid
// status enum, and the reply length cap. reply is touched (SetReply) only when a non-empty reply is supplied,
// so a plain hide/unhide leaves any existing reply intact. Pure (clock passed in) so it is unit-testable.
func buildReviewModeration(id uuid.UUID, in api.ReviewModeration, at time.Time) (sqlc.UpdateReviewModerationParams, bool) {
	arg := sqlc.UpdateReviewModerationParams{ID: id}
	touched := false

	if in.Status != nil {
		st := sqlc.ReviewStatus(*in.Status)
		if !isValidReviewStatus(st) {
			return arg, false
		}
		arg.Status = sqlc.NullReviewStatus{ReviewStatus: st, Valid: true}
		touched = true
	}

	if in.Reply != nil {
		body := strings.TrimSpace(*in.Reply)
		if body == "" || utf8.RuneCountInString(body) > maxReviewReplyChars {
			return arg, false
		}
		replyJSON, err := json.Marshal(api.ReviewReply{Body: body, At: at})
		if err != nil {
			return arg, false
		}
		arg.SetReply = true
		arg.Reply = replyJSON
		touched = true
	}

	if !touched {
		return arg, false // an empty body: nothing to moderate
	}
	return arg, true
}

// adminReviewSummaries maps the joined admin-review rows to the wire AdminReview, decoding the images and
// optional reply jsonb (mirrors reviewsDTO). images is a non-nil empty slice when absent so the JSON renders
// `[]`, never `null`; reply stays nil (→ JSON null) until replied. customerName carries through as a nullable
// pointer (guest review → nil). A corrupt jsonb blob is a server data fault → error (→ 500), not hidden.
func adminReviewSummaries(rows []sqlc.ListAllReviewsRow) ([]api.AdminReview, error) {
	out := make([]api.AdminReview, len(rows))
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
		out[i] = api.AdminReview{
			Id:           r.ID,
			ProductId:    r.ProductID,
			ProductName:  r.ProductName,
			CustomerName: r.CustomerName,
			Rating:       int(r.Rating),
			Body:         r.Body,
			Images:       images,
			Reply:        reply,
			Status:       api.ReviewStatus(r.Status),
			CreatedAt:    r.CreatedAt.Time,
		}
	}
	return out, nil
}

// parseReviewStatusFilter maps the optional ?status= query param to a nullable sqlc filter: nil → all
// statuses (ok), a known value → that status, an unknown value → not-ok (400). Mirrors parseProductStatusFilter.
func parseReviewStatusFilter(p *api.ReviewStatus) (*sqlc.ReviewStatus, bool) {
	if p == nil {
		return nil, true
	}
	st := sqlc.ReviewStatus(*p)
	if !isValidReviewStatus(st) {
		return nil, false
	}
	return &st, true
}

// isValidReviewStatus reports whether s is one of the two known review statuses.
func isValidReviewStatus(s sqlc.ReviewStatus) bool {
	switch s {
	case sqlc.ReviewStatusPublished, sqlc.ReviewStatusHidden:
		return true
	default:
		return false
	}
}
