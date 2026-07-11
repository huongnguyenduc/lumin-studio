package db

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

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
