package httpapi

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
)

// Integration tests for the admin category taxonomy write surface (P3-o) against real Postgres
// (testcontainers: skip local without Docker, run in CI — ADR-020). They drive the handlers with an OWNER
// actor (the owner-only boundary is proven Docker-free in TestAdminCategoryWritesAreOwnerOnly) to exercise
// the full round-trip: create → list-with-product-count → rename → delete-empty, plus the branches only real
// FKs/constraints can prove — the product_count aggregate, the category_id RESTRICT→409 delete, and the
// UNIQUE(slug) conflict on create/rename.

// findCategory drives GetAdminCategories and returns the matching AdminCategory (with productCount) or nil.
func findCategory(t *testing.T, srv *Server, ctx context.Context, id uuid.UUID) *api.AdminCategory {
	t.Helper()
	resp, err := srv.GetAdminCategories(ctx, api.GetAdminCategoriesRequestObject{})
	if err != nil {
		t.Fatalf("list categories: %v", err)
	}
	for _, c := range api.GetAdminCategories200JSONResponse(resp.(api.GetAdminCategories200JSONResponse)) {
		if c.Id == id {
			got := c
			return &got
		}
	}
	return nil
}

func TestAdminCategoryCRUDEndToEnd(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()
	owner := ownerCtx()
	srv := NewServer(slog.New(slog.NewTextHandler(io.Discard, nil)), pool, nil, nil)

	// --- create ---
	createResp, err := srv.CreateAdminCategory(owner, api.CreateAdminCategoryRequestObject{Body: &api.CategoryInput{Slug: "den-ban", Name: "Đèn bàn"}})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	created, ok := createResp.(api.CreateAdminCategory201JSONResponse)
	if !ok {
		t.Fatalf("create resp = %T, want 201", createResp)
	}
	cid := created.Id

	// --- list: appears with productCount 0 (an empty category is still admin-visible) ---
	if c := findCategory(t, srv, owner, cid); c == nil || c.ProductCount != 0 {
		t.Fatalf("after create, category = %+v, want present with productCount 0", c)
	}

	// --- a product referencing it bumps productCount to 1 (counts ALL statuses; seed a draft) ---
	if _, err := db.NewCatalog(pool).CreateProduct(ctx, sqlc.InsertProductParams{
		ID: uuid.New(), Slug: "den-1", Name: "Đèn 1", Description: "", CategoryID: cid, BasePrice: 1,
		Dimensions: []byte(`{"w":1,"d":1,"h":1}`), Material: "PLA", Images: []byte(`[]`), Status: sqlc.ProductStatusDraft,
	}); err != nil {
		t.Fatalf("seed product: %v", err)
	}
	if c := findCategory(t, srv, owner, cid); c == nil || c.ProductCount != 1 {
		t.Fatalf("after seeding a product, category = %+v, want productCount 1", c)
	}

	// --- edit: slug + name + o-2 metadata (description, cover image, hidden); productCount unchanged ---
	updResp, err := srv.UpdateAdminCategory(owner, api.UpdateAdminCategoryRequestObject{Id: cid, Body: &api.CategoryUpdate{
		Slug: "den-de-ban", Name: "Đèn để bàn", Description: "Đèn ngủ in 3D ánh ấm", ImageUrl: "https://assets/x.jpg", Visible: false,
	}})
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	upd, ok := updResp.(api.UpdateAdminCategory200JSONResponse)
	if !ok {
		t.Fatalf("update resp = %T, want 200", updResp)
	}
	if upd.Slug != "den-de-ban" || upd.Name != "Đèn để bàn" {
		t.Fatalf("updated = slug %q name %q, want den-de-ban / Đèn để bàn", upd.Slug, upd.Name)
	}
	// The rich fields round-trip in the admin list, and visible=false does not disturb productCount.
	if c := findCategory(t, srv, owner, cid); c == nil || c.Slug != "den-de-ban" || c.ProductCount != 1 ||
		c.Description != "Đèn ngủ in 3D ánh ấm" || c.ImageUrl != "https://assets/x.jpg" || c.Visible {
		t.Fatalf("after edit, category = %+v, want slug den-de-ban count 1 + description/image + hidden", c)
	}

	// --- delete a fresh EMPTY category → 204, and it leaves the list ---
	emptyResp, err := srv.CreateAdminCategory(owner, api.CreateAdminCategoryRequestObject{Body: &api.CategoryInput{Slug: "trong", Name: "Trống"}})
	if err != nil {
		t.Fatalf("create empty: %v", err)
	}
	eid := emptyResp.(api.CreateAdminCategory201JSONResponse).Id
	if _, err := srv.DeleteAdminCategory(owner, api.DeleteAdminCategoryRequestObject{Id: eid}); err != nil {
		t.Fatalf("delete empty category: %v", err)
	}
	if c := findCategory(t, srv, owner, eid); c != nil {
		t.Fatalf("deleted category still listed: %+v", c)
	}

	// --- unknown id → 404 on both update and delete ---
	if _, err := srv.UpdateAdminCategory(owner, api.UpdateAdminCategoryRequestObject{Id: uuid.New(), Body: &api.CategoryUpdate{Slug: "x", Name: "x", Visible: true}}); !errors.Is(err, db.ErrNotFound) {
		t.Fatalf("update unknown id: err = %v, want ErrNotFound (404)", err)
	}
	if _, err := srv.DeleteAdminCategory(owner, api.DeleteAdminCategoryRequestObject{Id: uuid.New()}); !errors.Is(err, db.ErrNotFound) {
		t.Fatalf("delete unknown id: err = %v, want ErrNotFound (404)", err)
	}
}

// A category still referenced by a product cannot be hard-deleted: the DB raises a foreign_key_violation on
// products.category_id (NOT NULL, NO ACTION) that the handler turns into 409 CATEGORY_IN_USE, steering the
// owner to reassign/archive first. Proven with a real product row (the 23503→409 branch).
func TestDeleteCategoryInUseReturns409(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()
	owner := ownerCtx()
	srv := NewServer(slog.New(slog.NewTextHandler(io.Discard, nil)), pool, nil, nil)
	repo := db.NewCatalog(pool)

	cat, _ := repo.CreateCategory(ctx, sqlc.InsertCategoryParams{ID: uuid.New(), Slug: "cat-inuse", Name: "DM"})
	if _, err := repo.CreateProduct(ctx, sqlc.InsertProductParams{
		ID: uuid.New(), Slug: "den-inuse", Name: "Đèn", Description: "", CategoryID: cat.ID, BasePrice: 1,
		Dimensions: []byte(`{"w":1,"d":1,"h":1}`), Material: "PLA", Images: []byte(`[]`), Status: sqlc.ProductStatusActive,
	}); err != nil {
		t.Fatalf("seed product: %v", err)
	}

	if _, err := srv.DeleteAdminCategory(owner, api.DeleteAdminCategoryRequestObject{Id: cat.ID}); !errors.Is(err, errCategoryInUse) {
		t.Fatalf("delete category with products: err = %v, want errCategoryInUse (409)", err)
	}
	// The category survives a blocked delete (not partially applied).
	if c := findCategory(t, srv, owner, cat.ID); c == nil {
		t.Fatal("category should survive a blocked delete")
	}
}

// A slug collision is a per-field 400 on both create and rename (UNIQUE(slug)) — never a 500.
func TestCategorySlugConflictReturns400(t *testing.T) {
	pool := startPostgres(t)
	owner := ownerCtx()
	srv := NewServer(slog.New(slog.NewTextHandler(io.Discard, nil)), pool, nil, nil)

	if _, err := srv.CreateAdminCategory(owner, api.CreateAdminCategoryRequestObject{Body: &api.CategoryInput{Slug: "dup", Name: "A"}}); err != nil {
		t.Fatalf("create A: %v", err)
	}

	// Create a second category with the SAME slug → 400 response (not an error) carrying a slug field error.
	dupResp, err := srv.CreateAdminCategory(owner, api.CreateAdminCategoryRequestObject{Body: &api.CategoryInput{Slug: "dup", Name: "B"}})
	if err != nil {
		t.Fatalf("dup create should be a 400 response, not an error: %v", err)
	}
	bad, ok := dupResp.(api.CreateAdminCategory400JSONResponse)
	if !ok {
		t.Fatalf("dup create resp = %T, want 400", dupResp)
	}
	if bad.Fields == nil || (*bad.Fields)["slug"] == "" {
		t.Fatalf("dup create 400 missing slug field error: %+v", bad)
	}

	// A distinct category renamed ONTO the taken slug → 400 too.
	secondResp, err := srv.CreateAdminCategory(owner, api.CreateAdminCategoryRequestObject{Body: &api.CategoryInput{Slug: "other", Name: "C"}})
	if err != nil {
		t.Fatalf("create C: %v", err)
	}
	sid := secondResp.(api.CreateAdminCategory201JSONResponse).Id
	updResp, err := srv.UpdateAdminCategory(owner, api.UpdateAdminCategoryRequestObject{Id: sid, Body: &api.CategoryUpdate{Slug: "dup", Name: "C", Visible: true}})
	if err != nil {
		t.Fatalf("dup rename should be a 400 response, not an error: %v", err)
	}
	if _, ok := updResp.(api.UpdateAdminCategory400JSONResponse); !ok {
		t.Fatalf("dup rename resp = %T, want 400", updResp)
	}
}

// Reorder sets the menu order the storefront reads, and the visible toggle hides a category from the PUBLIC
// list while keeping it in the ADMIN list. Both are proven against real Postgres — the display_order UPDATE
// (menu order) and the ListCategories `visible AND EXISTS(active)` two-gate membership (slice o-2).
func TestCategoryReorderAndVisibility(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()
	owner := ownerCtx()
	srv := NewServer(slog.New(slog.NewTextHandler(io.Discard, nil)), pool, nil, nil)
	repo := db.NewCatalog(pool)

	// Three categories, each with an ACTIVE product so all are publicly browsable to start.
	ids := map[string]uuid.UUID{}
	for _, slug := range []string{"aa", "bb", "cc"} {
		resp, err := srv.CreateAdminCategory(owner, api.CreateAdminCategoryRequestObject{Body: &api.CategoryInput{Slug: slug, Name: slug}})
		if err != nil {
			t.Fatalf("create %s: %v", slug, err)
		}
		id := resp.(api.CreateAdminCategory201JSONResponse).Id
		ids[slug] = id
		if _, err := repo.CreateProduct(ctx, sqlc.InsertProductParams{
			ID: uuid.New(), Slug: "p-" + slug, Name: slug, Description: "", CategoryID: id, BasePrice: 1,
			Dimensions: []byte(`{"w":1,"d":1,"h":1}`), Material: "PLA", Images: []byte(`[]`), Status: sqlc.ProductStatusActive,
		}); err != nil {
			t.Fatalf("seed active product %s: %v", slug, err)
		}
	}

	// Reorder to cc, aa, bb → the public list returns our three in exactly that relative order (any
	// pre-seeded categories are filtered out by knownOrder).
	if _, err := srv.ReorderAdminCategories(owner, api.ReorderAdminCategoriesRequestObject{Body: &api.CategoryReorder{
		Ids: []uuid.UUID{ids["cc"], ids["aa"], ids["bb"]},
	}}); err != nil {
		t.Fatalf("reorder: %v", err)
	}
	if got := knownOrder(publicCategorySlugs(t, srv, ctx), "aa", "bb", "cc"); got != "cc,aa,bb" {
		t.Fatalf("after reorder, public order = %q, want cc,aa,bb", got)
	}

	// Hide bb → it drops from the PUBLIC list (even though it has an active product) but stays in the
	// ADMIN list with visible=false.
	if _, err := srv.UpdateAdminCategory(owner, api.UpdateAdminCategoryRequestObject{Id: ids["bb"], Body: &api.CategoryUpdate{
		Slug: "bb", Name: "bb", Visible: false,
	}}); err != nil {
		t.Fatalf("hide bb: %v", err)
	}
	if got := knownOrder(publicCategorySlugs(t, srv, ctx), "aa", "bb", "cc"); got != "cc,aa" {
		t.Fatalf("after hiding bb, public order = %q, want cc,aa (bb gone)", got)
	}
	if c := findCategory(t, srv, owner, ids["bb"]); c == nil || c.Visible {
		t.Fatalf("hidden bb should stay in the admin list with visible=false, got %+v", c)
	}
}

// publicCategorySlugs drives the storefront GetCategories and returns the visible category slugs in order.
func publicCategorySlugs(t *testing.T, srv *Server, ctx context.Context) []string {
	t.Helper()
	resp, err := srv.GetCategories(ctx, api.GetCategoriesRequestObject{})
	if err != nil {
		t.Fatalf("public categories: %v", err)
	}
	list, ok := resp.(api.GetCategories200JSONResponse)
	if !ok {
		t.Fatalf("public categories resp = %T, want 200", resp)
	}
	out := make([]string, len(list.Body))
	for i, c := range list.Body {
		out[i] = c.Slug
	}
	return out
}

// knownOrder keeps only the given slugs (dropping any pre-seeded ones) and joins them, so a test can assert
// the relative order of the categories it created regardless of what else the DB holds.
func knownOrder(slugs []string, known ...string) string {
	want := map[string]bool{}
	for _, k := range known {
		want[k] = true
	}
	var kept []string
	for _, s := range slugs {
		if want[s] {
			kept = append(kept, s)
		}
	}
	return strings.Join(kept, ",")
}
