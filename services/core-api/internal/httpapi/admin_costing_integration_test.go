package httpapi

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"

	"github.com/google/uuid"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db"
)

// TestMachinesCRUDEndToEnd exercises machine CRUD over real Postgres: create (with derived ₫/hour) → list →
// update (moves ₫/hour) → delete → unknown id → 404. The ₫/hour derivation is pinned Docker-free in
// TestMachineDTOCostPerHour; this proves the routes + persistence + derive-on-read wire together.
func TestMachinesCRUDEndToEnd(t *testing.T) {
	pool := startPostgres(t)
	ctx := ownerCtx()
	srv := NewServer(slog.New(slog.NewTextHandler(io.Discard, nil)), pool, nil, nil)

	cr, err := srv.CreateMachine(ctx, api.CreateMachineRequestObject{Body: &api.MachineInput{
		Name: "Máy #1", PurchasePriceVnd: 24_000_000, DepreciationMonths: 24, ExpectedHoursPerMonth: 100,
	}})
	if err != nil {
		t.Fatalf("create machine: %v", err)
	}
	m := api.Machine(cr.(api.CreateMachine201JSONResponse))
	if m.CostPerHour != 10_000 { // 24_000_000 / (24×100)
		t.Fatalf("created ₫/h = %v, want 10000", m.CostPerHour)
	}

	list := listMachines(t, srv, ctx)
	if len(list) != 1 || list[0].Id != m.Id {
		t.Fatalf("list = %+v, want the one created machine", list)
	}

	ur, err := srv.UpdateMachine(ctx, api.UpdateMachineRequestObject{Id: m.Id, Body: &api.MachineInput{
		Name: "Máy #1", PurchasePriceVnd: 24_000_000, DepreciationMonths: 12, ExpectedHoursPerMonth: 100,
	}})
	if err != nil {
		t.Fatalf("update machine: %v", err)
	}
	if u := api.Machine(ur.(api.UpdateMachine200JSONResponse)); u.CostPerHour != 20_000 { // now /(12×100)
		t.Fatalf("updated ₫/h = %v, want 20000", u.CostPerHour)
	}

	if _, err := srv.DeleteMachine(ctx, api.DeleteMachineRequestObject{Id: m.Id}); err != nil {
		t.Fatalf("delete machine: %v", err)
	}
	if list := listMachines(t, srv, ctx); len(list) != 0 {
		t.Fatalf("after delete, list = %+v, want empty", list)
	}
	if _, err := srv.UpdateMachine(ctx, api.UpdateMachineRequestObject{Id: uuid.New(), Body: &api.MachineInput{Name: "x", PurchasePriceVnd: 1, DepreciationMonths: 1, ExpectedHoursPerMonth: 1}}); !errors.Is(err, db.ErrNotFound) {
		t.Fatalf("update unknown → %v, want db.ErrNotFound", err)
	}
	if err := deleteMachineErr(srv, ctx, uuid.New()); !errors.Is(err, db.ErrNotFound) {
		t.Fatalf("delete unknown → %v, want db.ErrNotFound", err)
	}
}

// TestAuxCostsCRUDEndToEnd: create per_order + per_month → list (grouped) → update → delete → 404.
func TestAuxCostsCRUDEndToEnd(t *testing.T) {
	pool := startPostgres(t)
	ctx := ownerCtx()
	srv := NewServer(slog.New(slog.NewTextHandler(io.Discard, nil)), pool, nil, nil)

	per, err := srv.CreateAuxCost(ctx, api.CreateAuxCostRequestObject{Body: &api.AuxCostInput{Label: "Đóng gói", Kind: "per_order", AmountVnd: 5_000}})
	if err != nil {
		t.Fatalf("create aux per_order: %v", err)
	}
	perOrder := api.AuxCost(per.(api.CreateAuxCost201JSONResponse))
	if _, err := srv.CreateAuxCost(ctx, api.CreateAuxCostRequestObject{Body: &api.AuxCostInput{Label: "Điện", Kind: "per_month", AmountVnd: 500_000}}); err != nil {
		t.Fatalf("create aux per_month: %v", err)
	}

	list := listAuxCosts(t, srv, ctx)
	if len(list) != 2 {
		t.Fatalf("aux list len = %d, want 2", len(list))
	}

	ur, err := srv.UpdateAuxCost(ctx, api.UpdateAuxCostRequestObject{Id: perOrder.Id, Body: &api.AuxCostInput{Label: "Đóng gói + ship", Kind: "per_order", AmountVnd: 8_000}})
	if err != nil {
		t.Fatalf("update aux: %v", err)
	}
	if u := api.AuxCost(ur.(api.UpdateAuxCost200JSONResponse)); u.Label != "Đóng gói + ship" || u.AmountVnd != 8_000 {
		t.Fatalf("updated aux = %+v, want relabeled + ₫8000", u)
	}

	if _, err := srv.DeleteAuxCost(ctx, api.DeleteAuxCostRequestObject{Id: perOrder.Id}); err != nil {
		t.Fatalf("delete aux: %v", err)
	}
	if list := listAuxCosts(t, srv, ctx); len(list) != 1 {
		t.Fatalf("after delete, aux list len = %d, want 1", len(list))
	}
	if _, err := srv.UpdateAuxCost(ctx, api.UpdateAuxCostRequestObject{Id: uuid.New(), Body: &api.AuxCostInput{Label: "x", Kind: "per_order", AmountVnd: 1}}); !errors.Is(err, db.ErrNotFound) {
		t.Fatalf("update unknown aux → %v, want db.ErrNotFound", err)
	}
}

// TestScrapFilamentEndToEnd: a scrap draw moves stock through the SAME FIFO ledger as print (kind='scrap'),
// an unknown material → 404, and an over-scrap clamps to available stock (never errors).
func TestScrapFilamentEndToEnd(t *testing.T) {
	pool := startPostgres(t)
	ctx := ownerCtx()
	srv := NewServer(slog.New(slog.NewTextHandler(io.Discard, nil)), pool, nil, nil)

	mat := seedFilament(t, context.Background(), pool, "Cam", 200, 78_000) // 200g @ ₫390/g

	// Scrap 40g → stock 160, one consumption row kind=scrap, cost 40×₫390 = ₫15600.
	if _, err := srv.ScrapFilament(ctx, api.ScrapFilamentRequestObject{Id: mat, Body: &api.FilamentScrapInput{Qty: 40}}); err != nil {
		t.Fatalf("scrap 40: %v", err)
	}
	if got := materialStock(t, context.Background(), pool, mat); got != 160 {
		t.Fatalf("stock after scrap = %d, want 160", got)
	}
	rows := consumptionRows(t, context.Background(), pool, mat)
	if len(rows) != 1 || rows[0].kind != "scrap" || rows[0].qty != 40 || rows[0].costVnd != 15_600 {
		t.Fatalf("consumption after scrap = %+v, want one scrap row qty 40 / ₫15600", rows)
	}

	// Unknown material → 404 (a draw against no lots would otherwise no-op silently).
	if _, err := srv.ScrapFilament(ctx, api.ScrapFilamentRequestObject{Id: uuid.New(), Body: &api.FilamentScrapInput{Qty: 10}}); !errors.Is(err, db.ErrNotFound) {
		t.Fatalf("scrap unknown material → %v, want db.ErrNotFound", err)
	}

	// Over-scrap 500g when only 160 remain → clamps to 160, stock 0, no error.
	if _, err := srv.ScrapFilament(ctx, api.ScrapFilamentRequestObject{Id: mat, Body: &api.FilamentScrapInput{Qty: 500}}); err != nil {
		t.Fatalf("over-scrap must clamp not error: %v", err)
	}
	if got := materialStock(t, context.Background(), pool, mat); got != 0 {
		t.Fatalf("stock after over-scrap = %d, want 0 (clamped)", got)
	}
	if rows := consumptionRows(t, context.Background(), pool, mat); len(rows) != 2 || rows[1].qty != 160 {
		t.Fatalf("after over-scrap, rows = %+v, want a second scrap row qty 160 (the clamped actual)", rows)
	}
}

func listMachines(t *testing.T, srv *Server, ctx context.Context) []api.Machine {
	t.Helper()
	resp, err := srv.ListMachines(ctx, api.ListMachinesRequestObject{})
	if err != nil {
		t.Fatalf("ListMachines: %v", err)
	}
	return []api.Machine(resp.(api.ListMachines200JSONResponse))
}

func listAuxCosts(t *testing.T, srv *Server, ctx context.Context) []api.AuxCost {
	t.Helper()
	resp, err := srv.ListAuxCosts(ctx, api.ListAuxCostsRequestObject{})
	if err != nil {
		t.Fatalf("ListAuxCosts: %v", err)
	}
	return []api.AuxCost(resp.(api.ListAuxCosts200JSONResponse))
}

func deleteMachineErr(srv *Server, ctx context.Context, id uuid.UUID) error {
	_, err := srv.DeleteMachine(ctx, api.DeleteMachineRequestObject{Id: id})
	return err
}
