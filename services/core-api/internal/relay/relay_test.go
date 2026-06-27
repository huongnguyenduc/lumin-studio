package relay

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/testcontainers/testcontainers-go/wait"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/config"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/natsx"
)

// These integration tests boot a real Postgres + a real NATS/JetStream via testcontainers and
// drive the relay's drain loop directly. They prove the four invariants prose alone can't: the
// pending→published happy path, the late-committing-low-seq regression (the silent-loss hazard
// a watermark cursor would reintroduce), the no-stream transient → drain-on-recovery path, and
// Nats-Msg-Id dedup collapsing a crash-after-PubAck republish. They skip cleanly without Docker
// (the home box has none) and run for real in CI (ADR-020). Docker-free branch coverage is in
// relay_unit_test.go.

// skipWithoutDocker skips when no healthy Docker provider is available. It wraps
// testcontainers.SkipIfProviderIsNotHealthy in a recover because that helper PANICS (not
// t.Skip) with no Docker daemon — the local-dev case. Mirrors the internal/db + internal/natsx
// helpers of the same name.
func skipWithoutDocker(t *testing.T) {
	t.Helper()
	defer func() {
		if r := recover(); r != nil {
			t.Skipf("no healthy Docker provider, skipping integration test: %v", r)
		}
	}()
	testcontainers.SkipIfProviderIsNotHealthy(t)
}

// startPostgres boots a throwaway Postgres and applies every up-migration in order.
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

	// Tiny in-test SQL applier (no golang-migrate import — mirrors internal/db; pgx stays the
	// only DB dependency). From internal/relay, db/migrations is ../../db/migrations.
	files, err := filepath.Glob(filepath.Join("..", "..", "db", "migrations", "*.up.sql"))
	if err != nil {
		t.Fatalf("glob migrations: %v", err)
	}
	sort.Strings(files)
	for _, f := range files {
		stmts, err := os.ReadFile(f)
		if err != nil {
			t.Fatalf("read %s: %v", f, err)
		}
		if _, err := pool.Exec(ctx, string(stmts)); err != nil {
			t.Fatalf("apply %s: %v", filepath.Base(f), err)
		}
	}
	return pool
}

// startNATS boots a throwaway NATS server with JetStream and returns a connected *natsx.Conn.
func startNATS(t *testing.T) *natsx.Conn {
	t.Helper()
	skipWithoutDocker(t)
	ctx := context.Background()
	ctr, err := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{
		ContainerRequest: testcontainers.ContainerRequest{
			Image:        "nats:2.10-alpine",
			Cmd:          []string{"-js"},
			ExposedPorts: []string{"4222/tcp"},
			WaitingFor:   wait.ForLog("Server is ready").WithStartupTimeout(60 * time.Second),
		},
		Started: true,
	})
	if err != nil {
		t.Fatalf("start nats container: %v", err)
	}
	t.Cleanup(func() { _ = ctr.Terminate(context.Background()) })

	host, err := ctr.Host(ctx)
	if err != nil {
		t.Fatalf("container host: %v", err)
	}
	port, err := ctr.MappedPort(ctx, "4222")
	if err != nil {
		t.Fatalf("mapped port: %v", err)
	}
	nc, err := natsx.Connect(config.Config{NATSURL: fmt.Sprintf("nats://%s:%s", host, port.Port())})
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(nc.Close)

	deadline := time.Now().Add(5 * time.Second)
	for !nc.Reachable() && time.Now().Before(deadline) {
		time.Sleep(20 * time.Millisecond)
	}
	if !nc.Reachable() {
		t.Fatal("never reached a connected state against an up broker")
	}
	return nc
}

func sampleEvent(eventType, dedupKey string) db.OutboxEvent {
	return db.OutboxEvent{
		ID:            uuid.New(),
		AggregateType: "order",
		AggregateID:   uuid.New(),
		EventType:     eventType,
		Payload:       json.RawMessage(`{"total":390000}`),
		DedupKey:      dedupKey,
	}
}

// mustEnqueue commits one outbox row through the production EnqueueOutbox seam (begin → enqueue
// → commit), so the relay sees a genuine committed `pending` row.
func mustEnqueue(t *testing.T, pool *pgxpool.Pool, ev db.OutboxEvent) {
	t.Helper()
	ctx := context.Background()
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	if err := db.EnqueueOutbox(ctx, tx, ev); err != nil {
		t.Fatalf("enqueue: %v", err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("commit: %v", err)
	}
}

func outboxRow(t *testing.T, pool *pgxpool.Pool, id uuid.UUID) (status string, attempts int32) {
	t.Helper()
	if err := pool.QueryRow(context.Background(),
		`SELECT status, attempts FROM outbox WHERE id=$1`, id).Scan(&status, &attempts); err != nil {
		t.Fatalf("read outbox row %s: %v", id, err)
	}
	return status, attempts
}

// TestRelayDrainsPendingToStream — the publish-on-commit happy path: committed pending rows are
// published in seq order, marked published, and land in the ORDERS stream carrying the literal
// event_type subject + Nats-Msg-Id = outbox.id (ADR-029).
func TestRelayDrainsPendingToStream(t *testing.T) {
	pool := startPostgres(t)
	nc := startNATS(t)
	ctx := context.Background()
	if err := nc.EnsureTopology(ctx, 2*time.Minute); err != nil {
		t.Fatalf("ensure topology: %v", err)
	}

	ev1 := sampleEvent("order.created", "dk-1")
	ev2 := sampleEvent("order.paid", "dk-2")
	mustEnqueue(t, pool, ev1)
	mustEnqueue(t, pool, ev2)

	New(pool, nc, testCfg(), testLogger()).drainOnce(ctx)

	for _, ev := range []db.OutboxEvent{ev1, ev2} {
		if s, _ := outboxRow(t, pool, ev.ID); s != "published" {
			t.Fatalf("row %s status = %s, want published", ev.EventType, s)
		}
	}

	stream, err := nc.JS.Stream(ctx, "ORDERS")
	if err != nil {
		t.Fatalf("ORDERS stream: %v", err)
	}
	info, err := stream.Info(ctx)
	if err != nil {
		t.Fatalf("stream info: %v", err)
	}
	if info.State.Msgs != 2 {
		t.Fatalf("ORDERS msgs = %d, want 2", info.State.Msgs)
	}
	// seq 1 = ev1 (enqueued first → lower outbox seq → published first), seq 2 = ev2.
	want := []db.OutboxEvent{ev1, ev2}
	for i, ev := range want {
		m, err := stream.GetMsg(ctx, uint64(i+1))
		if err != nil {
			t.Fatalf("get stream msg %d: %v", i+1, err)
		}
		if m.Subject != ev.EventType {
			t.Fatalf("stream msg %d subject = %q, want %q (literal event_type subject)", i+1, m.Subject, ev.EventType)
		}
		if got := m.Header.Get("Nats-Msg-Id"); got != ev.ID.String() {
			t.Fatalf("stream msg %d Nats-Msg-Id = %q, want %q (outbox.id)", i+1, got, ev.ID.String())
		}
	}
}

// TestRelayLateLowSeqDrains — the regression that justifies scan-the-pending-SET over a
// watermark cursor (ADR-029). A lower-seq tx that commits AFTER a higher-seq tx already drained
// must still be published; a `seq > watermark` cursor parked at the higher seq would skip it
// forever = silent money-event loss.
func TestRelayLateLowSeqDrains(t *testing.T) {
	pool := startPostgres(t)
	nc := startNATS(t)
	ctx := context.Background()
	if err := nc.EnsureTopology(ctx, 2*time.Minute); err != nil {
		t.Fatalf("ensure topology: %v", err)
	}
	r := New(pool, nc, testCfg(), testLogger())

	evLow := sampleEvent("order.created", "dk-low")   // inserted first → LOWER seq
	evHigh := sampleEvent("order.created", "dk-high") // inserted second → HIGHER seq

	// txA inserts the low-seq row but stays OPEN (uncommitted, invisible to the relay).
	txA, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin A: %v", err)
	}
	if err := db.EnqueueOutbox(ctx, txA, evLow); err != nil {
		t.Fatalf("enqueue low: %v", err)
	}
	// txB inserts the higher-seq row and COMMITS first.
	txB, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin B: %v", err)
	}
	if err := db.EnqueueOutbox(ctx, txB, evHigh); err != nil {
		t.Fatalf("enqueue high: %v", err)
	}
	if err := txB.Commit(ctx); err != nil {
		t.Fatalf("commit B: %v", err)
	}

	// Drain: only evHigh is visible (evLow uncommitted) → evHigh publishes.
	r.drainOnce(ctx)
	if s, _ := outboxRow(t, pool, evHigh.ID); s != "published" {
		t.Fatalf("evHigh status = %s, want published", s)
	}

	// NOW commit the low-seq row, AFTER the higher-seq row already published.
	if err := txA.Commit(ctx); err != nil {
		t.Fatalf("commit A (late): %v", err)
	}
	// scan-the-pending-SET drains the late low-seq row; a watermark would have lost it.
	r.drainOnce(ctx)
	if s, _ := outboxRow(t, pool, evLow.ID); s != "published" {
		t.Fatalf("LATE low-seq row status = %s, want published — watermark-loss regression (ADR-029)", s)
	}
}

// TestRelayNoStreamTransientThenRecovers — NATS up but the streams were never provisioned
// (down-at-boot). The first tick hits a no-stream failure: it must be TRANSIENT — the row stays
// pending with attempts==0 (no quarantine of a good money event), and the relay re-ensures the
// missing stream inline so the next tick drains it.
func TestRelayNoStreamTransientThenRecovers(t *testing.T) {
	pool := startPostgres(t)
	nc := startNATS(t)
	ctx := context.Background()
	// Deliberately NO EnsureTopology — the streams are missing.
	r := New(pool, nc, testCfg(), testLogger())

	ev := sampleEvent("order.created", "dk-recover")
	mustEnqueue(t, pool, ev)

	r.drainOnce(ctx) // publish → no stream → transient
	if s, att := outboxRow(t, pool, ev.ID); s != "pending" || att != 0 {
		t.Fatalf("after no-stream tick: status=%s attempts=%d, want pending/0 (transient must not burn attempts)", s, att)
	}
	// onTransient re-ensured the missing stream inline.
	if _, err := nc.JS.Stream(ctx, "ORDERS"); err != nil {
		t.Fatalf("ORDERS stream not re-ensured inline after no-stream failure: %v", err)
	}

	r.drainOnce(ctx) // stream now exists → drains
	if s, _ := outboxRow(t, pool, ev.ID); s != "published" {
		t.Fatalf("row did not drain on recovery: status=%s", s)
	}
}

// TestRelayDedupCollapsesRepublish — the crash-after-PubAck-before-mark case. A row that already
// published but got forced back to pending republishes with the SAME Nats-Msg-Id; JetStream's
// duplicate window collapses it, so the stream never doubles (at-least-once → effectively-once).
func TestRelayDedupCollapsesRepublish(t *testing.T) {
	pool := startPostgres(t)
	nc := startNATS(t)
	ctx := context.Background()
	if err := nc.EnsureTopology(ctx, 2*time.Minute); err != nil {
		t.Fatalf("ensure topology: %v", err)
	}
	r := New(pool, nc, testCfg(), testLogger())

	ev := sampleEvent("order.created", "dk-dedup")
	mustEnqueue(t, pool, ev)
	r.drainOnce(ctx) // publishes once, marks published

	// Simulate a crash after PubAck but before MarkOutboxPublished: the row is still pending.
	if _, err := pool.Exec(ctx, `UPDATE outbox SET status='pending', published_at=NULL WHERE id=$1`, ev.ID); err != nil {
		t.Fatalf("reset row to pending: %v", err)
	}
	r.drainOnce(ctx) // republish SAME Nats-Msg-Id within the duplicate window

	stream, err := nc.JS.Stream(ctx, "ORDERS")
	if err != nil {
		t.Fatalf("ORDERS stream: %v", err)
	}
	info, err := stream.Info(ctx)
	if err != nil {
		t.Fatalf("stream info: %v", err)
	}
	if info.State.Msgs != 1 {
		t.Fatalf("ORDERS msgs = %d after republish, want 1 (Nats-Msg-Id dedup within window)", info.State.Msgs)
	}
}
