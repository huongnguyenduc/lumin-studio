package retention

import (
	"context"
	"log/slog"
	"time"
)

// stuckJobFailer is the slice of the jobs repository the reconcile sweeper needs. *db.Jobs satisfies it;
// a fake exercises the sweep without Postgres.
type stuckJobFailer interface {
	FailStuckProcessing(ctx context.Context, before time.Time) (int64, error)
}

// AssetJobSweeper is the reconcile sweep for asset jobs (ops): a job left in 'processing' past the
// stuck-after window means the worker died or the final-attempt callback was lost — nothing will ever
// move it, and Admin shows it as forever-running. Same shape as the GeoSweeper — one goroutine,
// panic-recovered, joined on shutdown before the pool closes — running a single cheap UPDATE that flips
// stuck jobs to 'failed' + last_error 'reconcile: stuck in processing', so the owner sees and can
// re-enqueue. updated_at is the liveness signal: every worker callback refreshes it, so the window only
// needs to outlast one honest attempt (renders are minutes, not hours).
type AssetJobSweeper struct {
	jobs       stuckJobFailer
	stuckAfter time.Duration
	interval   time.Duration
	logger     *slog.Logger
	now        func() time.Time
}

// NewAssetJobSweeper builds the sweeper. stuckAfter/interval fall back to safe defaults (2h / 15m) when
// non-positive, so a misconfigured env can never fail jobs that are still honestly processing or spin a
// zero-interval ticker.
func NewAssetJobSweeper(jobs stuckJobFailer, stuckAfter, interval time.Duration, logger *slog.Logger) *AssetJobSweeper {
	if stuckAfter <= 0 {
		stuckAfter = 2 * time.Hour
	}
	if interval <= 0 {
		interval = 15 * time.Minute
	}
	return &AssetJobSweeper{
		jobs:       jobs,
		stuckAfter: stuckAfter,
		interval:   interval,
		logger:     logger,
		now:        func() time.Time { return time.Now().UTC() },
	}
}

// Run sweeps once immediately (so a restart doesn't wait a full interval), then on every tick until ctx
// is cancelled.
func (s *AssetJobSweeper) Run(ctx context.Context) {
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

// sweepOnce fails every over-deadline 'processing' job in one UPDATE. A failure is logged and retried on
// the next tick; a panic is recovered so the goroutine survives.
func (s *AssetJobSweeper) sweepOnce(ctx context.Context) {
	defer func() {
		if r := recover(); r != nil && s.logger != nil {
			s.logger.Error("asset-job reconcile sweep panicked", "recover", r)
		}
	}()
	if s.jobs == nil {
		return
	}
	cutoff := s.now().Add(-s.stuckAfter)
	swept, err := s.jobs.FailStuckProcessing(ctx, cutoff)
	if err != nil {
		if s.logger != nil {
			s.logger.Error("asset-job reconcile: sweep failed", "err", err)
		}
		return
	}
	if s.logger != nil && swept > 0 {
		s.logger.Warn("asset-job reconcile sweep failed stuck jobs", "swept", swept, "cutoff", cutoff)
	}
}
