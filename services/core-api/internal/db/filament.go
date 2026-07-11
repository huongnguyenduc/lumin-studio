package db

import (
	"context"
	"errors"
	"fmt"
	"math/big"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
)

// Filament is the repository for the Vật tư inventory axis (ADR-039): the shop-wide filament palette
// (filament_materials) and its import lots (filament_batches). Stock + weighted-average cost/unit are
// DERIVED in SQL — the *Material reads LEFT JOIN the batches — so this repo never caches a running number;
// the batches are the source of truth. Construct over the *pgxpool.Pool for autocommit reads/writes, or
// over a pgx.Tx to enlist in a transaction (slice 4b's deduct-on-print decrements these same batches inside
// AdvancePrintStageTx).
type Filament struct {
	q *sqlc.Queries
}

// NewFilament builds a Filament over any sqlc.DBTX (the pool or a pgx.Tx).
func NewFilament(db sqlc.DBTX) *Filament {
	return &Filament{q: sqlc.New(db)}
}

// ListMaterials returns the palette with derived stock + weighted-average cost. includeArchived nil/false
// → active only.
func (f *Filament) ListMaterials(ctx context.Context, includeArchived *bool) ([]sqlc.ListFilamentMaterialsRow, error) {
	return f.q.ListFilamentMaterials(ctx, includeArchived)
}

// GetMaterial returns one material with derived stock/avg. Unknown id → ErrNotFound.
func (f *Filament) GetMaterial(ctx context.Context, id uuid.UUID) (sqlc.GetFilamentMaterialRow, error) {
	row, err := f.q.GetFilamentMaterial(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return sqlc.GetFilamentMaterialRow{}, ErrNotFound
	}
	return row, err
}

// InsertMaterial creates a palette entry (stock 0 until the first import).
func (f *Filament) InsertMaterial(ctx context.Context, arg sqlc.InsertFilamentMaterialParams) (sqlc.FilamentMaterial, error) {
	return f.q.InsertFilamentMaterial(ctx, arg)
}

// UpdateMaterial edits a palette entry (RETURNING → no row means unknown id → ErrNotFound).
func (f *Filament) UpdateMaterial(ctx context.Context, arg sqlc.UpdateFilamentMaterialParams) (sqlc.FilamentMaterial, error) {
	row, err := f.q.UpdateFilamentMaterial(ctx, arg)
	if errors.Is(err, pgx.ErrNoRows) {
		return sqlc.FilamentMaterial{}, ErrNotFound
	}
	return row, err
}

// ListBatches returns a material's import lots, oldest first.
func (f *Filament) ListBatches(ctx context.Context, materialID uuid.UUID) ([]sqlc.FilamentBatch, error) {
	return f.q.ListFilamentBatchesByMaterial(ctx, materialID)
}

// InsertBatch records one import lot. A bad material_id trips the FK (23503) — the handler maps that to 404.
func (f *Filament) InsertBatch(ctx context.Context, arg sqlc.InsertFilamentBatchParams) (sqlc.FilamentBatch, error) {
	return f.q.InsertFilamentBatch(ctx, arg)
}

// ── Deduct-on-print (slice 4b, ADR-039 pt 2/4) ────────────────────────────────────────────────────────

// FilamentKindPrint / FilamentKindScrap are the filament_consumption.kind values (ADR-039 pt 2): print
// draws (deduct-on-print, 4b) vs scrap (the hao-hụt log, 4c). Mirror the 000019 CHECK.
const (
	FilamentKindPrint = "print"
	FilamentKindScrap = "scrap"
)

// DecrementInput is one filament draw (ADR-039 pt 2/4): pull Qty of Material FIFO across its open lots. Kind
// is FilamentKindPrint|FilamentKindScrap. OrderItemID/ProductName tag a print draw to its printed line;
// Reason/Note annotate a scrap draw. Qty ≤ 0 is a no-op (the caller skips a zero est / unresolved material).
type DecrementInput struct {
	MaterialID  uuid.UUID
	Qty         int64
	Kind        string
	OrderItemID *uuid.UUID
	ProductName string
	Reason      string
	Note        string
}

// OrderItemForDeduction reads the line a print job draws filament for (ADR-039 pt 4). Unknown id → ErrNotFound
// (a print_job's order_item FK is CASCADE, so in the deduct path the item always exists — a miss is a fault).
func (f *Filament) OrderItemForDeduction(ctx context.Context, orderItemID uuid.UUID) (sqlc.OrderItemForDeductionRow, error) {
	row, err := f.q.OrderItemForDeduction(ctx, orderItemID)
	if errors.Is(err, pgx.ErrNoRows) {
		return sqlc.OrderItemForDeductionRow{}, ErrNotFound
	}
	return row, err
}

// Decrement draws Qty of a material FIFO across its open lots (enlist f over the tx) and returns the ACTUAL
// qty drawn — == Qty when stock suffices, less when short. A shortfall is CLAMPED, never an error, so an
// under-stocked print is never blocked (ADR-012 / ADR-039 pt 4) — the caller logs it. It row-locks the open
// lots oldest-first (FOR UPDATE) so concurrent draws of the same filament serialize, takes from each until Qty
// is met or stock is exhausted, and writes ONE filament_consumption row for the drawn qty with the FIFO actual
// cost FROZEN in (Σ take×total_cost/qty_original, an exact rational rounded to int-VND ONCE — no per-lot
// pre-round, ADR-039 pt 1). Zero stock → drawn 0, NO ledger row (the qty>0 CHECK). Shared by deduct-on-print
// (4b) and scrap (4c). Runs entirely on the tx → the batch decrements + the ledger row are atomic with the
// caller's stage claim; any error rolls all of it back (retryable, never a half-draw).
func (f *Filament) Decrement(ctx context.Context, in DecrementInput) (int64, error) {
	if in.Qty <= 0 {
		return 0, nil
	}
	lots, err := f.q.BatchesToDecrement(ctx, in.MaterialID)
	if err != nil {
		return 0, fmt.Errorf("filament draw: load lots %s: %w", in.MaterialID, err)
	}
	takes, drawn, costVnd := fifoDraw(lots, in.Qty)
	if drawn == 0 {
		return 0, nil // zero stock — nothing drawn, no ledger row; caller logs the shortfall
	}
	for i, take := range takes {
		if take <= 0 {
			continue
		}
		if err := f.q.DecrementBatch(ctx, sqlc.DecrementBatchParams{Drawn: take, ID: lots[i].ID}); err != nil {
			return 0, fmt.Errorf("filament draw: decrement lot %s: %w", lots[i].ID, err)
		}
	}
	if _, err := f.q.InsertConsumption(ctx, sqlc.InsertConsumptionParams{
		ID:          uuid.New(),
		MaterialID:  in.MaterialID,
		Kind:        in.Kind,
		Qty:         drawn,
		CostVnd:     costVnd,
		OrderItemID: pgUUIDFromPtr(in.OrderItemID),
		ProductName: strPtrOrNil(in.ProductName),
		Reason:      strPtrOrNil(in.Reason),
		Note:        strPtrOrNil(in.Note),
	}); err != nil {
		return 0, fmt.Errorf("filament draw: ledger %s: %w", in.MaterialID, err)
	}
	return drawn, nil
}

// fifoDraw computes the FIFO plan for drawing `need` of a material across its open lots (oldest first — the
// query orders them): the per-lot takes (aligned to lots), the total drawn (clamped at available stock =
// Σ qty_remaining), and the frozen int-VND cost = Σ(take × total_cost_vnd / qty_original) accumulated as an
// EXACT rational (big.Rat — a large take×cost can't overflow int64 and no lot is pre-rounded) and rounded
// ONCE (ADR-039 pt 1). Pure → the money + clamp logic is unit-tested with no DB.
func fifoDraw(lots []sqlc.BatchesToDecrementRow, need int64) (takes []int64, drawn int64, costVnd int64) {
	takes = make([]int64, len(lots))
	cost := new(big.Rat)
	for i, lot := range lots {
		if need <= 0 {
			break
		}
		take := lot.QtyRemaining
		if take > need {
			take = need
		}
		if take <= 0 {
			continue
		}
		takes[i] = take
		// take × total_cost_vnd / qty_original, exact. big.Int numerator: take (≤1e9) × total_cost (≤1e12)
		// overflows int64. qty_original > 0 (000018 CHECK) → no div-by-zero.
		num := new(big.Int).Mul(big.NewInt(take), big.NewInt(lot.TotalCostVnd))
		cost.Add(cost, new(big.Rat).SetFrac(num, big.NewInt(lot.QtyOriginal)))
		drawn += take
		need -= take
	}
	return takes, drawn, ratToVND(cost)
}

// ratToVND rounds a non-negative exact-rational VND amount to the nearest int-VND (half up) — the ONE
// rounding point for a FIFO draw's frozen cost (ADR-039 pt 1/8; all costing amounts are ≥ 0).
func ratToVND(r *big.Rat) int64 {
	// floor((2n + d) / (2d)) = round(n/d) for n, d ≥ 0.
	num := new(big.Int).Mul(r.Num(), big.NewInt(2))
	num.Add(num, r.Denom())
	den := new(big.Int).Mul(r.Denom(), big.NewInt(2))
	return new(big.Int).Quo(num, den).Int64()
}

// pgUUIDFromPtr maps an optional uuid to pgtype.UUID (nil → SQL NULL).
func pgUUIDFromPtr(id *uuid.UUID) pgtype.UUID {
	if id == nil {
		return pgtype.UUID{Valid: false}
	}
	return pgtype.UUID{Bytes: *id, Valid: true}
}

// strPtrOrNil maps "" → nil so an empty label/reason/note stores SQL NULL, not "".
func strPtrOrNil(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
