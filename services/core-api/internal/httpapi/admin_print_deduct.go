package httpapi

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/order"
)

// admin_print_deduct.go — deduct-on-print (ADR-039 pt 3/4). When a print job first enters PRINTING (the
// atomic claim in AdvancePrintJobStage), this draws the filament its printed line consumes FIFO, freezing the
// actual cost into filament_consumption. It runs on the SAME tx as the stage claim, so the draw and the claim
// commit as one unit — a costing/DB fault rolls both back (retryable, never a half-draw), while a mere
// SHORTFALL (bad est / empty spool) clamps + logs and never blocks the board (ADR-012). Snapshot rollup of
// the other cost dimensions (machine/aux/waste) lands in 4c — the filament cost frozen here is its input.

// deductionLine is one filament draw the deduct-on-print resolves for a printed line: Qty of Material.
type deductionLine struct {
	MaterialID uuid.UUID
	Qty        int64
}

// resolveDeductionLines turns a printed order_item into its filament draws (ADR-039 pt 3/4). PURE, so the
// flat/parts/skip branches are unit-tested with no DB. Two shapes (ADR-037):
//   - parts product (part_colors snapshot non-empty): one draw per part — grams = that part's est_filament_qty
//     × quantity, material = that part's chosen colour's filament_material_id.
//   - flat product (no snapshot): one draw — grams = product.est_filament_qty × quantity, material = the
//     line's colour's filament_material_id.
//
// A part/colour that no longer exists, a colour with no linked filament, or a zero est is SKIPPED cleanly
// (ADR-039 "skip sạch") — nothing to draw, no error. partEst / colorMat are built from the product's LIVE
// catalog (keyed by id), so the draw reflects what is printed now, not order-time names — colorMat holds
// ONLY colours that have a linked filament (an unlinked colour is absent → skipped).
func resolveDeductionLines(oi sqlc.OrderItemForDeductionRow, snaps []order.PartColorSnapshot, partEst map[uuid.UUID]int64, colorMat map[uuid.UUID]uuid.UUID) []deductionLine {
	qty := int64(oi.Quantity)
	if len(snaps) > 0 {
		out := make([]deductionLine, 0, len(snaps))
		for _, s := range snaps {
			est, ok := partEst[s.PartID]
			if !ok || est <= 0 {
				continue // part deleted or no estimate → skip
			}
			mat, ok := colorMat[s.ColorID]
			if !ok {
				continue // colour deleted or not linked to a filament → skip
			}
			out = append(out, deductionLine{MaterialID: mat, Qty: est * qty})
		}
		return out
	}
	// Flat product: draw the product-level est from the line's colour's filament.
	if oi.ProductEstFilamentQty <= 0 || !oi.ColorID.Valid {
		return nil
	}
	mat, ok := colorMat[uuid.UUID(oi.ColorID.Bytes)]
	if !ok {
		return nil
	}
	return []deductionLine{{MaterialID: mat, Qty: oi.ProductEstFilamentQty * qty}}
}

// deductFilamentForPrint draws filament for a job that JUST won the PRINTING claim (ADR-039 pt 4). It reads
// the printed line + the product's LIVE parts/colours on tx, resolves the per-draw lines, and decrements each
// FIFO — all on tx, so the whole draw is atomic with the claim. A shortfall (drawn < requested) does NOT fail
// the move: it clamps and logs (ADR-012 — staff drive the board; a bad est or empty spool can't block
// fulfillment). A resolution/DB error propagates → the tx (incl. the claim) rolls back → the move is retryable.
func (s *Server) deductFilamentForPrint(ctx context.Context, tx pgx.Tx, orderItemID uuid.UUID) error {
	fil := db.NewFilament(tx)
	oi, err := fil.OrderItemForDeduction(ctx, orderItemID)
	if err != nil {
		return err // CASCADE FK ⇒ the item exists in the deduct path; a miss is a real fault → 500
	}
	snaps, err := partColorSnapshots(oi.PartColors)
	if err != nil {
		return fmt.Errorf("deduct print %s: part_colors: %w", orderItemID, err)
	}
	cat := db.NewCatalog(tx)
	parts, err := cat.PartsByProduct(ctx, oi.ProductID)
	if err != nil {
		return err
	}
	colors, err := cat.ColorsByProduct(ctx, oi.ProductID)
	if err != nil {
		return err
	}
	partEst := make(map[uuid.UUID]int64, len(parts))
	for _, p := range parts {
		partEst[p.ID] = p.EstFilamentQty
	}
	colorMat := make(map[uuid.UUID]uuid.UUID, len(colors))
	for _, c := range colors {
		if c.FilamentMaterialID.Valid {
			colorMat[c.ID] = uuid.UUID(c.FilamentMaterialID.Bytes)
		}
	}
	for _, ln := range resolveDeductionLines(oi, snaps, partEst, colorMat) {
		drawn, err := fil.Decrement(ctx, db.DecrementInput{
			MaterialID:  ln.MaterialID,
			Qty:         ln.Qty,
			Kind:        db.FilamentKindPrint,
			OrderItemID: &orderItemID,
			ProductName: oi.ProductName,
		})
		if err != nil {
			return err
		}
		if drawn < ln.Qty {
			// Shortfall: not enough stock. Never blocks the print (clamped) — surface it for the owner.
			s.logger.Warn("filament shortfall on print",
				"orderItem", orderItemID, "material", ln.MaterialID, "needed", ln.Qty, "drawn", drawn)
		}
	}
	return nil
}
