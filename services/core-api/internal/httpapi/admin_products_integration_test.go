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

// ADR-038: the owner saves a default camera pose via PATCH /admin/products/{id}/model-view; both the admin
// detail and the public storefront read return it (shared productDTO), a fresh product returns none (viewer
// auto-frames), an unknown id → 404, and an out-of-range value → 400 leaving the stored pose untouched. Real
// Postgres proves the jsonb round-trip through the DB, not just the in-memory DTO. Values are exact-in-binary
// (0.5, -0.25) so the readback compares equal without float drift.
func TestProductModelViewEndToEnd(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()
	owner := ownerCtx()
	srv := NewServer(slog.New(slog.NewTextHandler(io.Discard, nil)), pool, nil, nil)

	cat, err := db.NewCatalog(pool).CreateCategory(ctx, sqlc.InsertCategoryParams{ID: uuid.New(), Slug: "cat-view", Name: "Danh mục"})
	if err != nil {
		t.Fatalf("seed category: %v", err)
	}
	createResp, err := srv.CreateAdminProduct(owner, api.CreateAdminProductRequestObject{Body: &api.ProductInput{
		Slug: "den-view", Name: "Đèn View", CategoryId: cat.ID, BasePrice: 100_000,
		Dimensions: api.Dimensions{W: 100, D: 100, H: 200}, Material: "PLA", Status: api.ProductStatus("active"),
	}})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	pid := createResp.(api.CreateAdminProduct201JSONResponse).Id

	getDetail := func() api.Product {
		t.Helper()
		r, err := srv.GetAdminProduct(owner, api.GetAdminProductRequestObject{Id: pid})
		if err != nil {
			t.Fatalf("get detail: %v", err)
		}
		return api.Product(r.(api.GetAdminProduct200JSONResponse))
	}

	// A fresh product has NO saved pose → model3dView absent (the viewer auto-frames).
	if v := getDetail().Model3dView; v != nil {
		t.Fatalf("fresh product model3dView = %+v, want nil (auto-frame)", v)
	}

	// Save a pose → 204.
	want := api.Model3dView{OrbitTheta: 30, OrbitPhi: 75, OrbitRadius: 105, TargetX: 0, TargetY: 0.5, TargetZ: -0.25}
	saveResp, err := srv.UpdateProductModelView(owner, api.UpdateProductModelViewRequestObject{Id: pid, Body: &want})
	if err != nil {
		t.Fatalf("save pose: %v", err)
	}
	if _, ok := saveResp.(api.UpdateProductModelView204Response); !ok {
		t.Fatalf("save resp = %T, want 204", saveResp)
	}

	// Admin detail returns the pose, read back through the DB jsonb.
	if v := getDetail().Model3dView; v == nil || *v != want {
		t.Fatalf("admin model3dView = %+v, want %+v", v, want)
	}

	// The public storefront read (active product) carries the same pose via the shared productDTO.
	pubResp, err := srv.GetProductBySlug(ctx, api.GetProductBySlugRequestObject{Slug: "den-view"})
	if err != nil {
		t.Fatalf("public get: %v", err)
	}
	if v := api.Product(pubResp.(api.GetProductBySlug200JSONResponse)).Model3dView; v == nil || *v != want {
		t.Fatalf("public model3dView = %+v, want %+v", v, want)
	}

	// Unknown id → 404.
	if _, err := srv.UpdateProductModelView(owner, api.UpdateProductModelViewRequestObject{Id: uuid.New(), Body: &want}); !errors.Is(err, db.ErrNotFound) {
		t.Fatalf("unknown id: err = %v, want ErrNotFound", err)
	}

	// Out-of-range (phi 200) → 400 response (not an error), and the stored pose is unchanged.
	badResp, err := srv.UpdateProductModelView(owner, api.UpdateProductModelViewRequestObject{Id: pid, Body: &api.Model3dView{OrbitTheta: 0, OrbitPhi: 200, OrbitRadius: 100}})
	if err != nil {
		t.Fatalf("out-of-range should be a 400 response, not an error: %v", err)
	}
	if _, ok := badResp.(api.UpdateProductModelView400JSONResponse); !ok {
		t.Fatalf("out-of-range resp = %T, want 400", badResp)
	}
	if v := getDetail().Model3dView; v == nil || *v != want {
		t.Fatalf("after rejected save, model3dView = %+v, want unchanged %+v", v, want)
	}
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
	mat := seedFilament(t, ctx, pool, "Kem", 100, 39_000) // f-1: a colour's name/hex come from its filament
	colResp, err := srv.CreateProductColor(owner, api.CreateProductColorRequestObject{Id: pid, Body: &api.ColorInput{Available: true, FilamentMaterialId: mat}})
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
	mat := seedFilament(t, ctx, pool, "Kem", 100, 39_000) // f-1: a colour's name/hex come from its filament
	colResp, err := srv.CreateProductColor(owner, api.CreateProductColorRequestObject{Id: prodA, Body: &api.ColorInput{Available: true, FilamentMaterialId: mat}})
	if err != nil {
		t.Fatalf("create color on A: %v", err)
	}
	colA := api.Color(colResp.(api.CreateProductColor201JSONResponse))

	// Editing colour-A through product B's path → 404 (scoped by product_id, so no row matches).
	if _, err := srv.UpdateProductColor(owner, api.UpdateProductColorRequestObject{Id: prodB, ColorId: colA.Id, Body: &api.ColorInput{Available: false, FilamentMaterialId: mat}}); !errors.Is(err, db.ErrNotFound) {
		t.Fatalf("cross-product color update: err = %v, want ErrNotFound (404)", err)
	}
	if _, err := srv.DeleteProductColor(owner, api.DeleteProductColorRequestObject{Id: prodB, ColorId: colA.Id}); !errors.Is(err, db.ErrNotFound) {
		t.Fatalf("cross-product color delete: err = %v, want ErrNotFound (404)", err)
	}

	// Creating a colour under a non-existent product → 404 (FK violation mapped, not 500).
	if _, err := srv.CreateProductColor(owner, api.CreateProductColorRequestObject{Id: uuid.New(), Body: &api.ColorInput{Available: true, FilamentMaterialId: mat}}); !errors.Is(err, db.ErrNotFound) {
		t.Fatalf("color on unknown product: err = %v, want ErrNotFound (404)", err)
	}
}

// f-1 (ADR-039 amendment): a colour's name + hex are SOURCED from its filament (copy-on-write), not typed.
// Creating a colour stamps the filament's name+hex onto the row; a later filament rename does NOT cascade —
// which is precisely what keeps a sold order's frozen part_colors snapshot immutable. A missing or hex-less
// filament is rejected (400), so a colour can never ship with an empty swatch.
func TestColorSwatchSourcedFromFilament(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()
	owner := ownerCtx()
	srv := NewServer(slog.New(slog.NewTextHandler(io.Discard, nil)), pool, nil, nil)
	repo := db.NewCatalog(pool)

	cat, _ := repo.CreateCategory(ctx, sqlc.InsertCategoryParams{ID: uuid.New(), Slug: "cat-f1", Name: "DM"})
	prod, err := repo.CreateProduct(ctx, sqlc.InsertProductParams{
		ID: uuid.New(), Slug: "den-f1", Name: "Đèn", Description: "", CategoryID: cat.ID, BasePrice: 1,
		Dimensions: []byte(`{"w":1,"d":1,"h":1}`), Material: "PLA", Images: []byte(`[]`), Status: sqlc.ProductStatusDraft,
	})
	if err != nil {
		t.Fatalf("seed product: %v", err)
	}
	mat := seedFilament(t, ctx, pool, "Cam Lumin", 100, 39_000) // seedFilament stamps hex #888888

	// create → the colour takes the filament's name + hex.
	resp, err := srv.CreateProductColor(owner, api.CreateProductColorRequestObject{Id: prod.ID, Body: &api.ColorInput{Available: true, FilamentMaterialId: mat}})
	if err != nil {
		t.Fatalf("create colour: %v", err)
	}
	col := api.Color(resp.(api.CreateProductColor201JSONResponse))
	if col.Name != "Cam Lumin" || col.Hex != "#888888" {
		t.Fatalf("colour swatch = %q/%q, want the filament's Cam Lumin/#888888", col.Name, col.Hex)
	}

	// renaming/re-hexing the filament does NOT cascade to an existing colour (copy-on-write) — the mechanism
	// that keeps a sold order's frozen snapshot immutable.
	if _, err := pool.Exec(ctx, `UPDATE filament_materials SET name = 'Đỏ', hex = '#FF0000' WHERE id = $1`, mat); err != nil {
		t.Fatalf("rename filament: %v", err)
	}
	detResp, err := srv.GetAdminProduct(owner, api.GetAdminProductRequestObject{Id: prod.ID})
	if err != nil {
		t.Fatalf("get detail: %v", err)
	}
	det := api.Product(detResp.(api.GetAdminProduct200JSONResponse))
	if len(det.Colors) != 1 || det.Colors[0].Name != "Cam Lumin" || det.Colors[0].Hex != "#888888" {
		t.Fatalf("after filament rename, colour = %+v, want the frozen Cam Lumin/#888888", det.Colors)
	}

	// a filamentMaterialId matching no filament → 400 field filamentMaterialId (not 500/404).
	if r, err := srv.CreateProductColor(owner, api.CreateProductColorRequestObject{Id: prod.ID, Body: &api.ColorInput{Available: true, FilamentMaterialId: uuid.New()}}); err != nil {
		t.Fatalf("unknown filament: unexpected err %v", err)
	} else if _, ok := r.(api.CreateProductColor400JSONResponse); !ok {
		t.Fatalf("unknown filament resp = %T, want 400", r)
	}

	// a filament with NO hex ("no colour chip", 000018) cannot be a colour's swatch source → 400.
	hexless := uuid.New()
	if _, err := pool.Exec(ctx, `INSERT INTO filament_materials (id, name, material, unit) VALUES ($1,'Không mã','PLA','gram')`, hexless); err != nil {
		t.Fatalf("seed hexless filament: %v", err)
	}
	if r, err := srv.CreateProductColor(owner, api.CreateProductColorRequestObject{Id: prod.ID, Body: &api.ColorInput{Available: true, FilamentMaterialId: hexless}}); err != nil {
		t.Fatalf("hexless filament: unexpected err %v", err)
	} else if _, ok := r.(api.CreateProductColor400JSONResponse); !ok {
		t.Fatalf("hexless filament resp = %T, want 400", r)
	}
}
