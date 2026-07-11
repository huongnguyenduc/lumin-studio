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
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/order"
)

// Docker-free tests for the Vật tư filament surface (ADR-039 slice 4a): the owner-only boundary + the two
// validators. The DB round-trip (weighted-average, import, stock) is proven in the integration test.

func strptr(s string) *string { return &s }

func TestCleanFilamentMaterialInput(t *testing.T) {
	valid := api.FilamentMaterialInput{Name: "Cam Lumin", Material: "PLA", Unit: "gram", Hex: strptr("#FF6B4A"), LowStockThreshold: 500}
	got, fields := cleanFilamentMaterialInput(valid)
	if len(fields) != 0 {
		t.Fatalf("valid: unexpected fields %v", fields)
	}
	if got.Name != "Cam Lumin" || got.Material != "PLA" || got.Unit != "gram" || got.Hex == nil || *got.Hex != "#FF6B4A" || got.LowStockThreshold != 500 {
		t.Fatalf("valid: bad clean %+v", got)
	}

	// hex is optional: nil and empty both mean "no swatch", not an error.
	for _, h := range []*string{nil, strptr("")} {
		g, f := cleanFilamentMaterialInput(api.FilamentMaterialInput{Name: "x", Material: "PETG", Unit: "ml", Hex: h})
		if len(f) != 0 {
			t.Fatalf("hex %v: unexpected fields %v", h, f)
		}
		if g.Hex != nil {
			t.Fatalf("hex %v: want nil hex, got %v", h, *g.Hex)
		}
	}

	// archived flows through (soft-delete on update).
	if g, _ := cleanFilamentMaterialInput(api.FilamentMaterialInput{Name: "x", Material: "Resin", Unit: "gram", Archived: func() *bool { b := true; return &b }()}); !g.Archived {
		t.Fatal("archived=true should flow through")
	}

	bad := map[string]api.FilamentMaterialInput{
		"name":              {Name: "  ", Material: "PLA", Unit: "gram"},
		"material":          {Name: "x", Material: "Wood", Unit: "gram"},
		"unit":              {Name: "x", Material: "PLA", Unit: "kg"},
		"hex":               {Name: "x", Material: "PLA", Unit: "gram", Hex: strptr("red")},
		"lowStockThreshold": {Name: "x", Material: "PLA", Unit: "gram", LowStockThreshold: -1},
	}
	for field, in := range bad {
		t.Run("bad/"+field, func(t *testing.T) {
			_, f := cleanFilamentMaterialInput(in)
			if f[field] == "" {
				t.Fatalf("want field %q flagged, got %v", field, f)
			}
		})
	}
}

func TestCleanFilamentImportInput(t *testing.T) {
	qty, cost, fields := cleanFilamentImportInput(api.FilamentImportInput{SpoolCount: 2, QtyPerSpool: 1000, PricePerSpoolVnd: 416000})
	if len(fields) != 0 {
		t.Fatalf("valid: unexpected fields %v", fields)
	}
	if qty != 2000 || cost != 832000 {
		t.Fatalf("derive: qty=%d cost=%d, want 2000/832000", qty, cost)
	}

	bad := map[string]api.FilamentImportInput{
		"spoolCount/zero":       {SpoolCount: 0, QtyPerSpool: 100, PricePerSpoolVnd: 1},
		"spoolCount/over":       {SpoolCount: maxSpoolCount + 1, QtyPerSpool: 100, PricePerSpoolVnd: 1},
		"qtyPerSpool/zero":      {SpoolCount: 1, QtyPerSpool: 0, PricePerSpoolVnd: 1},
		"qtyPerSpool/over":      {SpoolCount: 1, QtyPerSpool: maxQtyPerSpool + 1, PricePerSpoolVnd: 1},
		"pricePerSpoolVnd/neg":  {SpoolCount: 1, QtyPerSpool: 1, PricePerSpoolVnd: -1},
		"pricePerSpoolVnd/over": {SpoolCount: 1, QtyPerSpool: 1, PricePerSpoolVnd: maxPricePerSpool + 1},
	}
	for name, in := range bad {
		t.Run("bad/"+name, func(t *testing.T) {
			_, _, f := cleanFilamentImportInput(in)
			if len(f) == 0 {
				t.Fatalf("%s: want a flagged field, got none", name)
			}
		})
	}
}

// TestFilamentWritesAreOwnerOnly proves the three Vật tư mutations reject staff (403) and no-actor (401)
// at the handler's assertOwner gate — before any DB touch (pool is nil).
func TestFilamentWritesAreOwnerOnly(t *testing.T) {
	srv := NewServer(slog.New(slog.NewTextHandler(io.Discard, nil)), nil, nil, nil)
	id := uuid.New()
	mat := api.FilamentMaterialInput{Name: "x", Material: "PLA", Unit: "gram"}
	imp := api.FilamentImportInput{SpoolCount: 1, QtyPerSpool: 1, PricePerSpoolVnd: 0}

	calls := map[string]func(context.Context) error{
		"CreateFilamentMaterial": func(ctx context.Context) error {
			_, err := srv.CreateFilamentMaterial(ctx, api.CreateFilamentMaterialRequestObject{Body: &mat})
			return err
		},
		"UpdateFilamentMaterial": func(ctx context.Context) error {
			_, err := srv.UpdateFilamentMaterial(ctx, api.UpdateFilamentMaterialRequestObject{Id: id, Body: &mat})
			return err
		},
		"ImportFilament": func(ctx context.Context) error {
			_, err := srv.ImportFilament(ctx, api.ImportFilamentRequestObject{Id: id, Body: &imp})
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
