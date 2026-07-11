package httpapi

import (
	"errors"
	"io"
	"log/slog"
	"math"
	"testing"

	"github.com/google/uuid"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db"
)

// TestFilamentInventoryEndToEnd drives the Vật tư filament surface (ADR-039 slice 4a) against real Postgres
// (testcontainers: skips local without Docker, runs in CI — ADR-020) with an OWNER actor. It proves the
// full round-trip the in-memory tests can't: a fresh material reads stock 0 / avg 0, imports move the
// DERIVED weighted-average (the design's (180×390 + 1000×416) ÷ 1180 = ₫412/g), an edit preserves stock,
// archived hides from the default list, and unknown ids → ErrNotFound on every by-id path.
func TestFilamentInventoryEndToEnd(t *testing.T) {
	pool := startPostgres(t)
	owner := ownerCtx()
	srv := NewServer(slog.New(slog.NewTextHandler(io.Discard, nil)), pool, nil, nil)

	// Create — a fresh material has no batches → stock 0, avg 0.
	createResp, err := srv.CreateFilamentMaterial(owner, api.CreateFilamentMaterialRequestObject{Body: &api.FilamentMaterialInput{
		Name: "Cam Lumin", Material: "PLA", Unit: "gram", Hex: strptr("#FF6B4A"), LowStockThreshold: 500,
	}})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	mat := api.FilamentMaterial(createResp.(api.CreateFilamentMaterial201JSONResponse))
	if mat.StockQty != 0 || mat.AvgCostPerUnit != 0 {
		t.Fatalf("fresh material: stock=%d avg=%v, want 0/0", mat.StockQty, mat.AvgCostPerUnit)
	}

	// Get detail — no batches yet.
	getResp, err := srv.GetFilamentMaterial(owner, api.GetFilamentMaterialRequestObject{Id: mat.Id})
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if d := api.FilamentMaterialDetail(getResp.(api.GetFilamentMaterial200JSONResponse)); len(d.Batches) != 0 {
		t.Fatalf("fresh detail: want 0 batches, got %d", len(d.Batches))
	}

	// Import lot 1: 180g @ ₫390/g (₫70,200). avg = 390 exactly.
	imp1, err := srv.ImportFilament(owner, api.ImportFilamentRequestObject{Id: mat.Id, Body: &api.FilamentImportInput{
		SpoolCount: 1, QtyPerSpool: 180, PricePerSpoolVnd: 70200,
	}})
	if err != nil {
		t.Fatalf("import1: %v", err)
	}
	d1 := api.FilamentMaterialDetail(imp1.(api.ImportFilament200JSONResponse))
	if d1.Material.StockQty != 180 || math.Abs(d1.Material.AvgCostPerUnit-390) > 0.001 || len(d1.Batches) != 1 {
		t.Fatalf("after import1: stock=%d avg=%v batches=%d, want 180/390/1", d1.Material.StockQty, d1.Material.AvgCostPerUnit, len(d1.Batches))
	}

	// Import lot 2: 1000g @ ₫416/g (₫416,000). Weighted avg = (180×390 + 1000×416) ÷ 1180 = ₫412.034/g.
	imp2, err := srv.ImportFilament(owner, api.ImportFilamentRequestObject{Id: mat.Id, Body: &api.FilamentImportInput{
		SpoolCount: 1, QtyPerSpool: 1000, PricePerSpoolVnd: 416000,
	}})
	if err != nil {
		t.Fatalf("import2: %v", err)
	}
	d2 := api.FilamentMaterialDetail(imp2.(api.ImportFilament200JSONResponse))
	if d2.Material.StockQty != 1180 {
		t.Fatalf("after import2: stock=%d, want 1180", d2.Material.StockQty)
	}
	if want := 486200.0 / 1180.0; math.Abs(d2.Material.AvgCostPerUnit-want) > 0.01 {
		t.Fatalf("weighted avg = %v, want %v", d2.Material.AvgCostPerUnit, want)
	}
	if len(d2.Batches) != 2 || d2.Batches[0].QtyOriginal+d2.Batches[1].QtyOriginal != 1180 {
		t.Fatalf("after import2: want 2 batches summing 1180, got %d", len(d2.Batches))
	}

	// List (active only) — the material shows with derived stock.
	listResp, err := srv.ListFilamentMaterials(owner, api.ListFilamentMaterialsRequestObject{})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if got := findMaterial(api.ListFilamentMaterials200JSONResponse(listResp.(api.ListFilamentMaterials200JSONResponse)), mat.Id); got == nil || got.StockQty != 1180 {
		t.Fatalf("list: material missing or wrong stock: %+v", got)
	}

	// Edit — a rename must not disturb the derived stock (the plain UPDATE can't aggregate batches, so the
	// handler re-reads).
	updResp, err := srv.UpdateFilamentMaterial(owner, api.UpdateFilamentMaterialRequestObject{Id: mat.Id, Body: &api.FilamentMaterialInput{
		Name: "Cam Lumin đậm", Material: "PLA", Unit: "gram", LowStockThreshold: 400,
	}})
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if u := api.FilamentMaterial(updResp.(api.UpdateFilamentMaterial200JSONResponse)); u.Name != "Cam Lumin đậm" || u.StockQty != 1180 || u.LowStockThreshold != 400 {
		t.Fatalf("after edit: %+v, want name changed + stock 1180 + threshold 400", u)
	}

	// Archive a second material → hidden from the default list, shown with includeArchived.
	m2Resp, err := srv.CreateFilamentMaterial(owner, api.CreateFilamentMaterialRequestObject{Body: &api.FilamentMaterialInput{Name: "Đen nhám", Material: "PLA", Unit: "gram"}})
	if err != nil {
		t.Fatalf("create m2: %v", err)
	}
	m2 := api.FilamentMaterial(m2Resp.(api.CreateFilamentMaterial201JSONResponse))
	if _, err := srv.UpdateFilamentMaterial(owner, api.UpdateFilamentMaterialRequestObject{Id: m2.Id, Body: &api.FilamentMaterialInput{
		Name: "Đen nhám", Material: "PLA", Unit: "gram", Archived: boolptr(true),
	}}); err != nil {
		t.Fatalf("archive m2: %v", err)
	}
	def, _ := srv.ListFilamentMaterials(owner, api.ListFilamentMaterialsRequestObject{})
	if findMaterial(api.ListFilamentMaterials200JSONResponse(def.(api.ListFilamentMaterials200JSONResponse)), m2.Id) != nil {
		t.Fatal("archived material must be hidden from the default list")
	}
	all, _ := srv.ListFilamentMaterials(owner, api.ListFilamentMaterialsRequestObject{Params: api.ListFilamentMaterialsParams{IncludeArchived: boolptr(true)}})
	if findMaterial(api.ListFilamentMaterials200JSONResponse(all.(api.ListFilamentMaterials200JSONResponse)), m2.Id) == nil {
		t.Fatal("includeArchived must surface the archived material")
	}

	// Unknown id → 404 on every by-id path.
	unknown := uuid.New()
	if _, err := srv.GetFilamentMaterial(owner, api.GetFilamentMaterialRequestObject{Id: unknown}); !errors.Is(err, db.ErrNotFound) {
		t.Fatalf("get unknown: err = %v, want ErrNotFound", err)
	}
	if _, err := srv.UpdateFilamentMaterial(owner, api.UpdateFilamentMaterialRequestObject{Id: unknown, Body: &api.FilamentMaterialInput{Name: "x", Material: "PLA", Unit: "gram"}}); !errors.Is(err, db.ErrNotFound) {
		t.Fatalf("update unknown: err = %v, want ErrNotFound", err)
	}
	if _, err := srv.ImportFilament(owner, api.ImportFilamentRequestObject{Id: unknown, Body: &api.FilamentImportInput{SpoolCount: 1, QtyPerSpool: 1, PricePerSpoolVnd: 0}}); !errors.Is(err, db.ErrNotFound) {
		t.Fatalf("import unknown: err = %v, want ErrNotFound", err)
	}
}

func boolptr(b bool) *bool { return &b }

func findMaterial(list []api.FilamentMaterial, id uuid.UUID) *api.FilamentMaterial {
	for i := range list {
		if list[i].Id == id {
			return &list[i]
		}
	}
	return nil
}
