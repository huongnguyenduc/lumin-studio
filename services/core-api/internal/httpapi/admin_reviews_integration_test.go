package httpapi

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/order"
)

// Integration tests for the admin review-moderation surface (P3-m) against real Postgres (testcontainers:
// skip local without Docker, run in CI — ADR-020). They exercise the joins + the moderation UPDATE and,
// load-bearing, the NON-LEAK boundary: the admin list shows hidden reviews (the point of moderation), but the
// PUBLIC list (GetProductReviews) stays published-only, so hiding a review removes it from the storefront and
// replying makes it appear. Also proven: guest reviews carry a null customerName (PDPL), the ?status= filter,
// staff-can-moderate (owner+staff, NOT owner-only), and unknown-id → 404.

func TestAdminReviewModerationEndToEnd(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()
	owner := ownerCtx()
	srv := NewServer(slog.New(slog.NewTextHandler(io.Discard, nil)), pool, nil, nil)
	repo := db.NewCatalog(pool)
	idn := db.NewIdentity(pool)

	// A category + ACTIVE product (published reviews need an active product to surface on the public list).
	cat, _ := repo.CreateCategory(ctx, sqlc.InsertCategoryParams{ID: uuid.New(), Slug: "cat-r", Name: "DM"})
	prod, err := repo.CreateProduct(ctx, sqlc.InsertProductParams{
		ID: uuid.New(), Slug: "den-r", Name: "Đèn nấm", Description: "", CategoryID: cat.ID, BasePrice: 1,
		Dimensions: []byte(`{"w":1,"d":1,"h":1}`), Material: "PLA", Images: []byte(`[]`), Status: sqlc.ProductStatusActive,
	})
	if err != nil {
		t.Fatalf("seed product: %v", err)
	}
	cust, err := idn.CreateCustomer(ctx, sqlc.InsertCustomerParams{
		ID: uuid.New(), Name: "Lan P.", Phone: "0900000000", Addresses: []byte(`[]`),
	})
	if err != nil {
		t.Fatalf("seed customer: %v", err)
	}

	// A published review by the customer (no reply yet) and a hidden GUEST review (null customer_id).
	pubReview, err := repo.CreateReview(ctx, sqlc.InsertReviewParams{
		ID: uuid.New(), ProductID: prod.ID, CustomerID: pgtype.UUID{Bytes: cust.ID, Valid: true},
		Rating: 5, Body: "Đèn đẹp lắm!", Images: []byte(`[]`), Status: sqlc.ReviewStatusPublished,
	})
	if err != nil {
		t.Fatalf("seed published review: %v", err)
	}
	guestHidden, err := repo.CreateReview(ctx, sqlc.InsertReviewParams{
		ID: uuid.New(), ProductID: prod.ID, CustomerID: pgtype.UUID{Valid: false},
		Rating: 2, Body: "Chưa ưng lắm", Images: []byte(`[]`), Status: sqlc.ReviewStatusHidden,
	})
	if err != nil {
		t.Fatalf("seed hidden review: %v", err)
	}

	// --- admin list returns BOTH (published + hidden), with product + reviewer names; guest → null name ---
	all := adminReviews(t, srv, owner, nil)
	if len(all) != 2 {
		t.Fatalf("admin list = %d reviews, want 2 (published + hidden)", len(all))
	}
	if r := findReview(all, pubReview.ID); r == nil || r.ProductName != "Đèn nấm" || r.CustomerName == nil ||
		*r.CustomerName != "Lan P." || r.Status != "published" {
		t.Fatalf("published review DTO wrong: %+v", r)
	}
	if r := findReview(all, guestHidden.ID); r == nil || r.CustomerName != nil || r.Status != "hidden" {
		t.Fatalf("hidden guest review DTO wrong (customerName should be nil): %+v", r)
	}

	// --- ?status=hidden narrows to just the hidden review ---
	hiddenOnly := adminReviews(t, srv, owner, ptrTo(api.ReviewStatus("hidden")))
	if len(hiddenOnly) != 1 || hiddenOnly[0].Id != guestHidden.ID {
		t.Fatalf("status=hidden = %+v, want just the hidden review", hiddenOnly)
	}

	// --- baseline non-leak: the PUBLIC list shows only the published review ---
	if got := publicReviewIDs(t, srv, prod.Slug); len(got) != 1 || got[0] != pubReview.ID {
		t.Fatalf("public list = %v, want just the published review", got)
	}

	// --- HIDE the published review → drops from public, stays in admin as hidden ---
	moderate(t, srv, owner, pubReview.ID, api.ReviewModeration{Status: ptrTo(api.ReviewStatus("hidden"))})
	if got := publicReviewIDs(t, srv, prod.Slug); len(got) != 0 {
		t.Fatalf("after hiding, public list = %v, want empty", got)
	}
	if r := findReview(adminReviews(t, srv, owner, nil), pubReview.ID); r == nil || r.Status != "hidden" {
		t.Fatalf("hidden review missing/ wrong status in admin list: %+v", r)
	}

	// --- REPLY + publish the guest review → it appears on the public list WITH a server-stamped reply ---
	moderate(t, srv, owner, guestHidden.ID, api.ReviewModeration{
		Status: ptrTo(api.ReviewStatus("published")), Reply: ptrTo("Cảm ơn góp ý của bạn nhé!"),
	})
	pub := publicReviews(t, srv, prod.Slug)
	if len(pub) != 1 || pub[0].Id != guestHidden.ID || pub[0].Reply == nil || pub[0].Reply.Body != "Cảm ơn góp ý của bạn nhé!" {
		t.Fatalf("after reply+publish, public list = %+v, want the guest review with reply", pub)
	}
	if pub[0].Reply.At.IsZero() {
		t.Error("reply.at should be server-stamped, got zero time")
	}

	// --- STAFF can moderate too (reviews are owner+staff, unlike the owner-only catalog) ---
	staff := withActor(ctx, Actor{ByUser: uuid.NewString(), Role: order.RoleStaff, At: time.Now().UTC()})
	if _, err := srv.UpdateAdminReview(staff, api.UpdateAdminReviewRequestObject{
		Id: guestHidden.ID, Body: &api.ReviewModeration{Status: ptrTo(api.ReviewStatus("hidden"))},
	}); err != nil {
		t.Fatalf("staff moderate should succeed (reviews are owner+staff): %v", err)
	}

	// --- unknown id → 404; empty body → 400 (a response, not an error) ---
	if _, err := srv.UpdateAdminReview(owner, api.UpdateAdminReviewRequestObject{
		Id: uuid.New(), Body: &api.ReviewModeration{Status: ptrTo(api.ReviewStatus("hidden"))},
	}); !errors.Is(err, db.ErrNotFound) {
		t.Fatalf("unknown id moderate: err = %v, want ErrNotFound (404)", err)
	}
	resp, err := srv.UpdateAdminReview(owner, api.UpdateAdminReviewRequestObject{Id: pubReview.ID, Body: &api.ReviewModeration{}})
	if err != nil {
		t.Fatalf("empty body should be a 400 response, not an error: %v", err)
	}
	if _, ok := resp.(api.UpdateAdminReview400JSONResponse); !ok {
		t.Fatalf("empty body resp = %T, want 400", resp)
	}
}

// adminReviews drives GetAdminReviews (optionally status-filtered) and returns the list.
func adminReviews(t *testing.T, srv *Server, ctx context.Context, status *api.ReviewStatus) []api.AdminReview {
	t.Helper()
	resp, err := srv.GetAdminReviews(ctx, api.GetAdminReviewsRequestObject{Params: api.GetAdminReviewsParams{Status: status}})
	if err != nil {
		t.Fatalf("list admin reviews: %v", err)
	}
	list, ok := resp.(api.GetAdminReviews200JSONResponse)
	if !ok {
		t.Fatalf("admin reviews resp = %T, want 200", resp)
	}
	return list
}

func findReview(list []api.AdminReview, id uuid.UUID) *api.AdminReview {
	for i := range list {
		if list[i].Id == id {
			return &list[i]
		}
	}
	return nil
}

// moderate drives UpdateAdminReview and asserts a 204.
func moderate(t *testing.T, srv *Server, ctx context.Context, id uuid.UUID, body api.ReviewModeration) {
	t.Helper()
	resp, err := srv.UpdateAdminReview(ctx, api.UpdateAdminReviewRequestObject{Id: id, Body: &body})
	if err != nil {
		t.Fatalf("moderate %s: %v", id, err)
	}
	if _, ok := resp.(api.UpdateAdminReview204Response); !ok {
		t.Fatalf("moderate resp = %T, want 204", resp)
	}
}

// publicReviews drives the storefront GetProductReviews (published-only) for a slug.
func publicReviews(t *testing.T, srv *Server, slug string) []api.Review {
	t.Helper()
	resp, err := srv.GetProductReviews(context.Background(), api.GetProductReviewsRequestObject{Slug: slug})
	if err != nil {
		t.Fatalf("public reviews: %v", err)
	}
	r200, ok := resp.(api.GetProductReviews200JSONResponse)
	if !ok {
		t.Fatalf("public reviews resp = %T, want 200", resp)
	}
	return r200.Body.Items
}

func publicReviewIDs(t *testing.T, srv *Server, slug string) []uuid.UUID {
	t.Helper()
	var ids []uuid.UUID
	for _, r := range publicReviews(t, srv, slug) {
		ids = append(ids, r.Id)
	}
	return ids
}
