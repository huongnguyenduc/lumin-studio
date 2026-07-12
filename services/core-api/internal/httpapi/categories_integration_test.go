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

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
)

// Integration tests for GetCategories (GET /categories, PR-P1-d) against real Postgres (testcontainers:
// skip local without Docker, run in CI — ADR-020; startPostgres lives in a sibling integration file). They
// drive the FULL public router with NO cookie to prove the route is mounted, classified authPublic, returns
// only the BROWSABLE taxonomy (categories with >=1 active product) in the owner-set display_order (menu)
// order, renders an empty result as `[]` (not 404), and honours the conditional-GET (ETag → If-None-Match →
// 304) + Cache-Control contract — the same caching shape as /products.
//
// The load-bearing case is NON-LEAK: a category whose only products are draft/archived (or which is empty)
// must NEVER appear — otherwise the chip dead-ends and an unreleased category name leaks (the exact info the
// active-only product reads withhold). Ordering is now display_order-driven (P3-o slice o-2): categories
// created via InsertCategory APPEND (display_order = max+1), so with no owner reorder the public list comes
// back in INSERTION order; name/slug remain only as a deterministic tiebreak for the (app-impossible) equal
// display_order case. Display names are ASCII on purpose so any residual name-order assertion stays
// collation-stable across environments.

func getCategories(t *testing.T, router http.Handler, ifNoneMatch string) (*httptest.ResponseRecorder, []api.Category) {
	t.Helper()
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/categories", nil)
	if ifNoneMatch != "" {
		req.Header.Set("If-None-Match", ifNoneMatch)
	}
	router.ServeHTTP(rec, req)
	if rec.Code == http.StatusNotModified {
		return rec, nil
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /categories = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	var cats []api.Category
	if err := json.Unmarshal(rec.Body.Bytes(), &cats); err != nil {
		t.Fatalf("decode []Category: %v", err)
	}
	return rec, cats
}

func slugsOfCats(cats []api.Category) []string {
	out := make([]string, len(cats))
	for i, c := range cats {
		out[i] = c.Slug
	}
	return out
}

// mkProduct seeds one product in a category with the given status (base fields are irrelevant to the
// category read — only category_id + status matter to the EXISTS scope). Product slugs are unique.
func mkProduct(t *testing.T, ctx context.Context, pool *pgxpool.Pool, catID uuid.UUID, slug string, status sqlc.ProductStatus) {
	t.Helper()
	if _, err := db.NewCatalog(pool).CreateProduct(ctx, sqlc.InsertProductParams{
		ID: uuid.New(), Slug: slug, Name: "SP " + slug, Description: "",
		CategoryID: catID, BasePrice: 100_000, Dimensions: []byte(`{"w":10,"d":10,"h":10}`),
		Material: "PLA", Images: []byte(`[]`), Status: status,
	}); err != nil {
		t.Fatalf("seed product %s: %v", slug, err)
	}
}

func TestGetCategoriesEndToEnd(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()
	cat := db.NewCatalog(pool)
	mkCat := func(slug, name string) uuid.UUID {
		c, err := cat.CreateCategory(ctx, sqlc.InsertCategoryParams{ID: uuid.New(), Slug: slug, Name: name})
		if err != nil {
			t.Fatalf("seed category %s: %v", slug, err)
		}
		return c.ID
	}

	srv := NewServer(slog.New(slog.NewTextHandler(io.Discard, nil)), pool, nil, nil)
	router := testAuthedRouter(srv)

	// (1) Fresh migrated DB — zero categories. The public list must render `[]` with a 200 + ETag, never a 404
	// (spec §03 zero-state). Through the router with NO cookie → proves the mount + authPublic gate on empty.
	// A JSON `null` body decodes to a nil slice and breaks a client `.map`, so both checks are load-bearing.
	t.Run("no categories → [] with 200 + ETag (not 404, not null)", func(t *testing.T) {
		rec, cats := getCategories(t, router, "")
		if cats == nil {
			t.Fatal("empty catalog rendered JSON null, want []")
		}
		if len(cats) != 0 {
			t.Fatalf("empty catalog returned %d categories, want 0", len(cats))
		}
		if got := strings.TrimSpace(rec.Body.String()); got != "[]" {
			t.Errorf("empty body = %q, want []", got)
		}
		if rec.Header().Get("ETag") == "" || rec.Header().Get("Cache-Control") == "" {
			t.Error("missing ETag / Cache-Control on empty list")
		}
	})

	// (2) NON-LEAK: seed categories that are NOT browsable — one whose only product is DRAFT (an unreleased
	// line) and one with NO products at all. Categories now EXIST, but none is browsable, so the list must
	// still be `[]`. This proves the leak fix directly: an unreleased category name never reaches the wire.
	unreleased := mkCat("unreleased", "Halloween 2027") // only a draft product → hidden
	mkProduct(t, ctx, pool, unreleased, "unreleased-p1", sqlc.ProductStatusDraft)
	mkCat("empty", "Empty") // no products at all → hidden
	t.Run("categories with only hidden/no products → still [] (no dead-end chip, no name leak)", func(t *testing.T) {
		_, cats := getCategories(t, router, "")
		if len(cats) != 0 {
			t.Fatalf("draft-only/empty categories leaked into the public list: %v, want none", slugsOfCats(cats))
		}
	})

	// (3) Seed BROWSABLE categories (each with >=1 active product) in a fixed INSERTION order. Since
	// InsertCategory appends (display_order = max+1) and no reorder is applied, the public list must come
	// back in exactly this insertion order (P3-o slice o-2). The draft-only "unreleased" and empty "empty"
	// categories from step (2) were inserted FIRST but stay hidden (not browsable), so they neither appear
	// nor shift the browsable ones' relative order.
	for _, s := range []struct{ slug, name string }{
		{"lamps", "Lamps"},
		{"decor-b", "Decor"},
		{"decor-a", "Decor"},
		{"keychains", "Keychains"},
	} {
		id := mkCat(s.slug, s.name)
		mkProduct(t, ctx, pool, id, s.slug+"-p1", sqlc.ProductStatusActive)
	}

	t.Run("returns only browsable categories in display_order (insertion order; hidden ones excluded) + headers", func(t *testing.T) {
		rec, cats := getCategories(t, router, "")
		// display_order = insertion order (no owner reorder): lamps, decor-b, decor-a, keychains. "unreleased"
		// (draft only) and "empty" (no products) MUST NOT appear.
		want := []string{"lamps", "decor-b", "decor-a", "keychains"}
		if got := slugsOfCats(cats); !eqSlugs(got, want) {
			t.Errorf("order = %v, want %v (browsable only, display_order = insertion order)", got, want)
		}
		for _, c := range cats {
			if c.Slug == "unreleased" || c.Slug == "empty" {
				t.Errorf("hidden category %q leaked into the public list", c.Slug)
			}
		}
		if rec.Header().Get("ETag") == "" || rec.Header().Get("Cache-Control") == "" {
			t.Error("missing ETag / Cache-Control header")
		}
	})

	t.Run("conditional GET: If-None-Match → 304, no body; wrong ETag → 200", func(t *testing.T) {
		rec, _ := getCategories(t, router, "")
		etag := rec.Header().Get("ETag")
		if etag == "" {
			t.Fatal("no ETag to revalidate against")
		}

		rec304 := httptest.NewRecorder()
		req304 := httptest.NewRequest(http.MethodGet, "/categories", nil)
		req304.Header.Set("If-None-Match", etag)
		router.ServeHTTP(rec304, req304)
		if rec304.Code != http.StatusNotModified {
			t.Fatalf("If-None-Match match = %d, want 304 (body=%s)", rec304.Code, rec304.Body.String())
		}
		if rec304.Body.Len() != 0 {
			t.Errorf("304 body = %q, want empty", rec304.Body.String())
		}
		if rec304.Header().Get("ETag") != etag {
			t.Errorf("304 ETag = %q, want %q (unchanged validator)", rec304.Header().Get("ETag"), etag)
		}
		if rec304.Header().Get("Cache-Control") == "" {
			t.Error("304 missing Cache-Control (declared on the 304 response)")
		}

		// A stale/unrelated validator must NOT short-circuit — proves the 304 is conditional, not always-on.
		rec200, cats := getCategories(t, router, `W/"deadbeef"`)
		if rec200.Code != http.StatusOK {
			t.Fatalf("wrong If-None-Match = %d, want 200", rec200.Code)
		}
		if len(cats) != 4 {
			t.Errorf("wrong-etag body = %d categories, want 4 (full 200)", len(cats))
		}
	})
}
