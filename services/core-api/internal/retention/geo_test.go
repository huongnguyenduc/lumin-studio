package retention

import (
	"context"
	"errors"
	"testing"
	"time"
)

type fakeGeoPurger struct {
	gotBefore time.Time
	calls     int
	cleared   int64
	err       error
}

func (f *fakeGeoPurger) PurgeExpiredFinderLocations(ctx context.Context, before time.Time) (int64, error) {
	f.calls++
	f.gotBefore = before
	return f.cleared, f.err
}

func TestGeoSweeperCutoffIsNowMinusRetention(t *testing.T) {
	f := &fakeGeoPurger{cleared: 3}
	now := time.Date(2026, 7, 13, 12, 0, 0, 0, time.UTC)
	s := NewGeoSweeper(f, 30*24*time.Hour, time.Hour, nil)
	s.now = func() time.Time { return now }

	s.sweepOnce(context.Background())

	if f.calls != 1 {
		t.Fatalf("purge calls = %d, want 1", f.calls)
	}
	want := now.Add(-30 * 24 * time.Hour)
	if !f.gotBefore.Equal(want) {
		t.Fatalf("cutoff = %s, want %s (now - retention)", f.gotBefore, want)
	}
}

// A non-positive retention must fall back to the 30-day default, NOT collapse to "now" (which would NULL
// every finder location on the next sweep). Guards the misconfigured-env footgun.
func TestNewGeoSweeperDefaultsGuardBadConfig(t *testing.T) {
	f := &fakeGeoPurger{}
	now := time.Date(2026, 7, 13, 0, 0, 0, 0, time.UTC)
	s := NewGeoSweeper(f, 0, 0, nil)
	s.now = func() time.Time { return now }

	s.sweepOnce(context.Background())

	want := now.Add(-30 * 24 * time.Hour)
	if !f.gotBefore.Equal(want) {
		t.Fatalf("cutoff with zero retention = %s, want %s (30d default)", f.gotBefore, want)
	}
}

func TestGeoSweeperSwallowsPurgeError(t *testing.T) {
	f := &fakeGeoPurger{err: errors.New("db down")}
	s := NewGeoSweeper(f, time.Hour, time.Hour, nil)
	// Must not panic; the goroutine survives to the next tick.
	s.sweepOnce(context.Background())
	if f.calls != 1 {
		t.Fatalf("purge calls = %d, want 1", f.calls)
	}
}
