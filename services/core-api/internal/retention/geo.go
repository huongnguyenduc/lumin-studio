package retention

import (
	"context"
	"log/slog"
	"time"
)

// finderGeoPurger is the slice of the pet-tag repository the geo sweeper needs. *db.PetTags satisfies it;
// a fake exercises the sweep without Postgres.
type finderGeoPurger interface {
	PurgeExpiredFinderLocations(ctx context.Context, before time.Time) (int64, error)
}

// GeoSweeper NULLs a finder's shared {lat,lng} on lost_events once it has outlived the geo-retention window
// (P3-t t-6, PDPL data-minimization). Same shape as the payment-proof Sweeper — one goroutine, panic-
// recovered, joined on shutdown before the pool closes — but it runs a single cheap UPDATE with no object
// store: the lost_events row (the owner's own lost-scan history) survives, only the finder's PII coordinate
// is dropped. Finder location is useful only while a pet is actively lost, so the default window is short.
type GeoSweeper struct {
	tags      finderGeoPurger
	retention time.Duration
	interval  time.Duration
	logger    *slog.Logger
	now       func() time.Time
}

// NewGeoSweeper builds the geo sweeper. retention/interval fall back to safe defaults (30d / 6h) when
// non-positive, so a misconfigured env can never disable retention or spin a zero-interval ticker.
func NewGeoSweeper(tags finderGeoPurger, retention, interval time.Duration, logger *slog.Logger) *GeoSweeper {
	if retention <= 0 {
		retention = 30 * 24 * time.Hour
	}
	if interval <= 0 {
		interval = 6 * time.Hour
	}
	return &GeoSweeper{
		tags:      tags,
		retention: retention,
		interval:  interval,
		logger:    logger,
		now:       func() time.Time { return time.Now().UTC() },
	}
}

// Run sweeps once immediately (so a restart doesn't wait a full interval), then on every tick until ctx is
// cancelled.
func (s *GeoSweeper) Run(ctx context.Context) {
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

// sweepOnce NULLs every finder location older than the cutoff in one UPDATE. A failure is logged and retried
// on the next tick; a panic is recovered so the goroutine survives.
func (s *GeoSweeper) sweepOnce(ctx context.Context) {
	defer func() {
		if r := recover(); r != nil && s.logger != nil {
			s.logger.Error("lost-event geo retention sweep panicked", "recover", r)
		}
	}()
	if s.tags == nil {
		return
	}
	cutoff := s.now().Add(-s.retention)
	cleared, err := s.tags.PurgeExpiredFinderLocations(ctx, cutoff)
	if err != nil {
		if s.logger != nil {
			s.logger.Error("lost-event geo retention: purge failed", "err", err)
		}
		return
	}
	if s.logger != nil && cleared > 0 {
		s.logger.Info("lost-event geo retention sweep", "cleared", cleared, "cutoff", cutoff)
	}
}
