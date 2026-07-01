package httpapi

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5"
)

// fakeTx records Commit/Rollback calls. It embeds pgx.Tx (nil) so it satisfies the
// interface while only the two methods withTx actually calls are implemented — any other
// call would panic, catching an accidental use of the pool inside a unit test.
type fakeTx struct {
	pgx.Tx
	commits   int
	rollbacks int
	commitErr error
}

func (f *fakeTx) Commit(context.Context) error   { f.commits++; return f.commitErr }
func (f *fakeTx) Rollback(context.Context) error { f.rollbacks++; return nil }

// fakeBeginner hands out a single fakeTx (or fails to begin).
type fakeBeginner struct {
	tx       *fakeTx
	beginErr error
}

func (f *fakeBeginner) Begin(context.Context) (pgx.Tx, error) {
	if f.beginErr != nil {
		return nil, f.beginErr
	}
	return f.tx, nil
}

func TestWithTxCommitsOnSuccess(t *testing.T) {
	tx := &fakeTx{}
	err := withTx(context.Background(), &fakeBeginner{tx: tx}, func(pgx.Tx) error { return nil })
	if err != nil {
		t.Fatalf("withTx err = %v, want nil", err)
	}
	if tx.commits != 1 || tx.rollbacks != 0 {
		t.Fatalf("commits=%d rollbacks=%d, want 1/0", tx.commits, tx.rollbacks)
	}
}

func TestWithTxRollsBackOnError(t *testing.T) {
	tx := &fakeTx{}
	sentinel := errors.New("fn failed")
	err := withTx(context.Background(), &fakeBeginner{tx: tx}, func(pgx.Tx) error { return sentinel })
	if !errors.Is(err, sentinel) {
		t.Fatalf("withTx err = %v, want the fn error", err)
	}
	if tx.commits != 0 || tx.rollbacks != 1 {
		t.Fatalf("commits=%d rollbacks=%d, want 0/1", tx.commits, tx.rollbacks)
	}
}

func TestWithTxReturnsBeginError(t *testing.T) {
	beginErr := errors.New("pool exhausted")
	err := withTx(context.Background(), &fakeBeginner{beginErr: beginErr}, func(pgx.Tx) error {
		t.Fatal("fn must not run when Begin fails")
		return nil
	})
	if !errors.Is(err, beginErr) {
		t.Fatalf("withTx err = %v, want the begin error", err)
	}
}

func TestWithTxRollsBackAndRepanicsOnPanic(t *testing.T) {
	tx := &fakeTx{}
	defer func() {
		if p := recover(); p == nil {
			t.Fatal("withTx swallowed the panic, want it re-raised")
		}
		if tx.commits != 0 || tx.rollbacks != 1 {
			t.Fatalf("commits=%d rollbacks=%d, want 0/1 (rolled back before re-panic)", tx.commits, tx.rollbacks)
		}
	}()
	_ = withTx(context.Background(), &fakeBeginner{tx: tx}, func(pgx.Tx) error { panic("boom") })
}

// A Commit failure must surface as the returned error, and the deferred cleanup issues a
// (harmless) Rollback — the row was never durably committed.
func TestWithTxReturnsCommitError(t *testing.T) {
	commitErr := errors.New("commit conflict")
	tx := &fakeTx{commitErr: commitErr}
	err := withTx(context.Background(), &fakeBeginner{tx: tx}, func(pgx.Tx) error { return nil })
	if !errors.Is(err, commitErr) {
		t.Fatalf("withTx err = %v, want the commit error", err)
	}
	if tx.commits != 1 || tx.rollbacks != 1 {
		t.Fatalf("commits=%d rollbacks=%d, want 1/1", tx.commits, tx.rollbacks)
	}
}
