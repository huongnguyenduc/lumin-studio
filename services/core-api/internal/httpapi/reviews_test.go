package httpapi

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
)

// Docker-free unit tests for the GET /products/{slug}/reviews (PR-P1-l) building blocks: the row→DTO
// mapping (both JSONB decodes + the null/empty zero-states) and the pre-DB paging validation. The full
// end-to-end (published-only non-leak, active-product 404, paginate, 304) is in reviews_integration_test.go.

func ts(t time.Time) pgtype.Timestamptz { return pgtype.Timestamptz{Time: t, Valid: true} }

func TestReviewsDTO(t *testing.T) {
	id0, id1 := uuid.New(), uuid.New()
	when := time.Date(2026, 2, 1, 8, 30, 0, 0, time.UTC)
	rows := []sqlc.ListReviewsByProductRow{
		{
			ID: id0, Rating: 5, Body: "Đèn đẹp, giao nhanh",
			Images:    []byte(`["https://x/r1.jpg","https://x/r2.jpg"]`),
			Reply:     []byte(`{"body":"Cảm ơn bạn nhiều!","at":"2026-02-02T09:00:00Z"}`),
			CreatedAt: ts(when),
		},
		{
			// no reviewer photos, no shop reply yet, minimal body.
			ID: id1, Rating: 3, Body: "", Images: nil, Reply: nil, CreatedAt: ts(when.AddDate(0, 0, -1)),
		},
	}
	got, err := reviewsDTO(rows)
	if err != nil {
		t.Fatalf("reviewsDTO: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("len = %d, want 2", len(got))
	}

	r0 := got[0]
	if r0.Id != id0 || r0.Rating != 5 || r0.Body != "Đèn đẹp, giao nhanh" {
		t.Errorf("review[0] core = %+v, want mapped id/rating/body", r0)
	}
	if !r0.CreatedAt.Equal(when) {
		t.Errorf("review[0].CreatedAt = %v, want %v", r0.CreatedAt, when)
	}
	if len(r0.Images) != 2 || r0.Images[0] != "https://x/r1.jpg" {
		t.Errorf("review[0].Images = %v, want the two urls", r0.Images)
	}
	if r0.Reply == nil || r0.Reply.Body != "Cảm ơn bạn nhiều!" || !r0.Reply.At.Equal(time.Date(2026, 2, 2, 9, 0, 0, 0, time.UTC)) {
		t.Errorf("review[0].Reply = %+v, want decoded {body,at}", r0.Reply)
	}

	// Absent images → non-nil empty slice → JSON [], never null; absent reply → nil → JSON null.
	r1 := got[1]
	if r1.Images == nil || len(r1.Images) != 0 {
		t.Errorf("review[1].Images = %v, want non-nil empty []", r1.Images)
	}
	if r1.Reply != nil {
		t.Errorf("review[1].Reply = %+v, want nil (not replied)", r1.Reply)
	}
	b, _ := json.Marshal(r1)
	if !jsonHasEmptyImages(t, b) {
		t.Errorf("review[1] marshaled = %s, want images:[] not null", b)
	}
}

// A reviews projection carries NO customer_id column, so the marshaled review can never carry reviewer
// PII — this pins the "author identity is off the wire" contract at the DTO layer (defense in depth on top
// of the query projection).
func TestReviewDTOCarriesNoAuthorIdentity(t *testing.T) {
	rows := []sqlc.ListReviewsByProductRow{
		{ID: uuid.New(), Rating: 4, Body: "ổn", Images: nil, Reply: nil, CreatedAt: ts(time.Now().UTC())},
	}
	got, err := reviewsDTO(rows)
	if err != nil {
		t.Fatalf("reviewsDTO: %v", err)
	}
	b, _ := json.Marshal(got[0])
	var m map[string]json.RawMessage
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatalf("unmarshal review: %v", err)
	}
	// ALLOWLIST, not a blocklist: the wire Review must carry EXACTLY these keys. Asserting the full key set
	// (rather than a fixed list of forbidden names) means ANY newly-projected field — a reviewer name, a
	// customer id, an email, or something not yet imagined — fails this test, so a future PR can never leak
	// author identity past the DTO contract under a name this test didn't anticipate.
	want := map[string]bool{"id": true, "rating": true, "body": true, "images": true, "reply": true, "createdAt": true}
	for k := range m {
		if !want[k] {
			t.Errorf("review DTO carries an unexpected field %q (author-identity leak risk): %s", k, b)
		}
	}
	for k := range want {
		if _, present := m[k]; !present {
			t.Errorf("review DTO missing expected field %q: %s", k, b)
		}
	}
}

func TestReviewsDTOCorruptJSONBHardFails(t *testing.T) {
	// Corrupt images OR reply JSONB surfaces as an error (→ 500), consistent with the catalog reads —
	// corruption must not be silently swallowed.
	t.Run("corrupt images", func(t *testing.T) {
		rows := []sqlc.ListReviewsByProductRow{
			{ID: uuid.New(), Rating: 5, Images: []byte(`{not json`), CreatedAt: ts(time.Now().UTC())},
		}
		if _, err := reviewsDTO(rows); err == nil {
			t.Fatal("corrupt images jsonb must return an error, got nil")
		}
	})
	t.Run("corrupt reply", func(t *testing.T) {
		rows := []sqlc.ListReviewsByProductRow{
			{ID: uuid.New(), Rating: 5, Images: []byte(`[]`), Reply: []byte(`{"body":`), CreatedAt: ts(time.Now().UTC())},
		}
		if _, err := reviewsDTO(rows); err == nil {
			t.Fatal("corrupt reply jsonb must return an error, got nil")
		}
	})
}

// The paging validation runs BEFORE any DB read, so an out-of-range request is a 400 VALIDATION with a nil
// pool (no Postgres) — proving the DoS/shape guard short-circuits before the slug resolve + query.
func TestGetProductReviewsRejectsBadParamsWithoutDB(t *testing.T) {
	srv := NewServer(slog.New(slog.NewTextHandler(io.Discard, nil)), nil, nil, nil)
	cases := []struct {
		name   string
		params api.GetProductReviewsParams
	}{
		{"pageSize over cap", api.GetProductReviewsParams{PageSize: ptrTo(maxPageSize + 1)}},
		{"page zero", api.GetProductReviewsParams{Page: ptrTo(0)}},
		{"negative page", api.GetProductReviewsParams{Page: ptrTo(-1)}},
		{"pageSize zero", api.GetProductReviewsParams{PageSize: ptrTo(0)}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			resp, err := srv.GetProductReviews(context.Background(), api.GetProductReviewsRequestObject{
				Slug: "den-nam", Params: tc.params,
			})
			if err != nil {
				t.Fatalf("GetProductReviews returned err (want 400 response): %v", err)
			}
			got, ok := resp.(api.GetProductReviews400JSONResponse)
			if !ok {
				t.Fatalf("resp = %T, want GetProductReviews400JSONResponse", resp)
			}
			if got.Code != codeValidation {
				t.Errorf("code = %q, want %s", got.Code, codeValidation)
			}
		})
	}
}
