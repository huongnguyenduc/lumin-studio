package httpapi

import (
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/order"
)

// resolveDeductionLines turns a printed line into filament draws (ADR-039 pt 3/4): per-part for a two-tone
// product, product-level for a flat one, SKIPPING a deleted part/colour, an unlinked colour, or a zero est.
// Pinned Docker-free; the DB round-trip is proven by the integration test.
func TestResolveDeductionLines(t *testing.T) {
	matA, matB := uuid.New(), uuid.New()
	colRed, colBlue, colUnlinked := uuid.New(), uuid.New(), uuid.New()
	part1, part2 := uuid.New(), uuid.New()
	// colorMat holds ONLY colours linked to a filament (colUnlinked is deliberately absent).
	colorMat := map[uuid.UUID]uuid.UUID{colRed: matA, colBlue: matB}

	pgUUID := func(id uuid.UUID) pgtype.UUID { return pgtype.UUID{Bytes: id, Valid: true} }

	t.Run("parts product draws per part × quantity", func(t *testing.T) {
		oi := sqlc.OrderItemForDeductionRow{Quantity: 2}
		snaps := []order.PartColorSnapshot{{PartID: part1, ColorID: colRed}, {PartID: part2, ColorID: colBlue}}
		partEst := map[uuid.UUID]int64{part1: 100, part2: 50}
		lines := resolveDeductionLines(oi, snaps, partEst, colorMat)
		if len(lines) != 2 ||
			lines[0].MaterialID != matA || lines[0].Qty != 200 || // 100 × 2
			lines[1].MaterialID != matB || lines[1].Qty != 100 { // 50 × 2
			t.Fatalf("parts draws = %+v, want matA×200 + matB×100", lines)
		}
	})

	t.Run("parts skip zero-est part / deleted part / unlinked colour", func(t *testing.T) {
		oi := sqlc.OrderItemForDeductionRow{Quantity: 1}
		snaps := []order.PartColorSnapshot{
			{PartID: part1, ColorID: colRed},      // ok → matA × 100
			{PartID: part2, ColorID: colRed},      // part2 est 0 → skip
			{PartID: uuid.New(), ColorID: colRed}, // part deleted (not in map) → skip
			{PartID: part1, ColorID: colUnlinked}, // colour not linked to a filament → skip
		}
		partEst := map[uuid.UUID]int64{part1: 100, part2: 0}
		lines := resolveDeductionLines(oi, snaps, partEst, colorMat)
		if len(lines) != 1 || lines[0].MaterialID != matA || lines[0].Qty != 100 {
			t.Fatalf("parts skip = %+v, want exactly matA×100", lines)
		}
	})

	t.Run("flat product draws product est from the line colour", func(t *testing.T) {
		oi := sqlc.OrderItemForDeductionRow{Quantity: 3, ProductEstFilamentQty: 40, ColorID: pgUUID(colBlue)}
		lines := resolveDeductionLines(oi, nil, nil, colorMat)
		if len(lines) != 1 || lines[0].MaterialID != matB || lines[0].Qty != 120 { // 40 × 3
			t.Fatalf("flat draw = %+v, want matB×120", lines)
		}
	})

	t.Run("flat skips: zero est, no colour, unlinked colour", func(t *testing.T) {
		if l := resolveDeductionLines(sqlc.OrderItemForDeductionRow{Quantity: 1, ColorID: pgUUID(colBlue)}, nil, nil, colorMat); l != nil {
			t.Fatalf("zero est → nil, got %+v", l)
		}
		if l := resolveDeductionLines(sqlc.OrderItemForDeductionRow{Quantity: 1, ProductEstFilamentQty: 40}, nil, nil, colorMat); l != nil {
			t.Fatalf("no colour → nil, got %+v", l)
		}
		if l := resolveDeductionLines(sqlc.OrderItemForDeductionRow{Quantity: 1, ProductEstFilamentQty: 40, ColorID: pgUUID(colUnlinked)}, nil, nil, colorMat); l != nil {
			t.Fatalf("unlinked colour → nil, got %+v", l)
		}
	})
}
