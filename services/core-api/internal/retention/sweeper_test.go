package retention

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
)

type fakeOrders struct {
	rows      []sqlc.ListPurgeableProofOrdersRow
	listErr   error
	cleared   []uuid.UUID
	clearErr  map[uuid.UUID]error
	gotBefore time.Time
	gotLimit  int32
	listCalls int
}

func (f *fakeOrders) PurgeableProofOrders(ctx context.Context, before time.Time, limit int32) ([]sqlc.ListPurgeableProofOrdersRow, error) {
	f.listCalls++
	f.gotBefore, f.gotLimit = before, limit
	if f.listErr != nil {
		return nil, f.listErr
	}
	return f.rows, nil
}

func (f *fakeOrders) ClearPaymentProof(ctx context.Context, id uuid.UUID) error {
	if err := f.clearErr[id]; err != nil {
		return err
	}
	f.cleared = append(f.cleared, id)
	return nil
}

type fakeDeleter struct {
	deleted  []string
	failURLs map[string]error
	notOwned map[string]bool
}

func (f *fakeDeleter) Delete(ctx context.Context, finalURL string) (bool, error) {
	if err := f.failURLs[finalURL]; err != nil {
		return false, err
	}
	if f.notOwned[finalURL] {
		return false, nil
	}
	f.deleted = append(f.deleted, finalURL)
	return true, nil
}

func strptr(s string) *string { return &s }

func row(id uuid.UUID, url *string) sqlc.ListPurgeableProofOrdersRow {
	return sqlc.ListPurgeableProofOrdersRow{ID: id, PaymentProofUrl: url}
}

func newSweeper(orders proofOrders, store objectDeleter) *Sweeper {
	s := New(orders, store, 90*24*time.Hour, time.Hour, nil)
	s.now = func() time.Time { return time.Date(2026, 7, 9, 0, 0, 0, 0, time.UTC) }
	return s
}

func TestSweepDeletesObjectThenClearsReference(t *testing.T) {
	id1, id2 := uuid.New(), uuid.New()
	u1, u2 := "https://assets/x/1.jpg", "https://assets/x/2.jpg"
	orders := &fakeOrders{rows: []sqlc.ListPurgeableProofOrdersRow{row(id1, strptr(u1)), row(id2, strptr(u2))}}
	deleter := &fakeDeleter{}
	s := newSweeper(orders, deleter)

	s.sweepOnce(context.Background())

	if len(deleter.deleted) != 2 || len(orders.cleared) != 2 {
		t.Fatalf("deleted=%v cleared=%v, want both objects deleted then cleared", deleter.deleted, orders.cleared)
	}
	// cutoff is now - retention (terminal-transition anchor), and the scan is bounded by the batch.
	wantCutoff := time.Date(2026, 7, 9, 0, 0, 0, 0, time.UTC).Add(-90 * 24 * time.Hour)
	if !orders.gotBefore.Equal(wantCutoff) {
		t.Fatalf("cutoff = %s, want %s", orders.gotBefore, wantCutoff)
	}
	if orders.gotLimit != int32(defaultBatch) {
		t.Fatalf("limit = %d, want %d", orders.gotLimit, defaultBatch)
	}
}

func TestSweepKeepsReferenceWhenObjectDeleteFails(t *testing.T) {
	id := uuid.New()
	u := "https://assets/x/boom.jpg"
	orders := &fakeOrders{rows: []sqlc.ListPurgeableProofOrdersRow{row(id, strptr(u))}}
	deleter := &fakeDeleter{failURLs: map[string]error{u: errors.New("garage down")}}
	s := newSweeper(orders, deleter)

	s.sweepOnce(context.Background())

	if len(orders.cleared) != 0 {
		t.Fatalf("cleared=%v, want the reference KEPT when the object delete fails (retry next sweep)", orders.cleared)
	}
}

func TestSweepClearsReferenceEvenWhenObjectNotOwned(t *testing.T) {
	// A stored URL the store does not manage (e.g. legacy/foreign) still gets its DB reference nulled
	// after retention — there is simply no object of ours to delete.
	id := uuid.New()
	u := "https://foreign/x/1.jpg"
	orders := &fakeOrders{rows: []sqlc.ListPurgeableProofOrdersRow{row(id, strptr(u))}}
	deleter := &fakeDeleter{notOwned: map[string]bool{u: true}}
	s := newSweeper(orders, deleter)

	s.sweepOnce(context.Background())

	if len(deleter.deleted) != 0 || len(orders.cleared) != 1 {
		t.Fatalf("deleted=%v cleared=%v, want no object delete but the reference cleared", deleter.deleted, orders.cleared)
	}
}

func TestSweepSkipsNilProof(t *testing.T) {
	id := uuid.New()
	orders := &fakeOrders{rows: []sqlc.ListPurgeableProofOrdersRow{row(id, nil)}}
	deleter := &fakeDeleter{}
	s := newSweeper(orders, deleter)

	s.sweepOnce(context.Background())

	if len(deleter.deleted) != 0 || len(orders.cleared) != 0 {
		t.Fatalf("deleted=%v cleared=%v, want a nil proof skipped", deleter.deleted, orders.cleared)
	}
}

func TestSweepListErrorIsNoop(t *testing.T) {
	orders := &fakeOrders{listErr: errors.New("db down")}
	deleter := &fakeDeleter{}
	s := newSweeper(orders, deleter)

	s.sweepOnce(context.Background()) // must not panic

	if len(deleter.deleted) != 0 || len(orders.cleared) != 0 {
		t.Fatalf("a list error must be a no-op; deleted=%v cleared=%v", deleter.deleted, orders.cleared)
	}
}

func TestNewClampsNonPositiveConfig(t *testing.T) {
	s := New(&fakeOrders{}, &fakeDeleter{}, 0, 0, nil)
	if s.retention != 90*24*time.Hour {
		t.Fatalf("retention = %s, want 90d default when non-positive", s.retention)
	}
	if s.interval != 6*time.Hour {
		t.Fatalf("interval = %s, want 6h default when non-positive", s.interval)
	}
}
