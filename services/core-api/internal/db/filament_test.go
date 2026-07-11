package db

import (
	"math/big"
	"testing"

	"github.com/google/uuid"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
)

func lot(remaining, original, cost int64) sqlc.BatchesToDecrementRow {
	return sqlc.BatchesToDecrementRow{ID: uuid.New(), QtyRemaining: remaining, QtyOriginal: original, TotalCostVnd: cost}
}

// fifoDraw is the money + clamp core of deduct-on-print (ADR-039 pt 1/4): take oldest-first, clamp at stock,
// freeze Σ(take × total_cost/qty_original) rounded ONCE. This pins each branch with no DB.
func TestFifoDraw(t *testing.T) {
	tests := []struct {
		name      string
		lots      []sqlc.BatchesToDecrementRow
		need      int64
		wantTakes []int64
		wantDrawn int64
		wantCost  int64
	}{
		// One lot, exact draw: cost = the whole take's share (180g of a 180g @ ₫390/g lot).
		{"single lot exact", []sqlc.BatchesToDecrementRow{lot(180, 180, 70_200)}, 180, []int64{180}, 180, 70_200},
		// FIFO across two lots: 180 @ ₫390 + 320 @ ₫416 = 70200 + 133120 = 203320.
		{"fifo across two lots", []sqlc.BatchesToDecrementRow{lot(180, 180, 70_200), lot(1000, 1000, 416_000)}, 500, []int64{180, 320}, 500, 203_320},
		// Need exceeds stock → clamp to Σ qty_remaining; cost is the full remaining lots (never phantom qty).
		{"shortfall clamps to stock", []sqlc.BatchesToDecrementRow{lot(120, 120, 46_800), lot(60, 60, 24_960)}, 500, []int64{120, 60}, 180, 71_760},
		// No open lots → nothing drawn, zero cost (caller writes no ledger row).
		{"zero stock", nil, 300, nil, 0, 0},
		// A partially-consumed lot: draw only what is left, not the original size.
		{"partial remaining", []sqlc.BatchesToDecrementRow{lot(40, 200, 78_000)}, 100, []int64{40}, 40, 15_600},
		// Rounds ONCE, half up: 1 unit of a 2-unit / ₫5 lot = 2.5 → 3.
		{"round half up", []sqlc.BatchesToDecrementRow{lot(1, 2, 5)}, 1, []int64{1}, 1, 3},
		// Rounds down: 3 units of a 7-unit / ₫100000 lot = 42857.14 → 42857 (no per-lot pre-round drift).
		{"round down", []sqlc.BatchesToDecrementRow{lot(3, 7, 100_000)}, 3, []int64{3}, 3, 42_857},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			takes, drawn, cost := fifoDraw(tc.lots, tc.need)
			if drawn != tc.wantDrawn || cost != tc.wantCost {
				t.Fatalf("drawn=%d cost=%d, want drawn=%d cost=%d", drawn, cost, tc.wantDrawn, tc.wantCost)
			}
			for i, w := range tc.wantTakes {
				if takes[i] != w {
					t.Fatalf("take[%d]=%d, want %d (takes=%v)", i, takes[i], w, takes)
				}
			}
		})
	}
}

// ratToVND freezes a rational VND to int, half up — the single rounding point for a FIFO draw's cost.
func TestRatToVND(t *testing.T) {
	cases := []struct {
		n, d, want int64
	}{
		{5, 2, 3}, // 2.5 → 3 (half up)
		{7, 2, 4}, // 3.5 → 4
		{300_000, 7, 42_857},
		{486_200, 1, 486_200}, // integer stays exact
		{0, 1, 0},
	}
	for _, c := range cases {
		if got := ratToVND(big.NewRat(c.n, c.d)); got != c.want {
			t.Fatalf("ratToVND(%d/%d)=%d, want %d", c.n, c.d, got, c.want)
		}
	}
}
