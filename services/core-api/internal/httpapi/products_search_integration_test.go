package httpapi

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"sort"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
)

// Integration tests for the P1-e `?q=` full-text search (ADR-016) against real Postgres (testcontainers:
// skip local without Docker, run in CI). They PROVE the two things a unit test cannot: (1) the shipped
// unaccent dictionary + our immutable_unaccent(000012) actually fold Vietnamese diacritics — critically
// đ/Đ, the stroke letter in the shop's core term "đèn" — so "den" matches "đèn"; and (2) search stays
// inside the active-only SQL scope, so a DRAFT product whose name matches is NEVER surfaced.

// searchSeed is a controlled catalog with ACCENTED names/descriptions so the no-accent matching is real.
type searchSeed struct{ catDen uuid.UUID }

func seedSearchCatalog(t *testing.T, ctx context.Context, pool *pgxpool.Pool) searchSeed {
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
	specs := []struct {
		slug, name, desc string
		catID            uuid.UUID
		dayOff           int
		status           sqlc.ProductStatus
	}{
		// Two ACTIVE đèn products. "mây" (→ may) is only on the first; "handmade" (a token that appears in
		// NO product NAME) is only in the second's DESCRIPTION — it proves the description is part of the FTS doc.
		{"den-may", "Đèn ngủ mây tre", "ánh sáng ấm cúng cho phòng ngủ", den, 3, sqlc.ProductStatusActive},
		{"den-go", "Đèn bàn gỗ sồi", "phong cách tối giản, handmade", den, 2, sqlc.ProductStatusActive},
		// An ACTIVE non-đèn product — its name must never match a "den" search.
		{"moc-gau", "Móc khoá gấu bông", "quà tặng nhỏ xinh", moc, 1, sqlc.ProductStatusActive},
		// A DRAFT whose NAME matches "đèn": search must NOT surface it (active-only scope, non-leak).
		{"den-draft", "Đèn treo bản nháp", "chưa phát hành", den, 4, sqlc.ProductStatusDraft},
	}
	for _, s := range specs {
		p, err := cat.CreateProduct(ctx, sqlc.InsertProductParams{
			ID: uuid.New(), Slug: s.slug, Name: s.name, Description: s.desc, CategoryID: s.catID,
			BasePrice: 190_000, Dimensions: []byte(`{"w":10,"d":10,"h":10}`), Material: "PLA",
			Images: []byte(`["https://x/` + s.slug + `.jpg"]`), Status: s.status,
		})
		if err != nil {
			t.Fatalf("seed product %s: %v", s.slug, err)
		}
		if _, err := pool.Exec(ctx, `UPDATE products SET created_at=$1 WHERE id=$2`,
			base.AddDate(0, 0, s.dayOff), p.ID); err != nil {
			t.Fatalf("set created_at for %s: %v", s.slug, err)
		}
	}
	return searchSeed{catDen: den}
}

// sameSet reports set-equality of the returned slugs regardless of order (search result order is the
// default newest sort, not asserted here — these tests are about WHICH rows match, not their order).
func sameSet(got []string, want ...string) bool {
	if len(got) != len(want) {
		return false
	}
	g, w := append([]string(nil), got...), append([]string(nil), want...)
	sort.Strings(g)
	sort.Strings(w)
	for i := range g {
		if g[i] != w[i] {
			return false
		}
	}
	return true
}

func TestGetProductsSearch(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()
	seed := seedSearchCatalog(t, ctx, pool)
	_ = seed

	srv := NewServer(slog.New(slog.NewTextHandler(io.Discard, nil)), pool, nil, nil)
	router := testAuthedRouter(srv)

	// The core ADR-016 promise: a NO-ACCENT query folds through unaccent + our đ/Đ translate to match the
	// accented names. "den" → both active đèn products; NOT the moc product; NOT the đèn DRAFT (non-leak).
	t.Run("no-accent 'den' matches 'đèn' (active-only)", func(t *testing.T) {
		_, list := getProducts(t, router, "?pageSize=10&q=den")
		if got := slugsOf(list); list.Total != 2 || !sameSet(got, "den-may", "den-go") {
			t.Errorf("q=den = %v/%d, want den-may+den-go (moc excluded, draft NOT leaked)", got, list.Total)
		}
	})

	// Searching WITH the accent is identical — both sides are folded, so the accent is irrelevant.
	t.Run("accented 'đèn' == 'den' (both sides folded)", func(t *testing.T) {
		_, withAccent := getProducts(t, router, "?pageSize=10&q=%C4%91%C3%A8n") // đèn
		_, noAccent := getProducts(t, router, "?pageSize=10&q=den")
		if !sameSet(slugsOf(withAccent), slugsOf(noAccent)...) || withAccent.Total != noAccent.Total {
			t.Errorf("đèn=%v/%d vs den=%v/%d, want identical",
				slugsOf(withAccent), withAccent.Total, slugsOf(noAccent), noAccent.Total)
		}
	})

	// A folded tone-mark term ("may" → "mây") narrows to the one product whose name carries it.
	t.Run("'may' folds to 'mây' — narrows to one", func(t *testing.T) {
		_, list := getProducts(t, router, "?pageSize=10&q=may")
		if got := slugsOf(list); list.Total != 1 || !sameSet(got, "den-may") {
			t.Errorf("q=may = %v/%d, want just den-may", got, list.Total)
		}
	})

	// Multi-word terms AND together (plainto_tsquery): "den may" matches only the product with BOTH lexemes.
	t.Run("multi-word ANDs (plainto_tsquery)", func(t *testing.T) {
		_, list := getProducts(t, router, "?pageSize=10&q=den+may")
		if got := slugsOf(list); list.Total != 1 || !sameSet(got, "den-may") {
			t.Errorf("q='den may' = %v/%d, want just den-may (den AND may)", got, list.Total)
		}
	})

	// The FTS document includes the DESCRIPTION, not just the name: "handmade" appears only in den-go's desc.
	t.Run("description is searched (handmade → den-go)", func(t *testing.T) {
		_, list := getProducts(t, router, "?pageSize=10&q=handmade")
		if got := slugsOf(list); list.Total != 1 || !sameSet(got, "den-go") {
			t.Errorf("q=handmade = %v/%d, want just den-go (matched via description)", got, list.Total)
		}
	})

	// Search ANDs with the category filter — "den" within category=den is still the two đèn products;
	// a term with no match is an empty page (total 0), never a 404.
	t.Run("search + category AND; no match → empty page", func(t *testing.T) {
		_, inDen := getProducts(t, router, "?pageSize=10&q=den&category=den")
		if inDen.Total != 2 {
			t.Errorf("q=den&category=den total = %d, want 2", inDen.Total)
		}
		_, none := getProducts(t, router, "?pageSize=10&q=khongtontaixyz")
		if none.Total != 0 || len(none.Items) != 0 {
			t.Errorf("no-match search = %d/%d items, want an empty page (0/0), not 404", none.Total, len(none.Items))
		}
	})

	// The count applies the SAME search filter as the list, so the envelope total reflects the searched
	// set — and the ETag hashes the (now-smaller) body, so a searched response revalidates independently.
	t.Run("ETag varies by q", func(t *testing.T) {
		full := httptest.NewRecorder()
		router.ServeHTTP(full, httptest.NewRequest(http.MethodGet, "/products?pageSize=10", nil))
		searched := httptest.NewRecorder()
		router.ServeHTTP(searched, httptest.NewRequest(http.MethodGet, "/products?pageSize=10&q=den", nil))
		if e1, e2 := full.Header().Get("ETag"), searched.Header().Get("ETag"); e1 == "" || e2 == "" || e1 == e2 {
			t.Errorf("ETags full=%q searched=%q, want both present and different", e1, e2)
		}
	})
}
