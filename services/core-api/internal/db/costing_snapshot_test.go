package db

import (
	"math"
	"testing"
)

// TestComputeCostSnapshot pins the COGS rollup money math (ADR-039 pt 5/6/7) with no DB. The headline case
// REPRODUCES the design's snapshot card (screen 8, ₫119,178) end to end — filament ₫77,868 + machine
// (6.5h × ₫2,380) ₫15,470 + waste (8.4% of filament+machine) ₫7,840 + aux ₫18,000 — so the code and the
// design cannot silently diverge. The rest exercise every guard: no primary machine, no prints (waste 0),
// aux amortization + its 0-orders guard, and a starved (₫0 filament) but still-costed line.
func TestComputeCostSnapshot(t *testing.T) {
	const eps = 1e-9

	t.Run("design card ₫119,178", func(t *testing.T) {
		got := ComputeCostSnapshot(SnapshotInputs{
			FilamentVnd:     77_868,
			EstPrintMinutes: 390,                                                          // 6.5h
			Machine:         &MachineRate{PurchaseVnd: 2380, Months: 1, HoursPerMonth: 1}, // ₫/h = 2380
			ScrapQty30d:     84,
			PrintQty30d:     1000, // waste factor 0.084 = +8.4%
			AuxPerOrderVnd:  18_000,
		})
		wantMoney := CostSnapshot{FilamentVnd: 77_868, MachineVnd: 15_470, WasteVnd: 7_840, AuxVnd: 18_000, TotalVnd: 119_178}
		if got.FilamentVnd != wantMoney.FilamentVnd || got.MachineVnd != wantMoney.MachineVnd ||
			got.WasteVnd != wantMoney.WasteVnd || got.AuxVnd != wantMoney.AuxVnd || got.TotalVnd != wantMoney.TotalVnd {
			t.Fatalf("money = %+v, want %+v", got, wantMoney)
		}
		if math.Abs(got.EstPrintHours-6.5) > eps || math.Abs(got.MachineVndPerHour-2380) > eps || math.Abs(got.WasteFactor-0.084) > eps {
			t.Fatalf("rates = hours %v / ₫h %v / waste %v, want 6.5 / 2380 / 0.084",
				got.EstPrintHours, got.MachineVndPerHour, got.WasteFactor)
		}
	})

	t.Run("no primary machine → machineVnd 0", func(t *testing.T) {
		got := ComputeCostSnapshot(SnapshotInputs{FilamentVnd: 50_000, EstPrintMinutes: 360, Machine: nil, PrintQty30d: 100, ScrapQty30d: 10, AuxPerOrderVnd: 1000})
		if got.MachineVnd != 0 || got.MachineVndPerHour != 0 {
			t.Fatalf("machine with no primary = %d / %v, want 0 / 0", got.MachineVnd, got.MachineVndPerHour)
		}
		// waste base is filament only (machine 0): 50000 × 10/100 = 5000.
		if got.WasteVnd != 5_000 {
			t.Fatalf("wasteVnd = %d, want 5000", got.WasteVnd)
		}
		if got.TotalVnd != 50_000+0+5_000+1_000 {
			t.Fatalf("total = %d, want 56000", got.TotalVnd)
		}
	})

	t.Run("no prints → waste 0 even with scrap", func(t *testing.T) {
		got := ComputeCostSnapshot(SnapshotInputs{FilamentVnd: 40_000, ScrapQty30d: 500, PrintQty30d: 0})
		if got.WasteVnd != 0 || got.WasteFactor != 0 {
			t.Fatalf("waste with 0 prints = %d / %v, want 0 / 0", got.WasteVnd, got.WasteFactor)
		}
	})

	t.Run("aux amortizes per_month over real orders", func(t *testing.T) {
		got := ComputeCostSnapshot(SnapshotInputs{AuxPerOrderVnd: 5_000, AuxPerMonthVnd: 300_000, RealOrders30d: 20})
		if got.AuxVnd != 5_000+15_000 { // 300000/20 = 15000
			t.Fatalf("auxVnd = %d, want 20000 (5000 + 300000/20)", got.AuxVnd)
		}
	})

	t.Run("0 real orders → per_month portion dropped (guard)", func(t *testing.T) {
		got := ComputeCostSnapshot(SnapshotInputs{AuxPerOrderVnd: 5_000, AuxPerMonthVnd: 300_000, RealOrders30d: 0})
		if got.AuxVnd != 5_000 {
			t.Fatalf("auxVnd = %d, want 5000 (per_month dropped when no real orders)", got.AuxVnd)
		}
	})

	t.Run("starved line stays costed (filament 0, machine > 0)", func(t *testing.T) {
		got := ComputeCostSnapshot(SnapshotInputs{
			FilamentVnd: 0, EstPrintMinutes: 60, Machine: &MachineRate{PurchaseVnd: 6000, Months: 1, HoursPerMonth: 1},
			AuxPerOrderVnd: 2_000,
		})
		// machineVnd = 1h × 6000 = 6000; total = 0 + 6000 + 0 + 2000 = 8000 (a non-zero snapshot, NOT NULL).
		if got.MachineVnd != 6_000 || got.TotalVnd != 8_000 {
			t.Fatalf("starved snapshot = machine %d / total %d, want 6000 / 8000", got.MachineVnd, got.TotalVnd)
		}
	})
}
