package httpapi

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/order"
)

// Integration tests for the admin catalog write surface (P3-j-a) against real Postgres (testcontainers:
// skip local without Docker, run in CI — ADR-020). They drive the handlers with an OWNER actor context
// (the owner-only boundary itself is proven Docker-free in TestAdminProductWritesAreOwnerOnly) to exercise
// the full DB round-trip: create → read → update → list → nested color/option → delete, plus the two
// branches that only real FKs can prove — model3d_url preservation, the RESTRICT→409 delete, and the
// (product, child) scoping.

func ownerCtx() context.Context {
	return withActor(context.Background(), Actor{ByUser: uuid.NewString(), Role: order.RoleOwner, At: time.Now().UTC()})
}

func TestAdminProductCRUDEndToEnd(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()
	owner := ownerCtx()
	srv := NewServer(slog.New(slog.NewTextHandler(io.Discard, nil)), pool, nil, nil)

	cat, err := db.NewCatalog(pool).CreateCategory(ctx, sqlc.InsertCategoryParams{ID: uuid.New(), Slug: "cat-crud", Name: "Danh mục"})
	if err != nil {
		t.Fatalf("seed category: %v", err)
	}

	// --- create (born draft, no model, no colors/options) ---
	desc, imgs := "đèn ấm", []string{"https://x/1.jpg"}
	createResp, err := srv.CreateAdminProduct(owner, api.CreateAdminProductRequestObject{Body: &api.ProductInput{
		Slug: "den-crud", Name: "Đèn CRUD", Description: &desc, CategoryId: cat.ID, BasePrice: 250_000,
		Dimensions: api.Dimensions{W: 100, D: 100, H: 200}, Material: "PETG", Images: &imgs, Status: api.ProductStatus("draft"),
	}})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	created, ok := createResp.(api.CreateAdminProduct201JSONResponse)
	if !ok {
		t.Fatalf("create resp = %T, want 201", createResp)
	}
	pid := created.Id
	if created.Model3dUrl != "" || len(created.Colors) != 0 || len(created.Options) != 0 {
		t.Fatalf("new product: model3dUrl=%q colors=%d options=%d, want empty/0/0", created.Model3dUrl, len(created.Colors), len(created.Options))
	}

	// --- the asset pipeline (not the editor) sets model3d_url; UpdateProduct must never blank it ---
	if _, err := pool.Exec(ctx, `UPDATE products SET model3d_url=$1 WHERE id=$2`, "https://cdn/m.glb", pid); err != nil {
		t.Fatalf("stamp model3d_url: %v", err)
	}

	// --- update (rename + activate); the body carries NO model3dUrl ---
	updResp, err := srv.UpdateAdminProduct(owner, api.UpdateAdminProductRequestObject{Id: pid, Body: &api.ProductInput{
		Slug: "den-crud", Name: "Đèn CRUD v2", CategoryId: cat.ID, BasePrice: 260_000,
		Dimensions: api.Dimensions{W: 100, D: 100, H: 200}, Material: "PETG", Status: api.ProductStatus("active"),
	}})
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	upd, ok := updResp.(api.UpdateAdminProduct200JSONResponse)
	if !ok {
		t.Fatalf("update resp = %T, want 200", updResp)
	}
	if upd.Name != "Đèn CRUD v2" || upd.BasePrice != 260_000 || upd.Status != "active" {
		t.Fatalf("updated = name %q base %d status %q", upd.Name, upd.BasePrice, upd.Status)
	}
	if upd.Model3dUrl != "https://cdn/m.glb" {
		t.Fatalf("UpdateProduct blanked model3d_url = %q — the editor must never touch it (P3-j-b owns it)", upd.Model3dUrl)
	}

	// --- nested color + option ---
	colResp, err := srv.CreateProductColor(owner, api.CreateProductColorRequestObject{Id: pid, Body: &api.ColorInput{Name: "Kem", Hex: "#C9A24B", Available: true}})
	if err != nil {
		t.Fatalf("create color: %v", err)
	}
	col := api.Color(colResp.(api.CreateProductColor201JSONResponse))
	mc := 20
	if _, err := srv.CreateProductOption(owner, api.CreateProductOptionRequestObject{Id: pid, Body: &api.OptionInput{Label: "Khắc tên", Type: api.OptionType("text"), MaxChars: &mc}}); err != nil {
		t.Fatalf("create option: %v", err)
	}

	// --- detail now assembles the product with its 1 color + 1 option ---
	detResp, err := srv.GetAdminProduct(owner, api.GetAdminProductRequestObject{Id: pid})
	if err != nil {
		t.Fatalf("get detail: %v", err)
	}
	det := api.Product(detResp.(api.GetAdminProduct200JSONResponse))
	if len(det.Colors) != 1 || len(det.Options) != 1 || det.Options[0].MaxChars == nil || *det.Options[0].MaxChars != 20 {
		t.Fatalf("detail colors=%d options=%d, want 1/1 with maxChars 20", len(det.Colors), len(det.Options))
	}

	// --- list: status=active includes it; status=draft excludes it (it was activated) ---
	active := api.ProductStatus("active")
	draft := api.ProductStatus("draft")
	if !listHasProduct(t, srv, owner, &active, pid) {
		t.Fatal("status=active list should include the activated product")
	}
	if listHasProduct(t, srv, owner, &draft, pid) {
		t.Fatal("status=draft list should NOT include the activated product")
	}

	// --- delete the color, then the product (never-ordered → hard delete cascades the option) ---
	if _, err := srv.DeleteProductColor(owner, api.DeleteProductColorRequestObject{Id: pid, ColorId: col.Id}); err != nil {
		t.Fatalf("delete color: %v", err)
	}
	if _, err := srv.DeleteAdminProduct(owner, api.DeleteAdminProductRequestObject{Id: pid}); err != nil {
		t.Fatalf("delete product: %v", err)
	}
	if _, err := srv.GetAdminProduct(owner, api.GetAdminProductRequestObject{Id: pid}); !errors.Is(err, db.ErrNotFound) {
		t.Fatalf("get deleted product: err = %v, want ErrNotFound (404)", err)
	}
}

// listHasProduct drives GetAdminProducts with a status filter and reports whether pid is in the page.
func listHasProduct(t *testing.T, srv *Server, ctx context.Context, status *api.ProductStatus, pid uuid.UUID) bool {
	t.Helper()
	resp, err := srv.GetAdminProducts(ctx, api.GetAdminProductsRequestObject{Params: api.GetAdminProductsParams{Status: status}})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	for _, p := range api.GetAdminProducts200JSONResponse(resp.(api.GetAdminProducts200JSONResponse)) {
		if p.Id == pid {
			return true
		}
	}
	return false
}

// A product referenced by an asset job (one of the two ON DELETE RESTRICT FKs — order_items is the other)
// cannot be hard-deleted: the DB raises a foreign_key_violation the handler turns into 409 PRODUCT_IN_USE,
// steering the owner to archive instead. Seeded via a raw asset_jobs insert (leaner than the full order
// machinery; exercises the identical 23503→409 branch).
func TestDeleteProductInUseReturns409(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()
	owner := ownerCtx()
	srv := NewServer(slog.New(slog.NewTextHandler(io.Discard, nil)), pool, nil, nil)

	cat, _ := db.NewCatalog(pool).CreateCategory(ctx, sqlc.InsertCategoryParams{ID: uuid.New(), Slug: "cat-inuse", Name: "DM"})
	prod, err := db.NewCatalog(pool).CreateProduct(ctx, sqlc.InsertProductParams{
		ID: uuid.New(), Slug: "den-inuse", Name: "Đèn", Description: "", CategoryID: cat.ID, BasePrice: 100_000,
		Dimensions: []byte(`{"w":1,"d":1,"h":1}`), Material: "PLA", Images: []byte(`[]`), Status: sqlc.ProductStatusActive,
	})
	if err != nil {
		t.Fatalf("seed product: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO asset_jobs (id, product_id, job_type, source_model_url, source_version) VALUES ($1,$2,'model_ingest','https://x/m.glb','v1')`,
		uuid.New(), prod.ID); err != nil {
		t.Fatalf("seed asset job: %v", err)
	}

	if _, err := srv.DeleteAdminProduct(owner, api.DeleteAdminProductRequestObject{Id: prod.ID}); !errors.Is(err, errProductInUse) {
		t.Fatalf("delete product with history: err = %v, want errProductInUse (409)", err)
	}
	// The product is still there (delete was blocked, not partially applied).
	if _, err := db.NewCatalog(pool).ProductByID(ctx, prod.ID); err != nil {
		t.Fatalf("product should survive a blocked delete: %v", err)
	}
}

// Color/option mutations are scoped by (product, child): a childId under another product must not be
// editable or deletable through the wrong product's path — it is a 404, never a cross-product edit.
func TestProductColorOptionScopedByProduct(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()
	owner := ownerCtx()
	srv := NewServer(slog.New(slog.NewTextHandler(io.Discard, nil)), pool, nil, nil)
	repo := db.NewCatalog(pool)

	cat, _ := repo.CreateCategory(ctx, sqlc.InsertCategoryParams{ID: uuid.New(), Slug: "cat-scope", Name: "DM"})
	mk := func(slug string) uuid.UUID {
		p, err := repo.CreateProduct(ctx, sqlc.InsertProductParams{
			ID: uuid.New(), Slug: slug, Name: slug, Description: "", CategoryID: cat.ID, BasePrice: 1,
			Dimensions: []byte(`{"w":1,"d":1,"h":1}`), Material: "PLA", Images: []byte(`[]`), Status: sqlc.ProductStatusDraft,
		})
		if err != nil {
			t.Fatalf("seed %s: %v", slug, err)
		}
		return p.ID
	}
	prodA, prodB := mk("prod-a"), mk("prod-b")

	// A colour that belongs to product A.
	colResp, err := srv.CreateProductColor(owner, api.CreateProductColorRequestObject{Id: prodA, Body: &api.ColorInput{Name: "Kem", Hex: "#fff", Available: true}})
	if err != nil {
		t.Fatalf("create color on A: %v", err)
	}
	colA := api.Color(colResp.(api.CreateProductColor201JSONResponse))

	// Editing colour-A through product B's path → 404 (scoped by product_id, so no row matches).
	if _, err := srv.UpdateProductColor(owner, api.UpdateProductColorRequestObject{Id: prodB, ColorId: colA.Id, Body: &api.ColorInput{Name: "Hack", Hex: "#000", Available: false}}); !errors.Is(err, db.ErrNotFound) {
		t.Fatalf("cross-product color update: err = %v, want ErrNotFound (404)", err)
	}
	if _, err := srv.DeleteProductColor(owner, api.DeleteProductColorRequestObject{Id: prodB, ColorId: colA.Id}); !errors.Is(err, db.ErrNotFound) {
		t.Fatalf("cross-product color delete: err = %v, want ErrNotFound (404)", err)
	}

	// Creating a colour under a non-existent product → 404 (FK violation mapped, not 500).
	if _, err := srv.CreateProductColor(owner, api.CreateProductColorRequestObject{Id: uuid.New(), Body: &api.ColorInput{Name: "x", Hex: "#fff", Available: true}}); !errors.Is(err, db.ErrNotFound) {
		t.Fatalf("color on unknown product: err = %v, want ErrNotFound (404)", err)
	}
}
