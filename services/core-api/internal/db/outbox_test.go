package db

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/testcontainers/testcontainers-go/wait"
)

// --- pure unit (no Docker) -------------------------------------------------------------

func sampleEvent(eventType, dedupKey string) OutboxEvent {
	return OutboxEvent{
		ID:            uuid.New(),
		AggregateType: "order",
		AggregateID:   uuid.New(),
		EventType:     eventType,
		Payload:       json.RawMessage(`{"total":390000}`),
		DedupKey:      dedupKey,
	}
}

func TestOutboxEventValidate(t *testing.T) {
	if err := sampleEvent("order.created", "k").validate(); err != nil {
		t.Fatalf("valid event rejected: %v", err)
	}
	bad := map[string]func(OutboxEvent) OutboxEvent{
		"missing id":            func(e OutboxEvent) OutboxEvent { e.ID = uuid.Nil; return e },
		"missing aggregateType": func(e OutboxEvent) OutboxEvent { e.AggregateType = ""; return e },
		"missing aggregateID":   func(e OutboxEvent) OutboxEvent { e.AggregateID = uuid.Nil; return e },
		"missing eventType":     func(e OutboxEvent) OutboxEvent { e.EventType = ""; return e },
		"missing dedupKey":      func(e OutboxEvent) OutboxEvent { e.DedupKey = ""; return e },
		"empty payload":         func(e OutboxEvent) OutboxEvent { e.Payload = nil; return e },
		"invalid json payload":  func(e OutboxEvent) OutboxEvent { e.Payload = json.RawMessage(`{bad`); return e },
	}
	for name, mutate := range bad {
		t.Run(name, func(t *testing.T) {
			if err := mutate(sampleEvent("order.created", "k")).validate(); !errors.Is(err, ErrInvalidEvent) {
				t.Fatalf("validate(%s) err = %v, want ErrInvalidEvent", name, err)
			}
		})
	}
}

// --- integration (testcontainers; skips without a Docker provider) ---------------------

// skipWithoutDocker skips the test when no healthy Docker provider is available. It wraps
// testcontainers.SkipIfProviderIsNotHealthy in a recover because that helper PANICS (not
// t.Skip) when there is no Docker daemon at all — which is exactly the local-dev case here
// (the home box has no Docker). CI (ubuntu-latest) has Docker, so the integration tests run
// there for real (ADR-020).
func skipWithoutDocker(t *testing.T) {
	t.Helper()
	defer func() {
		if r := recover(); r != nil {
			t.Skipf("no healthy Docker provider, skipping integration test: %v", r)
		}
	}()
	testcontainers.SkipIfProviderIsNotHealthy(t)
}

// startPostgres boots a throwaway Postgres and applies every up-migration in order. It
// skips the test cleanly when no Docker provider is available (e.g. local dev without a
// Docker daemon); CI runs it for real (ADR-020).
func startPostgres(t *testing.T) *pgxpool.Pool {
	t.Helper()
	skipWithoutDocker(t)
	ctx := context.Background()
	ctr, err := postgres.Run(ctx, "postgres:16-alpine",
		postgres.WithDatabase("lumin_test"),
		postgres.WithUsername("lumin"),
		postgres.WithPassword("lumin"),
		testcontainers.WithWaitStrategy(
			wait.ForLog("database system is ready to accept connections").
				WithOccurrence(2).WithStartupTimeout(60*time.Second)),
	)
	if err != nil {
		t.Fatalf("start postgres container: %v", err)
	}
	t.Cleanup(func() { _ = ctr.Terminate(context.Background()) })

	dsn, err := ctr.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		t.Fatalf("connection string: %v", err)
	}
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("open pool: %v", err)
	}
	t.Cleanup(pool.Close)
	applyMigrations(t, ctx, pool, ".up.sql", false)
	return pool
}

// applyMigrations execs every db/migrations/*<suffix> in filename order (reversed for
// downs). A tiny in-test SQL applier (no golang-migrate import — decision D4) keeps pgx
// the only DB dependency.
func applyMigrations(t *testing.T, ctx context.Context, pool *pgxpool.Pool, suffix string, reverse bool) {
	t.Helper()
	files, err := filepath.Glob(filepath.Join("..", "..", "db", "migrations", "*"+suffix))
	if err != nil {
		t.Fatalf("glob migrations: %v", err)
	}
	sort.Strings(files)
	if reverse {
		for i, j := 0, len(files)-1; i < j; i, j = i+1, j-1 {
			files[i], files[j] = files[j], files[i]
		}
	}
	for _, f := range files {
		stmts, err := os.ReadFile(f)
		if err != nil {
			t.Fatalf("read %s: %v", f, err)
		}
		if _, err := pool.Exec(ctx, string(stmts)); err != nil {
			t.Fatalf("apply %s: %v", filepath.Base(f), err)
		}
	}
}

func countRows(t *testing.T, ctx context.Context, pool *pgxpool.Pool, sql string, args ...any) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(ctx, sql, args...).Scan(&n); err != nil {
		t.Fatalf("count query: %v", err)
	}
	return n
}

// The outbox write is part of the caller's transaction: roll back and the event is gone;
// commit and exactly one row lands; a duplicate dedup_key is rejected by the UNIQUE
// constraint — the publish-on-commit / no-dual-write contract, proven without NATS.
func TestOutboxTransactionalAtomicity(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()

	t.Run("rollback leaves no row", func(t *testing.T) {
		tx, err := pool.Begin(ctx)
		if err != nil {
			t.Fatalf("begin: %v", err)
		}
		if err := EnqueueOutbox(ctx, tx, sampleEvent("order.created", "dk-rollback")); err != nil {
			t.Fatalf("enqueue: %v", err)
		}
		if err := tx.Rollback(ctx); err != nil {
			t.Fatalf("rollback: %v", err)
		}
		// Filter by this subtest's own dedup_key so the assertion is self-contained and
		// independent of subtest order (other subtests commit their own rows).
		if n := countRows(t, ctx, pool, `SELECT count(*) FROM outbox WHERE dedup_key=$1`, "dk-rollback"); n != 0 {
			t.Fatalf("after rollback outbox rows = %d, want 0", n)
		}
	})

	t.Run("commit leaves exactly one", func(t *testing.T) {
		tx, err := pool.Begin(ctx)
		if err != nil {
			t.Fatalf("begin: %v", err)
		}
		if err := EnqueueOutbox(ctx, tx, sampleEvent("order.paid", "dk-commit")); err != nil {
			t.Fatalf("enqueue: %v", err)
		}
		if err := tx.Commit(ctx); err != nil {
			t.Fatalf("commit: %v", err)
		}
		if n := countRows(t, ctx, pool, `SELECT count(*) FROM outbox WHERE dedup_key=$1`, "dk-commit"); n != 1 {
			t.Fatalf("after commit rows = %d, want 1", n)
		}
	})

	t.Run("duplicate dedup_key rejected", func(t *testing.T) {
		ev := sampleEvent("order.paid", "dk-dup")
		tx1, err := pool.Begin(ctx)
		if err != nil {
			t.Fatalf("begin: %v", err)
		}
		if err := EnqueueOutbox(ctx, tx1, ev); err != nil {
			t.Fatalf("first enqueue: %v", err)
		}
		if err := tx1.Commit(ctx); err != nil {
			t.Fatalf("commit: %v", err)
		}
		dup := ev
		dup.ID = uuid.New() // different row id, same logical event
		tx2, err := pool.Begin(ctx)
		if err != nil {
			t.Fatalf("begin: %v", err)
		}
		err = EnqueueOutbox(ctx, tx2, dup)
		_ = tx2.Rollback(ctx)
		if err == nil {
			t.Fatal("duplicate dedup_key must be rejected by the UNIQUE constraint")
		}
	})
}

// Every up migration must reverse cleanly: apply all up, apply all down in reverse, assert
// the public schema is empty (no leftover tables or enum types), then re-apply up to prove
// re-runnability against a throwaway DB.
func TestMigrationsReversible(t *testing.T) {
	pool := startPostgres(t) // applies all up
	ctx := context.Background()

	applyMigrations(t, ctx, pool, ".down.sql", true)

	if n := countRows(t, ctx, pool, `SELECT count(*) FROM information_schema.tables WHERE table_schema='public'`); n != 0 {
		t.Fatalf("after all downs, %d tables remain, want 0", n)
	}
	enumQ := `SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typtype='e'`
	if n := countRows(t, ctx, pool, enumQ); n != 0 {
		t.Fatalf("after all downs, %d enum types remain, want 0", n)
	}

	applyMigrations(t, ctx, pool, ".up.sql", false) // re-runnable
}

// Outbox observability queries (ops/outbox-observability): OutboxStats counts pending/failed
// (the uptime-kuma alarm feed — a failed row is a lost event until requeued) and reports the
// oldest pending age; RequeueFailedOutbox flips failed→pending with attempts reset so the relay
// retries with a full budget, touching nothing else.
func TestOutboxStatsAndRequeue(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()
	q := sqlc.New(pool)

	insert := func(dedup, status string, attempts int32) uuid.UUID {
		ev := sampleEvent("order.paid", dedup)
		tx, err := pool.Begin(ctx)
		if err != nil {
			t.Fatalf("begin: %v", err)
		}
		if err := EnqueueOutbox(ctx, tx, ev); err != nil {
			t.Fatalf("enqueue: %v", err)
		}
		if err := tx.Commit(ctx); err != nil {
			t.Fatalf("commit: %v", err)
		}
		if _, err := pool.Exec(ctx, `UPDATE outbox SET status=$1, attempts=$2 WHERE id=$3`, status, attempts, ev.ID); err != nil {
			t.Fatalf("set status: %v", err)
		}
		return ev.ID
	}
	insert("obs-pending", "pending", 0)
	insert("obs-published", "published", 1)
	failedID := insert("obs-failed", "failed", 5)

	stats, err := q.OutboxStats(ctx)
	if err != nil {
		t.Fatalf("OutboxStats: %v", err)
	}
	if stats.Pending != 1 || stats.Failed != 1 {
		t.Fatalf("stats = %+v, want pending=1 failed=1", stats)
	}
	if stats.OldestPendingAgeSeconds < 0 {
		t.Fatalf("oldest pending age = %d, want >= 0", stats.OldestPendingAgeSeconds)
	}

	n, err := q.RequeueFailedOutbox(ctx)
	if err != nil {
		t.Fatalf("RequeueFailedOutbox: %v", err)
	}
	if n != 1 {
		t.Fatalf("requeued %d rows, want 1", n)
	}
	var status string
	var attempts int32
	if err := pool.QueryRow(ctx, `SELECT status, attempts FROM outbox WHERE id=$1`, failedID).Scan(&status, &attempts); err != nil {
		t.Fatalf("read requeued row: %v", err)
	}
	if status != "pending" || attempts != 0 {
		t.Fatalf("requeued row = %s/%d, want pending/0 (full retry budget)", status, attempts)
	}
	// Published rows are untouched; a second sweep is an idempotent no-op.
	if c := countRows(t, ctx, pool, `SELECT count(*) FROM outbox WHERE status='published'`); c != 1 {
		t.Fatalf("published rows = %d after requeue, want 1 (untouched)", c)
	}
	if n, err := q.RequeueFailedOutbox(ctx); err != nil || n != 0 {
		t.Fatalf("second requeue = (%d, %v), want (0, nil)", n, err)
	}

	// Empty table: age reports 0, not NULL/error (uptime-kuma parses plain JSON numbers).
	if _, err := pool.Exec(ctx, `DELETE FROM outbox`); err != nil {
		t.Fatalf("truncate: %v", err)
	}
	stats, err = q.OutboxStats(ctx)
	if err != nil {
		t.Fatalf("OutboxStats empty: %v", err)
	}
	if stats.Pending != 0 || stats.Failed != 0 || stats.OldestPendingAgeSeconds != 0 {
		t.Fatalf("empty stats = %+v, want all zeros", stats)
	}
}
