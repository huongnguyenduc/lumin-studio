// Package retention runs the order-linked half of payment-proof retention (ADR-035): a background
// sweep that deletes a checkout receipt image ~90 days after its order reaches a terminal status,
// then clears the DB reference (PDPL data-minimization). Abandoned uploads that never became an order
// have no terminal anchor and are reaped instead by the Garage bucket lifecycle rule (infra/README) —
// the orphan backstop. Structured like the outbox relay: one goroutine, panic-recovered, joined on
// shutdown before the DB pool and object client close.
package retention

import (
	"context"
	"log/slog"
	"time"

	"github.com/google/uuid"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
)

// proofOrders is the slice of the order repository the sweeper needs. *db.Orders satisfies it; a fake
// exercises the sweep without Postgres.
type proofOrders interface {
	PurgeableProofOrders(ctx context.Context, before time.Time, limit int32) ([]sqlc.ListPurgeableProofOrdersRow, error)
	ClearPaymentProof(ctx context.Context, id uuid.UUID) error
}

// objectDeleter is the slice of the proof store the sweeper needs. *proofstore.Store satisfies it.
// Delete returns (false, nil) for a URL it does not manage — the sweeper still clears the DB
// reference, since retention applies to the reference regardless of who owns the object.
type objectDeleter interface {
	Delete(ctx context.Context, finalURL string) (bool, error)
}

// defaultBatch bounds one sweep so a large backlog can't hold the pool or run unbounded; the oldest
// receipts sort first, so successive sweeps drain it.
const defaultBatch = 200

// Sweeper deletes checkout receipt images once their order has been terminal longer than retention.
type Sweeper struct {
	orders    proofOrders
	store     objectDeleter
	retention time.Duration
	interval  time.Duration
	batch     int
	logger    *slog.Logger
	now       func() time.Time
}

// New builds a sweeper. retention/interval fall back to safe defaults (90d / 6h) when non-positive,
// so a misconfigured env can never disable retention or spin a zero-interval ticker.
func New(orders proofOrders, store objectDeleter, retention, interval time.Duration, logger *slog.Logger) *Sweeper {
	if retention <= 0 {
		retention = 90 * 24 * time.Hour
	}
	if interval <= 0 {
		interval = 6 * time.Hour
	}
	return &Sweeper{
		orders:    orders,
		store:     store,
		retention: retention,
		interval:  interval,
		batch:     defaultBatch,
		logger:    logger,
		now:       func() time.Time { return time.Now().UTC() },
	}
}

// Run sweeps once immediately (so a restart doesn't wait a full interval), then on every tick until
// ctx is cancelled.
func (s *Sweeper) Run(ctx context.Context) {
	s.sweepOnce(ctx)
	t := time.NewTicker(s.interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			s.sweepOnce(ctx)
		}
	}
}

// sweepOnce lists one bounded batch of expired receipts and, for each, deletes the object THEN clears
// the DB reference. Object-first ordering means a crash between the two leaves a live reference to a
// deleted object — which the next sweep re-selects and re-clears (S3 delete is idempotent) — never a
// cleared reference to a still-live object. A per-order failure is logged and skipped so one bad row
// can't stall the batch; a panic is recovered so the goroutine survives to the next tick.
func (s *Sweeper) sweepOnce(ctx context.Context) {
	defer func() {
		if r := recover(); r != nil && s.logger != nil {
			s.logger.Error("payment-proof retention sweep panicked", "recover", r)
		}
	}()
	if s.orders == nil || s.store == nil {
		return
	}
	cutoff := s.now().Add(-s.retention)
	rows, err := s.orders.PurgeableProofOrders(ctx, cutoff, int32(s.batch))
	if err != nil {
		if s.logger != nil {
			s.logger.Error("payment-proof retention: list failed", "err", err)
		}
		return
	}
	var purged, failed int
	for _, r := range rows {
		if r.PaymentProofUrl == nil || *r.PaymentProofUrl == "" {
			continue
		}
		if _, err := s.store.Delete(ctx, *r.PaymentProofUrl); err != nil {
			failed++
			if s.logger != nil {
				s.logger.Warn("payment-proof retention: object delete failed (kept for retry)", "orderID", r.ID, "err", err)
			}
			continue // keep the DB reference; retry on the next sweep
		}
		if err := s.orders.ClearPaymentProof(ctx, r.ID); err != nil {
			failed++
			if s.logger != nil {
				s.logger.Warn("payment-proof retention: clear failed", "orderID", r.ID, "err", err)
			}
			continue
		}
		purged++
	}
	if s.logger != nil && (purged > 0 || failed > 0) {
		s.logger.Info("payment-proof retention sweep", "purged", purged, "failed", failed, "cutoff", cutoff)
	}
}
