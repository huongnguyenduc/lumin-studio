package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
)

// Integration tests for GetProductReviews (GET /products/{slug}/reviews, PR-P1-l) against real Postgres
// (testcontainers: skip local without Docker, run in CI — ADR-020; startPostgres lives in a sibling file).
// They drive the FULL public router (no cookie) to prove the route is mounted + classified authPublic,
// published-only at the SQL source (a HIDDEN review is NEVER served), newest-first + stable pagination,
// active-product-only (unknown/draft slug both 404), the empty zero-state (200 `[]`, not 404), and the
// conditional-GET (ETag → If-None-Match → 304) + Cache-Control contract.

type reviewSeed struct {
	activeSlug string      // product with 3 published + 2 hidden reviews
	draftSlug  string      // draft product that HAS a published review — must still 404
	emptySlug  string      // active product with zero reviews
	tieSlug    string      // product whose published reviews all share an identical created_at
	tieIDs     []uuid.UUID // those reviews' ids (only the `id DESC` tiebreak can order them)
}

// seedReviews builds a controlled review set. The active product gets 3 published + 2 hidden reviews with
// explicit created_at so newest-first is deterministic; the newest published review carries a shop reply.
// A DRAFT product also gets a published review (to prove reviews on a hidden product are never served),
// and a second active product gets none (the empty zero-state).
func seedReviews(t *testing.T, ctx context.Context, pool *pgxpool.Pool) reviewSeed {
	t.Helper()
	cat := db.NewCatalog(pool)

	category, err := cat.CreateCategory(ctx, sqlc.InsertCategoryParams{ID: uuid.New(), Slug: "den", Name: "Đèn"})
	if err != nil {
		t.Fatalf("seed category: %v", err)
	}
	mkProduct := func(slug string, status sqlc.ProductStatus) sqlc.Product {
		p, perr := cat.CreateProduct(ctx, sqlc.InsertProductParams{
			ID: uuid.New(), Slug: slug, Name: "SP " + slug, Description: "mô tả", CategoryID: category.ID,
			BasePrice: 300_000, Dimensions: []byte(`{"w":10,"d":10,"h":10}`), Material: "PLA",
			Images: []byte(`[]`), Status: status,
		})
		if perr != nil {
			t.Fatalf("seed product %s: %v", slug, perr)
		}
		return p
	}
	active := mkProduct("den-nam", sqlc.ProductStatusActive)
	draft := mkProduct("den-draft", sqlc.ProductStatusDraft)
	empty := mkProduct("den-empty", sqlc.ProductStatusActive)
	tie := mkProduct("den-tie", sqlc.ProductStatusActive)

	base := time.Date(2026, 2, 1, 0, 0, 0, 0, time.UTC)
	mkReview := func(productID uuid.UUID, rating int16, body string, reply []byte, status sqlc.ReviewStatus, dayOff int) uuid.UUID {
		r, rerr := cat.CreateReview(ctx, sqlc.InsertReviewParams{
			ID: uuid.New(), ProductID: productID, CustomerID: pgtype.UUID{}, // guest review → NULL customer_id
			Rating: rating, Body: body, Images: []byte(`[]`), Reply: reply, Status: status,
		})
		if rerr != nil {
			t.Fatalf("seed review %q: %v", body, rerr)
		}
		// InsertReview leaves created_at = now(); set it explicitly so newest-first is deterministic.
		if _, uerr := pool.Exec(ctx, `UPDATE reviews SET created_at=$1 WHERE id=$2`, base.AddDate(0, 0, dayOff), r.ID); uerr != nil {
			t.Fatalf("set review created_at %q: %v", body, uerr)
		}
		return r.ID
	}

	// Active product: 3 published (days 5/3/1 → newest first) + 2 hidden (days 4/2, interleaved so a naive
	// query without the status filter would splice them into the ordered list).
	mkReview(active.ID, 5, "Mới nhất", []byte(`{"body":"Cảm ơn bạn!","at":"2026-02-10T00:00:00Z"}`), sqlc.ReviewStatusPublished, 5)
	mkReview(active.ID, 4, "Giữa", nil, sqlc.ReviewStatusPublished, 3)
	mkReview(active.ID, 3, "Cũ nhất", nil, sqlc.ReviewStatusPublished, 1)
	mkReview(active.ID, 1, "ẨN một sao", nil, sqlc.ReviewStatusHidden, 4)
	mkReview(active.ID, 2, "ẨN hai sao", nil, sqlc.ReviewStatusHidden, 2)

	// A published review on a DRAFT product — must never be served (the product resolves 404 first).
	mkReview(draft.ID, 5, "Trên sản phẩm nháp", nil, sqlc.ReviewStatusPublished, 6)

	// Tie product: FIVE published reviews all sharing an IDENTICAL created_at (dayOff 0). With every
	// created_at equal, ONLY the `id DESC` tiebreak can order them — a full page-walk must come back in
	// exact id-DESC order. Five rows make the tiebreak load-bearing: if `, id DESC` were dropped the walk
	// would follow heap-scan (insertion) order, which matches id-DESC by chance only ~1/120 of the time, so
	// the assertion turns RED deterministically (whereas two rows would only catch it ~50% of runs).
	var tieIDs []uuid.UUID
	for i := 0; i < 5; i++ {
		tieIDs = append(tieIDs, mkReview(tie.ID, int16(1+i), fmt.Sprintf("Đồng thời %d", i), nil, sqlc.ReviewStatusPublished, 0))
	}

	return reviewSeed{
		activeSlug: active.Slug, draftSlug: draft.Slug, emptySlug: empty.Slug,
		tieSlug: tie.Slug, tieIDs: tieIDs,
	}
}

func getReviews(t *testing.T, router http.Handler, path string) (*httptest.ResponseRecorder, api.ReviewList) {
	t.Helper()
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, path, nil)
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET %s = %d, want 200 (body=%s)", path, rec.Code, rec.Body.String())
	}
	var list api.ReviewList
	if err := json.Unmarshal(rec.Body.Bytes(), &list); err != nil {
		t.Fatalf("decode ReviewList: %v", err)
	}
	return rec, list
}

func bodiesOf(list api.ReviewList) []string {
	out := make([]string, len(list.Items))
	for i, r := range list.Items {
		out[i] = r.Body
	}
	return out
}

func eqStrs(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func TestGetProductReviewsEndToEnd(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()
	seed := seedReviews(t, ctx, pool)

	srv := NewServer(slog.New(slog.NewTextHandler(io.Discard, nil)), pool, nil, nil)
	router := testAuthedRouter(srv)

	// The keystone: published-only at the SQL source. Through the public router with NO cookie — proves
	// the mount, the authPublic gate, newest-first order, the shop reply on the newest, and that NEITHER
	// hidden review appears (total 3, and no "ẨN" body leaks).
	t.Run("published-only, newest first, hidden NEVER served", func(t *testing.T) {
		rec, list := getReviews(t, router, "/products/"+seed.activeSlug+"/reviews?pageSize=10")
		if list.Total != 3 {
			t.Fatalf("total = %d, want 3 (2 hidden excluded)", list.Total)
		}
		if got, want := bodiesOf(list), []string{"Mới nhất", "Giữa", "Cũ nhất"}; !eqStrs(got, want) {
			t.Errorf("order = %v, want %v (newest first, hidden excluded)", got, want)
		}
		if strings.Contains(rec.Body.String(), "ẨN") {
			t.Fatal("a hidden review leaked into the public list")
		}
		if list.Items[0].Reply == nil || list.Items[0].Reply.Body != "Cảm ơn bạn!" {
			t.Errorf("newest review reply = %+v, want the shop reply {body:\"Cảm ơn bạn!\"}", list.Items[0].Reply)
		}
		if list.Items[1].Reply != nil {
			t.Errorf("unreplied review carried a reply = %+v, want nil", list.Items[1].Reply)
		}
		if rec.Header().Get("ETag") == "" || rec.Header().Get("Cache-Control") == "" {
			t.Error("missing ETag / Cache-Control header")
		}
	})

	t.Run("pagination stable across pages", func(t *testing.T) {
		_, p1 := getReviews(t, router, "/products/"+seed.activeSlug+"/reviews?pageSize=2&page=1")
		_, p2 := getReviews(t, router, "/products/"+seed.activeSlug+"/reviews?pageSize=2&page=2")
		if p1.Total != 3 || p1.Page != 1 || p1.PageSize != 2 {
			t.Errorf("page1 envelope = total %d page %d size %d, want 3/1/2", p1.Total, p1.Page, p1.PageSize)
		}
		if got, want := bodiesOf(p1), []string{"Mới nhất", "Giữa"}; !eqStrs(got, want) {
			t.Errorf("page1 = %v, want %v", got, want)
		}
		if got, want := bodiesOf(p2), []string{"Cũ nhất"}; !eqStrs(got, want) {
			t.Errorf("page2 = %v, want %v", got, want)
		}
	})

	// The `id DESC` tiebreak is what keeps OFFSET pagination stable when reviews share a created_at. The tie
	// product's 5 published reviews have an IDENTICAL created_at, so ONLY the tiebreak orders them: a full
	// one-per-page walk must return every id exactly once (no dup/skip) AND in exact id-DESC order. Drop or
	// reorder `, id DESC` in the query and the walk follows heap order → this turns RED (the other pagination
	// tests use distinct created_at, so the tiebreak is invisible to them).
	t.Run("identical created_at → full id-DESC walk, no dup/skip", func(t *testing.T) {
		n := len(seed.tieIDs)
		seen := map[uuid.UUID]bool{}
		var walk []uuid.UUID
		for page := 1; page <= n; page++ {
			_, p := getReviews(t, router, fmt.Sprintf("/products/%s/reviews?pageSize=1&page=%d", seed.tieSlug, page))
			if p.Total != n {
				t.Fatalf("tie page %d total = %d, want %d", page, p.Total, n)
			}
			if len(p.Items) != 1 {
				t.Fatalf("tie page %d items = %d, want 1", page, len(p.Items))
			}
			id := p.Items[0].Id
			if seen[id] {
				t.Fatalf("id %s returned on two pages — OFFSET pagination duplicated a row (tiebreak not stable)", id)
			}
			seen[id] = true
			walk = append(walk, id)
		}
		// Expected order = the seeded ids sorted by uuid DESC (the tiebreak, since all created_at are equal).
		want := append([]uuid.UUID(nil), seed.tieIDs...)
		sort.Slice(want, func(i, j int) bool { return bytes.Compare(want[i][:], want[j][:]) > 0 })
		for i := range want {
			if walk[i] != want[i] {
				t.Errorf("walk[%d] = %s, want %s (full page-walk must equal id-DESC order — tiebreak load-bearing)", i, walk[i], want[i])
			}
		}
	})

	t.Run("far page → empty items, real total (no offset overflow)", func(t *testing.T) {
		_, list := getReviews(t, router, "/products/"+seed.activeSlug+"/reviews?page=999999999")
		if len(list.Items) != 0 {
			t.Errorf("far page items = %d, want 0", len(list.Items))
		}
		if list.Total != 3 {
			t.Errorf("far page total = %d, want 3 (still reported)", list.Total)
		}
	})

	// A product with zero published reviews returns a 200 with items:[] + total 0 (spec §03 zero-state),
	// never a 404. A JSON `null` items would break a client `.map`, so the empty-array shape is load-bearing.
	t.Run("active product, no reviews → 200 [] (not 404, not null)", func(t *testing.T) {
		rec, list := getReviews(t, router, "/products/"+seed.emptySlug+"/reviews?pageSize=10")
		if list.Total != 0 || len(list.Items) != 0 {
			t.Fatalf("empty = total %d items %d, want 0/0", list.Total, len(list.Items))
		}
		var raw map[string]json.RawMessage
		if err := json.Unmarshal(rec.Body.Bytes(), &raw); err != nil {
			t.Fatalf("decode body: %v", err)
		}
		if string(raw["items"]) != "[]" {
			t.Errorf("items = %s, want [] (never null)", raw["items"])
		}
	})

	// Unknown slug AND a draft product (even one that HAS a published review) both return the SAME 404 —
	// no catalog-existence leak, and reviews on a hidden product are never served.
	t.Run("unknown / draft slug → same 404 NOT_FOUND", func(t *testing.T) {
		for _, tc := range []struct{ name, slug string }{
			{"unknown", "khong-ton-tai"},
			{"draft (has a published review)", seed.draftSlug},
		} {
			t.Run(tc.name, func(t *testing.T) {
				rec := httptest.NewRecorder()
				req := httptest.NewRequest(http.MethodGet, "/products/"+tc.slug+"/reviews", nil)
				router.ServeHTTP(rec, req)
				if rec.Code != http.StatusNotFound {
					t.Fatalf("GET reviews for %s = %d, want 404 (body=%s)", tc.slug, rec.Code, rec.Body.String())
				}
				var env api.ErrorEnvelope
				if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
					t.Fatalf("decode envelope: %v", err)
				}
				if env.Code != codeNotFound {
					t.Errorf("code = %q, want %s (uniform not-found)", env.Code, codeNotFound)
				}
			})
		}
	})

	t.Run("conditional GET: If-None-Match → 304, no body", func(t *testing.T) {
		rec, _ := getReviews(t, router, "/products/"+seed.activeSlug+"/reviews?pageSize=10")
		etag := rec.Header().Get("ETag")
		if etag == "" {
			t.Fatal("no ETag to revalidate against")
		}
		rec2 := httptest.NewRecorder()
		req2 := httptest.NewRequest(http.MethodGet, "/products/"+seed.activeSlug+"/reviews?pageSize=10", nil)
		req2.Header.Set("If-None-Match", etag)
		router.ServeHTTP(rec2, req2)
		if rec2.Code != http.StatusNotModified {
			t.Fatalf("If-None-Match match = %d, want 304 (body=%s)", rec2.Code, rec2.Body.String())
		}
		if rec2.Body.Len() != 0 {
			t.Errorf("304 body = %q, want empty", rec2.Body.String())
		}
		if rec2.Header().Get("ETag") != etag {
			t.Errorf("304 ETag = %q, want %q (unchanged validator)", rec2.Header().Get("ETag"), etag)
		}
		if rec2.Header().Get("Cache-Control") == "" {
			t.Error("304 missing Cache-Control header (declared on the 304 response)")
		}
	})

	t.Run("pageSize over cap → 400 through the router", func(t *testing.T) {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/products/"+seed.activeSlug+"/reviews?pageSize=1000", nil)
		router.ServeHTTP(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("pageSize=1000 = %d, want 400 (DoS bound; body=%s)", rec.Code, rec.Body.String())
		}
		var env api.ErrorEnvelope
		if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
			t.Fatalf("decode envelope: %v", err)
		}
		if env.Code != codeValidation {
			t.Errorf("code = %q, want %s", env.Code, codeValidation)
		}
	})
}
