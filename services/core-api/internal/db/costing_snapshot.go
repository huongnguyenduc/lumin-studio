package db

import (
	"context"
	"encoding/json"
	"errors"
	"math/big"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
)

// costing_snapshot.go — the per-order COGS snapshot rollup (ADR-039 pt 5/6/7, slice 4c-2). When a print job
// first enters PRINTING, deduct-on-print (4b) already froze the FILAMENT cost into filament_consumption; this
// rolls the other cost dimensions (machine depreciation, waste/reprint, allocated overhead) onto that and
// freezes the whole COGS into order_items.cost_snapshot. All money math lands on int-VND via the SAME
// round-once ratToVND the FIFO draw uses (no float in a frozen amount); the rates (₫/hour, waste factor) are
// floats carried only for display. The rollup runs BEST-EFFORT POST-COMMIT (the caller never fails a paid
// order or blocks the board on a costing fault — a failure just leaves cost_snapshot NULL, backfillable).

// CostSnapshot is the frozen COGS blob stored in order_items.cost_snapshot (ADR-039 pt 5). The json tags are
// the wire/stored keys (the httpapi DTO maps this to api.CostSnapshot); money fields are int-VND, the rate
// inputs are the display floats frozen at print so the design card can show "6.5h × ₫2,380" / "+8.4%" exactly.
type CostSnapshot struct {
	FilamentVnd       int64     `json:"filamentVnd"`
	MachineVnd        int64     `json:"machineVnd"`
	WasteVnd          int64     `json:"wasteVnd"`
	AuxVnd            int64     `json:"auxVnd"`
	TotalVnd          int64     `json:"totalVnd"`
	EstPrintHours     float64   `json:"estPrintHours"`
	MachineVndPerHour float64   `json:"machineVndPerHour"`
	WasteFactor       float64   `json:"wasteFactor"`
	At                time.Time `json:"at"`
}

// MachineRate is the primary machine's depreciation inputs (all CHECK > 0 in 000020). ₫/hour =
// PurchaseVnd / (Months × HoursPerMonth). nil in SnapshotInputs = no primary machine → machineVnd 0.
type MachineRate struct {
	PurchaseVnd   int64
	Months        int64
	HoursPerMonth int64
}

// SnapshotInputs are the raw rollup inputs: the item's frozen filament cost + machine-time standard, and the
// shop-wide rolling-30-day rates. Kept as a plain struct so ComputeCostSnapshot is a pure, DB-free unit.
type SnapshotInputs struct {
	FilamentVnd     int64        // Σ frozen filament_consumption.cost_vnd (kind=print) for the item (oracle R2)
	EstPrintMinutes int64        // the product's machine-time standard, exact minutes
	Machine         *MachineRate // nil = no active primary machine → machineVnd 0
	ScrapQty30d     int64        // waste factor numerator
	PrintQty30d     int64        // waste factor denominator
	AuxPerOrderVnd  int64        // Σ aux_costs amount (kind=per_order)
	AuxPerMonthVnd  int64        // Σ aux_costs amount (kind=per_month)
	RealOrders30d   int64        // paid, non-refunded orders in the window (aux amortization denominator)
}

// ComputeCostSnapshot is the pure COGS rollup (ADR-039 pt 5/6/7) — no DB, no clock, so the money math is
// unit-tested against the design's snapshot card (₫119,178). Each money term rounds to int-VND ONCE via
// ratToVND (exact big.Rat inputs, no pre-rounding — same discipline as the FIFO draw):
//   - machineVnd = est_print_hours × ₫/hour = estMinutes × purchase ÷ (60 × months × hours); 0 with no machine.
//   - wasteVnd   = (filamentVnd + machineVnd) × waste-factor (scrap ÷ print grams); 0 when no prints (guard).
//   - auxVnd     = Σper_order + Σper_month ÷ real-orders-30d; the per_month portion is 0 with no real orders.
//   - totalVnd   = filamentVnd + machineVnd + wasteVnd + auxVnd.
//
// The waste base is filament+machine (the production cost a reprint wastes), NOT aux — matches the design card.
// At is left zero; the writer stamps it.
func ComputeCostSnapshot(in SnapshotInputs) CostSnapshot {
	estPrintHours := float64(in.EstPrintMinutes) / 60

	var machineVnd int64
	var machineVndPerHour float64
	if in.Machine != nil {
		denomHours := in.Machine.Months * in.Machine.HoursPerMonth // both > 0 (000020 CHECK) → > 0
		// machineVnd = estMinutes × purchase / (60 × months × hours), exact then rounded once.
		num := new(big.Int).Mul(big.NewInt(in.EstPrintMinutes), big.NewInt(in.Machine.PurchaseVnd))
		den := new(big.Int).Mul(big.NewInt(60), big.NewInt(denomHours))
		machineVnd = ratToVND(new(big.Rat).SetFrac(num, den))
		machineVndPerHour = float64(in.Machine.PurchaseVnd) / float64(denomHours)
	}

	var wasteVnd int64
	if in.PrintQty30d > 0 {
		base := in.FilamentVnd + machineVnd
		// wasteVnd = base × scrap / print, exact then rounded once.
		num := new(big.Int).Mul(big.NewInt(base), big.NewInt(in.ScrapQty30d))
		wasteVnd = ratToVND(new(big.Rat).SetFrac(num, big.NewInt(in.PrintQty30d)))
	}

	auxVnd := auxPerOrderVnd(in.AuxPerOrderVnd, in.AuxPerMonthVnd, in.RealOrders30d)

	return CostSnapshot{
		FilamentVnd:       in.FilamentVnd,
		MachineVnd:        machineVnd,
		WasteVnd:          wasteVnd,
		AuxVnd:            auxVnd,
		TotalVnd:          in.FilamentVnd + machineVnd + wasteVnd + auxVnd,
		EstPrintHours:     estPrintHours,
		MachineVndPerHour: machineVndPerHour,
		WasteFactor:       wasteFactorFloat(in.ScrapQty30d, in.PrintQty30d),
	}
}

// auxPerOrderVnd allocates overhead to one order (ADR-039 pt 7): Σ per_order (fixed each order) + Σ per_month
// amortized over the real-orders-30d count, rounded once. Guard: with no real orders the per_month portion is
// 0 (not a divide-by-zero). SHARED by the snapshot rollup and the costing summary so a frozen margin and the
// dashboard cannot diverge.
func auxPerOrderVnd(perOrder, perMonth, realOrders int64) int64 {
	if realOrders <= 0 {
		return perOrder
	}
	return perOrder + ratToVND(new(big.Rat).SetFrac(big.NewInt(perMonth), big.NewInt(realOrders)))
}

// wasteFactorFloat is the 30-day waste ratio for display (Σscrap ÷ Σprint grams; 0 when no prints, guarded).
// SHARED by the snapshot's frozen display field and the summary KPI.
func wasteFactorFloat(scrap, print int64) float64 {
	if print <= 0 {
		return 0
	}
	return float64(scrap) / float64(print)
}

// SnapshotOrderItem rolls up and freezes the COGS for one printed line (ADR-039 pt 5). It reads the item's
// frozen filament cost + machine standard, the shop-wide 30-day rates and the primary machine, computes the
// snapshot and writes it. The CALLER runs this best-effort post-commit — an error here must NOT fail the
// print move (the filament cost is already frozen in-tx; a NULL cost_snapshot is backfillable). No primary
// machine (ErrNoRows) is NOT an error — machineVnd is simply 0.
func (c *Costing) SnapshotOrderItem(ctx context.Context, orderItemID uuid.UUID) error {
	item, err := c.q.ItemCostInputs(ctx, orderItemID)
	if err != nil {
		return err
	}
	shop, err := c.q.SnapshotShopInputs(ctx)
	if err != nil {
		return err
	}
	in := SnapshotInputs{
		FilamentVnd:     item.FilamentVnd,
		EstPrintMinutes: int64(item.EstPrintMinutes),
		ScrapQty30d:     shop.ScrapQty30d,
		PrintQty30d:     shop.PrintQty30d,
		AuxPerOrderVnd:  shop.AuxPerOrderVnd,
		AuxPerMonthVnd:  shop.AuxPerMonthVnd,
		RealOrders30d:   shop.RealOrders30d,
	}
	if m, err := c.q.PrimaryMachine(ctx); err == nil {
		in.Machine = machineRateOf(m)
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return err // a real DB fault; ErrNoRows = no primary → leave machine nil (machineVnd 0)
	}
	snap := ComputeCostSnapshot(in)
	snap.At = time.Now().UTC()
	blob, err := json.Marshal(snap)
	if err != nil {
		return err
	}
	return c.q.SetOrderItemCostSnapshot(ctx, sqlc.SetOrderItemCostSnapshotParams{ID: orderItemID, CostSnapshot: blob})
}

// CostingSummary is the shop-wide derived KPI read for the /vat-tu dashboard (ADR-039 pt 7). It reuses the
// SAME 30-day inputs + formulas as the snapshot, so the dashboard can never drift from a frozen margin.
type CostingSummary struct {
	WasteFactor              float64
	AuxPerOrderVnd           int64
	RealOrders30d            int64
	PrimaryMachineVndPerHour *float64 // nil when no active primary machine
}

// Summary computes the costing KPIs (waste factor, per-order overhead, real-orders-30d, primary ₫/hour).
func (c *Costing) Summary(ctx context.Context) (CostingSummary, error) {
	shop, err := c.q.SnapshotShopInputs(ctx)
	if err != nil {
		return CostingSummary{}, err
	}
	out := CostingSummary{
		WasteFactor:    wasteFactorFloat(shop.ScrapQty30d, shop.PrintQty30d),
		AuxPerOrderVnd: auxPerOrderVnd(shop.AuxPerOrderVnd, shop.AuxPerMonthVnd, shop.RealOrders30d),
		RealOrders30d:  shop.RealOrders30d,
	}
	if m, err := c.q.PrimaryMachine(ctx); err == nil {
		rate := machineRateOf(m).vndPerHour()
		out.PrimaryMachineVndPerHour = &rate
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return CostingSummary{}, err
	}
	return out, nil
}

// machineRateOf lifts a machine row to its depreciation inputs.
func machineRateOf(m sqlc.Machine) *MachineRate {
	return &MachineRate{
		PurchaseVnd:   m.PurchasePriceVnd,
		Months:        int64(m.DepreciationMonths),
		HoursPerMonth: int64(m.ExpectedHoursPerMonth),
	}
}

// vndPerHour is the derived display rate = purchase / (months × hours). The CHECKs (both > 0) make it safe.
func (r *MachineRate) vndPerHour() float64 {
	return float64(r.PurchaseVnd) / float64(r.Months*r.HoursPerMonth)
}
