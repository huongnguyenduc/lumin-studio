package db

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
)

// Costing is the repository for the Vật tư cost-input axis (ADR-039 slice 4c-1): machines (depreciation) and
// aux_costs (overhead). Both are OWNER-curated rate inputs — the ₫/hour and the per-order aux allocation are
// derived downstream (Go DTO / the 4c-2 rollup), so this repo stores no money amount, only the raw inputs.
// Construct over the *pgxpool.Pool for autocommit reads/writes, or over a pgx.Tx to enlist in a transaction.
type Costing struct {
	q *sqlc.Queries
}

// NewCosting builds a Costing over any sqlc.DBTX (the pool or a pgx.Tx).
func NewCosting(db sqlc.DBTX) *Costing {
	return &Costing{q: sqlc.New(db)}
}

// ListMachines returns every machine (primary first, then by name); the DTO derives ₫/hour.
func (c *Costing) ListMachines(ctx context.Context) ([]sqlc.Machine, error) {
	return c.q.ListMachines(ctx)
}

// InsertMachine creates a machine.
func (c *Costing) InsertMachine(ctx context.Context, arg sqlc.InsertMachineParams) (sqlc.Machine, error) {
	return c.q.InsertMachine(ctx, arg)
}

// UpdateMachine edits a machine (RETURNING → no row means unknown id → ErrNotFound).
func (c *Costing) UpdateMachine(ctx context.Context, arg sqlc.UpdateMachineParams) (sqlc.Machine, error) {
	row, err := c.q.UpdateMachine(ctx, arg)
	if errors.Is(err, pgx.ErrNoRows) {
		return sqlc.Machine{}, ErrNotFound
	}
	return row, err
}

// DeleteMachine hard-deletes a machine; unknown id → ErrNotFound (RETURNING id → no row).
func (c *Costing) DeleteMachine(ctx context.Context, id uuid.UUID) error {
	if _, err := c.q.DeleteMachine(ctx, id); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}
	return nil
}

// ListAuxCosts returns every overhead line (grouped by kind then label).
func (c *Costing) ListAuxCosts(ctx context.Context) ([]sqlc.AuxCost, error) {
	return c.q.ListAuxCosts(ctx)
}

// InsertAuxCost creates an overhead line.
func (c *Costing) InsertAuxCost(ctx context.Context, arg sqlc.InsertAuxCostParams) (sqlc.AuxCost, error) {
	return c.q.InsertAuxCost(ctx, arg)
}

// UpdateAuxCost edits an overhead line (unknown id → ErrNotFound).
func (c *Costing) UpdateAuxCost(ctx context.Context, arg sqlc.UpdateAuxCostParams) (sqlc.AuxCost, error) {
	row, err := c.q.UpdateAuxCost(ctx, arg)
	if errors.Is(err, pgx.ErrNoRows) {
		return sqlc.AuxCost{}, ErrNotFound
	}
	return row, err
}

// DeleteAuxCost hard-deletes an overhead line; unknown id → ErrNotFound.
func (c *Costing) DeleteAuxCost(ctx context.Context, id uuid.UUID) error {
	if _, err := c.q.DeleteAuxCost(ctx, id); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}
	return nil
}
