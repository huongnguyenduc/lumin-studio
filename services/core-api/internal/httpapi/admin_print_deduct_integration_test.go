package httpapi

import (
	"context"
	"io"
	"log/slog"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/order"
)

// TestDeductOnPrintEndToEnd proves deduct-on-print (ADR-039) over a real Postgres: a flat product whose colour
// links to a shop filament draws its est × qty FIFO the FIRST time its print job enters PRINTING — stock
// falls, a consumption ledger row is written with the FIFO cost frozen in, and the job is stamped deducted. A
// re-drag PACKING→PRINTING does NOT draw again (the atomic claim). The FIFO/clamp maths is pinned Docker-free
// in TestFifoDraw; this proves the claim + resolution + decrement wire together against real SQL.
func TestDeductOnPrintEndToEnd(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()

	catID := seedCategory(t, ctx, pool)
	prod := seedProductNamed(t, ctx, pool, catID, "mochi", "Đèn Mochi", 390_000)
	setProductEst(t, ctx, pool, prod, 150) // flat est: 150g per unit

	mat := seedFilament(t, ctx, pool, "Cam", 200, 78_000) // 200g @ ₫390/g
	colorID := seedLinkedColor(t, ctx, pool, prod, mat)

	orderID := seedAdminOrder(t, ctx, pool, adminOrderSeed{
		customer: "Nguyễn An", channel: order.ChannelWeb, createdAt: "2026-07-03T08:00:00Z",
		items: []db.NewOrderItem{{ProductID: prod, ColorID: &colorID, Quantity: 1, UnitPrice: 390_000}},
	})
	item := orderItemID(t, ctx, pool, orderID, prod)
	job := seedPrintJob(t, ctx, pool, printJobSeed{item: item, stage: sqlc.PrintStageNEEDPRINT})

	srv := NewServer(slog.New(slog.NewTextHandler(io.Discard, nil)), pool, nil, nil)

	// --- First →PRINTING draws 150g FIFO from the 200g lot: stock 200→50, cost frozen 150×₫390=₫58500. ---
	advancePrintStage(t, srv, ctx, job, api.PrintStagePRINTING)
	if got := materialStock(t, ctx, pool, mat); got != 50 {
		t.Fatalf("stock after draw = %d, want 50 (200 − 150)", got)
	}
	rows := consumptionRows(t, ctx, pool, mat)
	if len(rows) != 1 {
		t.Fatalf("consumption rows = %d, want 1", len(rows))
	}
	if r := rows[0]; r.kind != "print" || r.qty != 150 || r.costVnd != 58_500 || r.orderItem != item || r.productName != "Đèn Mochi" {
		t.Fatalf("consumption row = %+v, want print/150/₫58500/%s/Đèn Mochi", r, item)
	}
	if !jobDeducted(t, ctx, pool, job) {
		t.Fatal("print job filament_deducted_at not stamped after first →PRINTING")
	}

	// --- Idempotent: PACKING then back to PRINTING must NOT draw again (the claim already stamped it). ---
	advancePrintStage(t, srv, ctx, job, api.PrintStagePACKING)
	advancePrintStage(t, srv, ctx, job, api.PrintStagePRINTING)
	if got := materialStock(t, ctx, pool, mat); got != 50 {
		t.Fatalf("stock after re-drag = %d, want 50 (no second draw)", got)
	}
	if rows := consumptionRows(t, ctx, pool, mat); len(rows) != 1 {
		t.Fatalf("consumption rows after re-drag = %d, want still 1 (idempotent claim)", len(rows))
	}
}

// TestDeductOnPrintShortfallClamps: est exceeds stock → the draw clamps to what is on the shelf (never blocks
// the board, ADR-012), the ledger records the ACTUAL drawn qty (not the est → the weighted-average denominator
// is never poisoned), and stock lands at 0. The move itself must succeed (no error).
func TestDeductOnPrintShortfallClamps(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()

	catID := seedCategory(t, ctx, pool)
	prod := seedProductNamed(t, ctx, pool, catID, "kesach", "Kệ Sách", 200_000)
	setProductEst(t, ctx, pool, prod, 150)               // needs 150g…
	mat := seedFilament(t, ctx, pool, "Xám", 50, 19_500) // …but only 50g on the shelf (₫390/g)
	colorID := seedLinkedColor(t, ctx, pool, prod, mat)

	orderID := seedAdminOrder(t, ctx, pool, adminOrderSeed{
		customer: "Lê Bình", channel: order.ChannelWeb, createdAt: "2026-07-04T08:00:00Z",
		items: []db.NewOrderItem{{ProductID: prod, ColorID: &colorID, Quantity: 1, UnitPrice: 200_000}},
	})
	item := orderItemID(t, ctx, pool, orderID, prod)
	job := seedPrintJob(t, ctx, pool, printJobSeed{item: item, stage: sqlc.PrintStageNEEDPRINT})

	srv := NewServer(slog.New(slog.NewTextHandler(io.Discard, nil)), pool, nil, nil)

	advancePrintStage(t, srv, ctx, job, api.PrintStagePRINTING) // must NOT error despite the shortfall
	if got := materialStock(t, ctx, pool, mat); got != 0 {
		t.Fatalf("stock after clamped draw = %d, want 0 (all 50g drawn)", got)
	}
	rows := consumptionRows(t, ctx, pool, mat)
	if len(rows) != 1 || rows[0].qty != 50 || rows[0].costVnd != 19_500 {
		t.Fatalf("consumption after shortfall = %+v, want one row qty 50 / ₫19500 (actual, not the 150 est)", rows)
	}
}

// --- seed + read helpers ---

func setProductEst(t *testing.T, ctx context.Context, pool *pgxpool.Pool, prod uuid.UUID, est int64) {
	t.Helper()
	if _, err := pool.Exec(ctx, `UPDATE products SET est_filament_qty=$1 WHERE id=$2`, est, prod); err != nil {
		t.Fatalf("set product est: %v", err)
	}
}

// seedFilament inserts a material + one import lot (qty units for totalCost VND) and returns the material id.
func seedFilament(t *testing.T, ctx context.Context, pool *pgxpool.Pool, name string, qty, totalCost int64) uuid.UUID {
	t.Helper()
	fil := db.NewFilament(pool)
	hex := "#888888" // f-1: a colour sources its swatch from its filament, so a seeded filament needs a hex.
	m, err := fil.InsertMaterial(ctx, sqlc.InsertFilamentMaterialParams{ID: uuid.New(), Name: name, Material: "PLA", Unit: "gram", Hex: &hex, LowStockThreshold: 0})
	if err != nil {
		t.Fatalf("seed filament %s: %v", name, err)
	}
	if _, err := fil.InsertBatch(ctx, sqlc.InsertFilamentBatchParams{ID: uuid.New(), MaterialID: m.ID, QtyOriginal: qty, TotalCostVnd: totalCost}); err != nil {
		t.Fatalf("seed filament batch %s: %v", name, err)
	}
	return m.ID
}

// seedLinkedColor inserts a flat product colour linked to a shop filament (ADR-039), so deduct-on-print can
// resolve the material for the line's colour.
func seedLinkedColor(t *testing.T, ctx context.Context, pool *pgxpool.Pool, prod, mat uuid.UUID) uuid.UUID {
	t.Helper()
	c, err := db.NewCatalog(pool).CreateColor(ctx, sqlc.InsertColorParams{
		ID: uuid.New(), ProductID: prod, Name: "Cam", Hex: "#FF6B4A", Available: true, PriceDelta: 0,
		PartID: pgtype.UUID{Valid: false}, FilamentMaterialID: pgtype.UUID{Bytes: mat, Valid: true},
	})
	if err != nil {
		t.Fatalf("seed linked color: %v", err)
	}
	return c.ID
}

func materialStock(t *testing.T, ctx context.Context, pool *pgxpool.Pool, mat uuid.UUID) int64 {
	t.Helper()
	m, err := db.NewFilament(pool).GetMaterial(ctx, mat)
	if err != nil {
		t.Fatalf("read material stock: %v", err)
	}
	return m.StockQty
}

type consumptionRow struct {
	kind        string
	qty         int64
	costVnd     int64
	orderItem   uuid.UUID
	productName string
}

func consumptionRows(t *testing.T, ctx context.Context, pool *pgxpool.Pool, mat uuid.UUID) []consumptionRow {
	t.Helper()
	rows, err := pool.Query(ctx, `SELECT kind, qty, cost_vnd, order_item_id, product_name FROM filament_consumption WHERE material_id=$1 ORDER BY at`, mat)
	if err != nil {
		t.Fatalf("query consumption: %v", err)
	}
	defer rows.Close()
	var out []consumptionRow
	for rows.Next() {
		var r consumptionRow
		var oi pgtype.UUID
		var pn *string
		if err := rows.Scan(&r.kind, &r.qty, &r.costVnd, &oi, &pn); err != nil {
			t.Fatalf("scan consumption: %v", err)
		}
		if oi.Valid {
			r.orderItem = uuid.UUID(oi.Bytes)
		}
		if pn != nil {
			r.productName = *pn
		}
		out = append(out, r)
	}
	return out
}

func jobDeducted(t *testing.T, ctx context.Context, pool *pgxpool.Pool, job uuid.UUID) bool {
	t.Helper()
	pj, err := db.NewJobs(pool).PrintJobByID(ctx, job)
	if err != nil {
		t.Fatalf("read print job: %v", err)
	}
	return pj.FilamentDeductedAt.Valid
}
