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
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/order"
)

func TestCleanMachineInput(t *testing.T) {
	valid := api.MachineInput{Name: " Máy #1 ", PurchasePriceVnd: 24_000_000, DepreciationMonths: 24, ExpectedHoursPerMonth: 100}
	c, fields := cleanMachineInput(valid)
	if len(fields) != 0 || c.Name != "Máy #1" || c.PurchasePriceVnd != 24_000_000 || c.DepreciationMonths != 24 || c.ExpectedHoursPerMonth != 100 {
		t.Fatalf("valid machine: %+v fields=%v", c, fields)
	}
	if c.IsPrimary || !c.Active { // isPrimary defaults false, active defaults true
		t.Fatalf("defaults wrong: isPrimary=%v active=%v, want false/true", c.IsPrimary, c.Active)
	}
	prim, act := true, false
	c2, _ := cleanMachineInput(api.MachineInput{Name: "x", PurchasePriceVnd: 0, DepreciationMonths: 1, ExpectedHoursPerMonth: 1, IsPrimary: &prim, Active: &act})
	if !c2.IsPrimary || c2.Active {
		t.Fatalf("explicit flags: isPrimary=%v active=%v, want true/false", c2.IsPrimary, c2.Active)
	}
	bad := map[string]api.MachineInput{
		"name":                  {Name: "  ", PurchasePriceVnd: 1, DepreciationMonths: 1, ExpectedHoursPerMonth: 1},
		"purchasePriceVnd":      {Name: "x", PurchasePriceVnd: -1, DepreciationMonths: 1, ExpectedHoursPerMonth: 1},
		"depreciationMonths":    {Name: "x", PurchasePriceVnd: 1, DepreciationMonths: 0, ExpectedHoursPerMonth: 1},
		"expectedHoursPerMonth": {Name: "x", PurchasePriceVnd: 1, DepreciationMonths: 1, ExpectedHoursPerMonth: 0},
	}
	for field, in := range bad {
		if _, f := cleanMachineInput(in); f[field] == "" {
			t.Fatalf("expected field error %q for %+v, got %v", field, in, f)
		}
	}
}

func TestCleanAuxCostInput(t *testing.T) {
	c, fields := cleanAuxCostInput(api.AuxCostInput{Label: " Điện ", Kind: "per_month", AmountVnd: 500_000})
	if len(fields) != 0 || c.Label != "Điện" || c.Kind != "per_month" || c.AmountVnd != 500_000 {
		t.Fatalf("valid aux: %+v fields=%v", c, fields)
	}
	bad := map[string]api.AuxCostInput{
		"label":     {Label: " ", Kind: "per_order", AmountVnd: 1},
		"kind":      {Label: "x", Kind: "weekly", AmountVnd: 1},
		"amountVnd": {Label: "x", Kind: "per_order", AmountVnd: -1},
	}
	for field, in := range bad {
		if _, f := cleanAuxCostInput(in); f[field] == "" {
			t.Fatalf("expected field error %q for %+v, got %v", field, in, f)
		}
	}
}

func TestCleanScrapInput(t *testing.T) {
	reason := " lỗi layer "
	qty, r, _, fields := cleanScrapInput(api.FilamentScrapInput{Qty: 40, Reason: &reason})
	if len(fields) != 0 || qty != 40 || r != "lỗi layer" {
		t.Fatalf("valid scrap: qty=%d reason=%q fields=%v", qty, r, fields)
	}
	for _, q := range []int64{0, -5, maxScrapQty + 1} {
		if _, _, _, f := cleanScrapInput(api.FilamentScrapInput{Qty: q}); f["qty"] == "" {
			t.Fatalf("qty %d should be a field error, got %v", q, f)
		}
	}
}

// machineDTO derives ₫/hour = purchasePriceVnd / (depreciationMonths × expectedHoursPerMonth).
func TestMachineDTOCostPerHour(t *testing.T) {
	m := sqlc.Machine{ID: uuid.New(), Name: "Máy #1", PurchasePriceVnd: 24_000_000, DepreciationMonths: 24, ExpectedHoursPerMonth: 100, IsPrimary: true, Active: true}
	got := machineDTO(m)
	if got.CostPerHour != 10_000 { // 24_000_000 / (24 × 100) = 10_000 ₫/h
		t.Fatalf("costPerHour = %v, want 10000", got.CostPerHour)
	}
	if got.DepreciationMonths != 24 || got.ExpectedHoursPerMonth != 100 || !got.IsPrimary || !got.Active {
		t.Fatalf("machineDTO passthrough wrong: %+v", got)
	}
}

// Every costing mutation is owner-only: staff → errForbidden, no actor → errUnauthenticated, BEFORE any DB
// touch (nil pool proves assertOwner runs first).
func TestCostingWritesAreOwnerOnly(t *testing.T) {
	srv := NewServer(slog.New(slog.NewTextHandler(io.Discard, nil)), nil, nil, nil)
	id := uuid.New()
	mach := api.MachineInput{Name: "x", PurchasePriceVnd: 1, DepreciationMonths: 1, ExpectedHoursPerMonth: 1}
	aux := api.AuxCostInput{Label: "x", Kind: "per_order", AmountVnd: 1}
	scrap := api.FilamentScrapInput{Qty: 1}

	calls := map[string]func(context.Context) error{
		"CreateMachine": func(ctx context.Context) error {
			_, err := srv.CreateMachine(ctx, api.CreateMachineRequestObject{Body: &mach})
			return err
		},
		"UpdateMachine": func(ctx context.Context) error {
			_, err := srv.UpdateMachine(ctx, api.UpdateMachineRequestObject{Id: id, Body: &mach})
			return err
		},
		"DeleteMachine": func(ctx context.Context) error {
			_, err := srv.DeleteMachine(ctx, api.DeleteMachineRequestObject{Id: id})
			return err
		},
		"CreateAuxCost": func(ctx context.Context) error {
			_, err := srv.CreateAuxCost(ctx, api.CreateAuxCostRequestObject{Body: &aux})
			return err
		},
		"UpdateAuxCost": func(ctx context.Context) error {
			_, err := srv.UpdateAuxCost(ctx, api.UpdateAuxCostRequestObject{Id: id, Body: &aux})
			return err
		},
		"DeleteAuxCost": func(ctx context.Context) error {
			_, err := srv.DeleteAuxCost(ctx, api.DeleteAuxCostRequestObject{Id: id})
			return err
		},
		"ScrapFilament": func(ctx context.Context) error {
			_, err := srv.ScrapFilament(ctx, api.ScrapFilamentRequestObject{Id: id, Body: &scrap})
			return err
		},
	}
	for name, call := range calls {
		t.Run(name+"/staff→403", func(t *testing.T) {
			ctx := withActor(context.Background(), Actor{ByUser: uuid.NewString(), Role: order.RoleStaff, At: time.Now().UTC()})
			if err := call(ctx); !errors.Is(err, errForbidden) {
				t.Fatalf("staff: err = %v, want errForbidden", err)
			}
		})
		t.Run(name+"/no-actor→401", func(t *testing.T) {
			if err := call(context.Background()); !errors.Is(err, errUnauthenticated) {
				t.Fatalf("no actor: err = %v, want errUnauthenticated", err)
			}
		})
	}
}
