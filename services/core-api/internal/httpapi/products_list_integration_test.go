package httpapi

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
)

// Integration tests for GetProducts (GET /products, PR-P1-c) against real Postgres (testcontainers:
// skip local without Docker, run in CI — ADR-020; startPostgres lives in a sibling integration file).
// They drive the FULL public router (no cookie) to prove the route is mounted, classified authPublic,
// active-only at the SQL source (a draft is NEVER listed), correctly filtered/sorted/paginated, and
// that the conditional-GET (ETag → If-None-Match → 304) + Cache-Control contract holds.

type listSeed struct {
	catDen, catMoc uuid.UUID
}

// seedListCatalog builds a controlled catalog: 4 active products in "den", 1 active in "moc", and 1
// DRAFT in "den" (must never appear). rating_avg / review_count / created_at are set explicitly so the
// sort assertions are deterministic (InsertProduct leaves rating null + review_count 0 + created_at now()).
func seedListCatalog(t *testing.T, ctx context.Context, pool *pgxpool.Pool) listSeed {
	t.Helper()
	cat := db.NewCatalog(pool)
	mkCat := func(slug, name string) uuid.UUID {
		c, err := cat.CreateCategory(ctx, sqlc.InsertCategoryParams{ID: uuid.New(), Slug: slug, Name: name})
		if err != nil {
			t.Fatalf("seed category %s: %v", slug, err)
		}
		return c.ID
	}
	den, moc := mkCat("den", "Đèn"), mkCat("moc", "Móc khoá")

	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	fp := func(v float32) *float32 { return &v }
	specs := []struct {
		slug    string
		catID   uuid.UUID
		price   int64
		rating  *float32
		reviews int32
		dayOff  int // created_at = base + dayOff days; higher = newer
		status  sqlc.ProductStatus
	}{
		{"den-a1", den, 300_000, fp(4.8), 128, 4, sqlc.ProductStatusActive},
		{"den-a2", den, 100_000, nil, 0, 3, sqlc.ProductStatusActive}, // no reviews → null rating
		{"den-a3", den, 200_000, fp(4.2), 40, 2, sqlc.ProductStatusActive},
		{"den-a4", den, 150_000, fp(4.9), 12, 1, sqlc.ProductStatusActive},
		{"moc-b1", moc, 65_000, fp(4.6), 54, 5, sqlc.ProductStatusActive},   // newest
		{"den-draft", den, 999_000, fp(5.0), 3, 6, sqlc.ProductStatusDraft}, // hidden — never listed
	}
	for _, s := range specs {
		p, err := cat.CreateProduct(ctx, sqlc.InsertProductParams{
			ID: uuid.New(), Slug: s.slug, Name: "SP " + s.slug, Description: "mô tả dài không nên xuất hiện ở card",
			CategoryID: s.catID, BasePrice: s.price, Dimensions: []byte(`{"w":10,"d":10,"h":10}`), Material: "PLA",
			Images: []byte(`["https://x/` + s.slug + `.jpg"]`), Status: s.status,
		})
		if err != nil {
			t.Fatalf("seed product %s: %v", s.slug, err)
		}
		if _, err := pool.Exec(ctx,
			`UPDATE products SET rating_avg=$1, review_count=$2, created_at=$3 WHERE id=$4`,
			s.rating, s.reviews, base.AddDate(0, 0, s.dayOff), p.ID); err != nil {
			t.Fatalf("set meta for %s: %v", s.slug, err)
		}
	}
	return listSeed{catDen: den, catMoc: moc}
}

func getProducts(t *testing.T, router http.Handler, query string) (*httptest.ResponseRecorder, api.ProductList) {
	t.Helper()
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/products"+query, nil)
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /products%s = %d, want 200 (body=%s)", query, rec.Code, rec.Body.String())
	}
	var list api.ProductList
	if err := json.Unmarshal(rec.Body.Bytes(), &list); err != nil {
		t.Fatalf("decode ProductList: %v", err)
	}
	return rec, list
}

func slugsOf(list api.ProductList) []string {
	out := make([]string, len(list.Items))
	for i, c := range list.Items {
		out[i] = c.Slug
	}
	return out
}

func eqSlugs(a, b []string) bool {
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

func TestGetProductsEndToEnd(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()
	seed := seedListCatalog(t, ctx, pool)
	_ = seed

	srv := NewServer(slog.New(slog.NewTextHandler(io.Discard, nil)), pool, nil, nil)
	router := testAuthedRouter(srv)

	// Default page through the public router with NO cookie: proves the mount, the authPublic gate,
	// active-only (5 active, the draft excluded), the newest default sort, and the response headers.
	t.Run("default: active-only, newest sort, headers", func(t *testing.T) {
		rec, list := getProducts(t, router, "?pageSize=10")
		if list.Total != 5 {
			t.Fatalf("total = %d, want 5 (draft excluded)", list.Total)
		}
		if len(list.Items) != 5 {
			t.Fatalf("items = %d, want 5", len(list.Items))
		}
		for _, c := range list.Items {
			if c.Slug == "den-draft" {
				t.Fatal("draft product leaked into the public list")
			}
		}
		// newest = created_at DESC: moc-b1(day5), den-a1(4), den-a2(3), den-a3(2), den-a4(1).
		want := []string{"moc-b1", "den-a1", "den-a2", "den-a3", "den-a4"}
		if got := slugsOf(list); !eqSlugs(got, want) {
			t.Errorf("newest order = %v, want %v", got, want)
		}
		if rec.Header().Get("Cache-Control") == "" {
			t.Error("missing Cache-Control header")
		}
		if rec.Header().Get("ETag") == "" {
			t.Error("missing ETag header")
		}
		// Card projection carries no description body (kept off the wire — no N+1 / lighter card).
		if raw := rec.Body.String(); strings.Contains(raw, "mô tả dài") {
			t.Error("card projection leaked the description body")
		}
	})

	t.Run("sort price_asc / price_desc", func(t *testing.T) {
		_, asc := getProducts(t, router, "?pageSize=10&sort=price_asc")
		if got, want := slugsOf(asc), []string{"moc-b1", "den-a2", "den-a4", "den-a3", "den-a1"}; !eqSlugs(got, want) {
			t.Errorf("price_asc = %v, want %v", got, want)
		}
		_, desc := getProducts(t, router, "?pageSize=10&sort=price_desc")
		if got, want := slugsOf(desc), []string{"den-a1", "den-a3", "den-a4", "den-a2", "moc-b1"}; !eqSlugs(got, want) {
			t.Errorf("price_desc = %v, want %v", got, want)
		}
	})

	t.Run("sort rating (nulls last)", func(t *testing.T) {
		_, list := getProducts(t, router, "?pageSize=10&sort=rating")
		// 4.9(a4), 4.8(a1), 4.6(b1), 4.2(a3), then null-rating den-a2 LAST.
		want := []string{"den-a4", "den-a1", "moc-b1", "den-a3", "den-a2"}
		if got := slugsOf(list); !eqSlugs(got, want) {
			t.Errorf("rating order = %v, want %v (null rating last)", got, want)
		}
	})

	t.Run("category filter", func(t *testing.T) {
		_, list := getProducts(t, router, "?pageSize=10&category=den")
		if list.Total != 4 {
			t.Fatalf("den total = %d, want 4 (draft excluded)", list.Total)
		}
		for _, c := range list.Items {
			if c.CategoryId != seed.catDen {
				t.Errorf("card %s categoryId = %s, want den", c.Slug, c.CategoryId)
			}
		}
	})

	t.Run("unknown category → empty page, not 404", func(t *testing.T) {
		_, list := getProducts(t, router, "?category=khong-co-that")
		if list.Total != 0 || len(list.Items) != 0 {
			t.Errorf("unknown category = total %d items %d, want empty page", list.Total, len(list.Items))
		}
	})

	// Empty category (?category=) means "all categories" — collapsed to no filter (normalizeFilter), NOT
	// an empty-slug filter that would return zero. A frontend "All" control maps selected="" here.
	t.Run("empty category → full catalog (all), not empty", func(t *testing.T) {
		_, list := getProducts(t, router, "?pageSize=10&category=")
		if list.Total != 5 || len(list.Items) != 5 {
			t.Errorf("empty category = total %d items %d, want the full 5 (== omitted)", list.Total, len(list.Items))
		}
	})

	// The reserved `q` param is accepted (200, no 400) and IGNORED until P1-e wires FTS — the result set
	// is identical to omitting it. Pins the forward-contract promise so a future change can't silently break it.
	t.Run("reserved q is accepted and ignored (200, same results)", func(t *testing.T) {
		_, noq := getProducts(t, router, "?pageSize=10")
		_, withq := getProducts(t, router, "?pageSize=10&q=bất-kỳ")
		if !eqSlugs(slugsOf(noq), slugsOf(withq)) || withq.Total != noq.Total {
			t.Errorf("q changed the result: with=%v/%d vs without=%v/%d (must be ignored)",
				slugsOf(withq), withq.Total, slugsOf(noq), noq.Total)
		}
	})

	t.Run("pagination stable across pages", func(t *testing.T) {
		_, p1 := getProducts(t, router, "?pageSize=2&page=1")
		_, p2 := getProducts(t, router, "?pageSize=2&page=2")
		_, p3 := getProducts(t, router, "?pageSize=2&page=3")
		if p1.Total != 5 || p1.Page != 1 || p1.PageSize != 2 {
			t.Errorf("page1 envelope = total %d page %d size %d, want 5/1/2", p1.Total, p1.Page, p1.PageSize)
		}
		if got, want := slugsOf(p1), []string{"moc-b1", "den-a1"}; !eqSlugs(got, want) {
			t.Errorf("page1 = %v, want %v", got, want)
		}
		if got, want := slugsOf(p2), []string{"den-a2", "den-a3"}; !eqSlugs(got, want) {
			t.Errorf("page2 = %v, want %v", got, want)
		}
		if got, want := slugsOf(p3), []string{"den-a4"}; !eqSlugs(got, want) {
			t.Errorf("page3 = %v, want %v", got, want)
		}
	})

	t.Run("far page → empty items, real total (no offset overflow)", func(t *testing.T) {
		_, list := getProducts(t, router, "?page=999999999")
		if len(list.Items) != 0 {
			t.Errorf("far page items = %d, want 0", len(list.Items))
		}
		if list.Total != 5 {
			t.Errorf("far page total = %d, want 5 (still reported)", list.Total)
		}
	})

	t.Run("conditional GET: If-None-Match → 304, no body", func(t *testing.T) {
		rec, _ := getProducts(t, router, "?pageSize=10")
		etag := rec.Header().Get("ETag")
		if etag == "" {
			t.Fatal("no ETag to revalidate against")
		}
		rec2 := httptest.NewRecorder()
		req2 := httptest.NewRequest(http.MethodGet, "/products?pageSize=10", nil)
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
		// The 304 carries the same cache directive as the 200 (the contract declares it on both).
		if rec2.Header().Get("Cache-Control") == "" {
			t.Error("304 missing Cache-Control header (declared on the 304 response)")
		}
	})

	t.Run("pageSize over cap → 400 through the router", func(t *testing.T) {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/products?pageSize=1000", nil)
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
