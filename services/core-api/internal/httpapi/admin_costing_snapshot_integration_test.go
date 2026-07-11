package httpapi

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/order"
)

// TestCostSnapshotEndToEnd proves the COGS snapshot rollup (ADR-039 pt 5/6/7, slice 4c-2) over real Postgres:
// when a print job first enters PRINTING, deduct-on-print freezes the filament cost in-tx, then the best-effort
// post-commit rollup reads that back + the machine/waste/aux rates and freezes the whole COGS onto
// order_items.cost_snapshot. The money math is pinned Docker-free in TestComputeCostSnapshot (design card
// ₫119,178); this proves the SQL reads (Σ frozen consumption per item — oracle R2, primary machine, 30-day
// waste, aux totals) + the write + the order-detail read-back wire together. It also drives GetCostingSummary
// over the same shop state so the dashboard KPIs use the identical inputs (margin can't drift).
//
// Shop: 200g @ ₫390/g filament; product est 150g / 6h; primary machine ₫2,000/h; ₫18,000 per-order overhead;
// a pre-existing 15g scrap row → 30-day waste factor 15/150 = 0.1 once the 150g print draw lands.
func TestCostSnapshotEndToEnd(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()

	catID := seedCategory(t, ctx, pool)
	prod := seedProductNamed(t, ctx, pool, catID, "mochi", "Đèn Mochi", 320_000)
	setProductEst(t, ctx, pool, prod, 150)          // 150g filament per unit
	setProductPrintMinutes(t, ctx, pool, prod, 360) // 6h machine time per unit

	mat := seedFilament(t, ctx, pool, "Cam", 200, 78_000) // 200g @ ₫390/g
	colorID := seedLinkedColor(t, ctx, pool, prod, mat)
	seedScrapRow(t, ctx, pool, mat, 15, 5_850) // hao-hụt 15g → the 30-day waste numerator

	// Primary machine: ₫/h = 2_000_000 / (10 × 100) = ₫2,000. Plus a ₫18,000 per-order overhead line.
	seedMachine(t, ctx, pool, "P1S", 2_000_000, 10, 100, true)
	seedAuxCost(t, ctx, pool, "Đóng gói", "per_order", 18_000)

	orderID := seedAdminOrder(t, ctx, pool, adminOrderSeed{
		customer: "Nguyễn An", channel: order.ChannelWeb, createdAt: "2026-07-05T08:00:00Z",
		items: []db.NewOrderItem{{ProductID: prod, ColorID: &colorID, Quantity: 1, UnitPrice: 320_000}},
	})
	item := orderItemID(t, ctx, pool, orderID, prod)
	job := seedPrintJob(t, ctx, pool, printJobSeed{item: item, stage: sqlc.PrintStageNEEDPRINT})

	srv := NewServer(slog.New(slog.NewTextHandler(io.Discard, nil)), pool, nil, nil)

	// First →PRINTING: draw 150g (₫58,500 frozen) then roll up the COGS.
	advancePrintStage(t, srv, ctx, job, api.PrintStagePRINTING)

	// filament 58500 + machine (6h × ₫2000) 12000 + waste ((58500+12000) × 0.1) 7050 + aux 18000 = 95550.
	snap := readCostSnapshot(t, ctx, pool, item)
	want := db.CostSnapshot{FilamentVnd: 58_500, MachineVnd: 12_000, WasteVnd: 7_050, AuxVnd: 18_000, TotalVnd: 95_550}
	if snap.FilamentVnd != want.FilamentVnd || snap.MachineVnd != want.MachineVnd || snap.WasteVnd != want.WasteVnd ||
		snap.AuxVnd != want.AuxVnd || snap.TotalVnd != want.TotalVnd {
		t.Fatalf("cost_snapshot money = %+v, want %+v", snap, want)
	}
	if snap.EstPrintHours != 6 || snap.MachineVndPerHour != 2000 || snap.WasteFactor != 0.1 {
		t.Fatalf("cost_snapshot rates = %vh / ₫%v / waste %v, want 6 / 2000 / 0.1",
			snap.EstPrintHours, snap.MachineVndPerHour, snap.WasteFactor)
	}
	if snap.At.IsZero() {
		t.Fatal("cost_snapshot.at not stamped")
	}

	// The admin order-detail read surfaces the snapshot on the line (owner+staff).
	rows, err := sqlc.New(pool).ListOrderItems(ctx, orderID)
	if err != nil {
		t.Fatalf("list order items: %v", err)
	}
	items, err := orderItemsDTO(rows)
	if err != nil {
		t.Fatalf("orderItemsDTO: %v", err)
	}
	if len(items) != 1 || items[0].CostSnapshot == nil {
		t.Fatalf("order-detail DTO missing costSnapshot: %+v", items)
	}
	if items[0].CostSnapshot.TotalVnd != 95_550 {
		t.Fatalf("DTO costSnapshot.totalVnd = %d, want 95550", items[0].CostSnapshot.TotalVnd)
	}

	// GetCostingSummary derives the /vat-tu KPIs from the SAME shop inputs.
	sum, err := srv.GetCostingSummary(ctx, api.GetCostingSummaryRequestObject{})
	if err != nil {
		t.Fatalf("GetCostingSummary: %v", err)
	}
	kpi := sum.(api.GetCostingSummary200JSONResponse)
	if kpi.WasteFactor != 0.1 || kpi.AuxPerOrderVnd != 18_000 || kpi.RealOrders30d != 0 {
		t.Fatalf("summary = waste %v / aux %d / orders %d, want 0.1 / 18000 / 0", kpi.WasteFactor, kpi.AuxPerOrderVnd, kpi.RealOrders30d)
	}
	if kpi.PrimaryMachineVndPerHour == nil || *kpi.PrimaryMachineVndPerHour != 2000 {
		t.Fatalf("summary primary ₫/h = %v, want 2000", kpi.PrimaryMachineVndPerHour)
	}
}

// TestCostSnapshotNoPrimaryMachine: with no primary machine the rollup still freezes a snapshot (machineVnd 0)
// — a starved/incomplete cost config never leaves the line uncosted (which a margin read would misread).
func TestCostSnapshotNoPrimaryMachine(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()

	catID := seedCategory(t, ctx, pool)
	prod := seedProductNamed(t, ctx, pool, catID, "khay", "Khay", 90_000)
	setProductEst(t, ctx, pool, prod, 40)
	setProductPrintMinutes(t, ctx, pool, prod, 120) // 2h, but no machine → machineVnd 0
	mat := seedFilament(t, ctx, pool, "Trắng", 100, 40_000)
	colorID := seedLinkedColor(t, ctx, pool, prod, mat)

	orderID := seedAdminOrder(t, ctx, pool, adminOrderSeed{
		customer: "Lê Bình", channel: order.ChannelWeb, createdAt: "2026-07-06T08:00:00Z",
		items: []db.NewOrderItem{{ProductID: prod, ColorID: &colorID, Quantity: 1, UnitPrice: 90_000}},
	})
	item := orderItemID(t, ctx, pool, orderID, prod)
	job := seedPrintJob(t, ctx, pool, printJobSeed{item: item, stage: sqlc.PrintStageNEEDPRINT})

	srv := NewServer(slog.New(slog.NewTextHandler(io.Discard, nil)), pool, nil, nil)
	advancePrintStage(t, srv, ctx, job, api.PrintStagePRINTING)

	snap := readCostSnapshot(t, ctx, pool, item)
	// filament = 40g × ₫400 = 16000; machine 0 (no primary); no aux; no scrap → total 16000, still non-NULL.
	if snap.MachineVnd != 0 || snap.FilamentVnd != 16_000 || snap.TotalVnd != 16_000 {
		t.Fatalf("no-machine snapshot = %+v, want filament 16000 / machine 0 / total 16000", snap)
	}
}

// --- seed + read helpers (slice 4c-2) ---

func setProductPrintMinutes(t *testing.T, ctx context.Context, pool *pgxpool.Pool, prod uuid.UUID, minutes int32) {
	t.Helper()
	if _, err := pool.Exec(ctx, `UPDATE products SET est_print_minutes=$1 WHERE id=$2`, minutes, prod); err != nil {
		t.Fatalf("set product print minutes: %v", err)
	}
}

func seedMachine(t *testing.T, ctx context.Context, pool *pgxpool.Pool, name string, price int64, months, hours int32, primary bool) {
	t.Helper()
	if _, err := db.NewCosting(pool).InsertMachine(ctx, sqlc.InsertMachineParams{
		ID: uuid.New(), Name: name, PurchasePriceVnd: price, DepreciationMonths: months, ExpectedHoursPerMonth: hours, IsPrimary: primary, Active: true,
	}); err != nil {
		t.Fatalf("seed machine: %v", err)
	}
}

func seedAuxCost(t *testing.T, ctx context.Context, pool *pgxpool.Pool, label, kind string, amount int64) {
	t.Helper()
	if _, err := db.NewCosting(pool).InsertAuxCost(ctx, sqlc.InsertAuxCostParams{ID: uuid.New(), Label: label, Kind: kind, AmountVnd: amount}); err != nil {
		t.Fatalf("seed aux cost: %v", err)
	}
}

// seedScrapRow inserts a scrap consumption row directly (the scrap draw itself is covered by 4c-1's
// TestScrapFilamentEndToEnd) so the 30-day waste factor has a numerator without perturbing stock.
func seedScrapRow(t *testing.T, ctx context.Context, pool *pgxpool.Pool, mat uuid.UUID, qty, costVnd int64) {
	t.Helper()
	if _, err := pool.Exec(ctx,
		`INSERT INTO filament_consumption (id, material_id, kind, qty, cost_vnd) VALUES ($1,$2,'scrap',$3,$4)`,
		uuid.New(), mat, qty, costVnd); err != nil {
		t.Fatalf("seed scrap row: %v", err)
	}
}

func readCostSnapshot(t *testing.T, ctx context.Context, pool *pgxpool.Pool, item uuid.UUID) db.CostSnapshot {
	t.Helper()
	var raw []byte
	if err := pool.QueryRow(ctx, `SELECT cost_snapshot FROM order_items WHERE id=$1`, item).Scan(&raw); err != nil {
		t.Fatalf("read cost_snapshot: %v", err)
	}
	if raw == nil {
		t.Fatal("cost_snapshot is NULL — rollup did not run")
	}
	var snap db.CostSnapshot
	if err := json.Unmarshal(raw, &snap); err != nil {
		t.Fatalf("unmarshal cost_snapshot: %v", err)
	}
	return snap
}
