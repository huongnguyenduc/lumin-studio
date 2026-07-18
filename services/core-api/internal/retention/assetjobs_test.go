package retention

import (
	"context"
	"errors"
	"testing"
	"time"
)

type fakeStuckFailer struct {
	gotBefore time.Time
	calls     int
	swept     int64
	err       error
}

func (f *fakeStuckFailer) FailStuckProcessing(ctx context.Context, before time.Time) (int64, error) {
	f.calls++
	f.gotBefore = before
	return f.swept, f.err
}

func TestAssetJobSweeperCutoffIsNowMinusStuckAfter(t *testing.T) {
	f := &fakeStuckFailer{swept: 2}
	now := time.Date(2026, 7, 18, 12, 0, 0, 0, time.UTC)
	s := NewAssetJobSweeper(f, 2*time.Hour, time.Minute, nil)
	s.now = func() time.Time { return now }

	s.sweepOnce(context.Background())

	if f.calls != 1 {
		t.Fatalf("sweep calls = %d, want 1", f.calls)
	}
	want := now.Add(-2 * time.Hour)
	if !f.gotBefore.Equal(want) {
		t.Fatalf("cutoff = %s, want %s (now - stuckAfter)", f.gotBefore, want)
	}
}

// A non-positive window must fall back to the 2h default, NOT collapse to "now" — which would fail every
// job the moment it enters 'processing'. Guards the misconfigured-env footgun.
func TestNewAssetJobSweeperDefaultsGuardBadConfig(t *testing.T) {
	f := &fakeStuckFailer{}
	now := time.Date(2026, 7, 18, 0, 0, 0, 0, time.UTC)
	s := NewAssetJobSweeper(f, 0, 0, nil)
	s.now = func() time.Time { return now }

	s.sweepOnce(context.Background())

	want := now.Add(-2 * time.Hour)
	if !f.gotBefore.Equal(want) {
		t.Fatalf("cutoff with zero stuckAfter = %s, want %s (2h default)", f.gotBefore, want)
	}
}

func TestAssetJobSweeperSwallowsSweepError(t *testing.T) {
	f := &fakeStuckFailer{err: errors.New("db down")}
	s := NewAssetJobSweeper(f, time.Hour, time.Hour, nil)
	// Must not panic; the goroutine survives to the next tick.
	s.sweepOnce(context.Background())
	if f.calls != 1 {
		t.Fatalf("sweep calls = %d, want 1", f.calls)
	}
}
