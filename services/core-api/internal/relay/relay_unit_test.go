package relay

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/config"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
)

// These tests are Docker-free: they drive the drain loop's transient/poison/recovery branches
// with a fake store + fake broker, so the relay's correctness contract runs on the home box
// (no Docker), not only in CI. The end-to-end publish + dedup + late-seq paths against a real
// JetStream live in relay_test.go (testcontainers).

func testLogger() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

func testCfg() config.Config {
	return config.Config{
		RelayPollInterval: time.Second,
		RelayBatchSize:    100,
		RelayMaxAttempts:  3,
		RelayDupWindow:    2 * time.Minute,
	}
}

// --- fakes -----------------------------------------------------------------------------

type fakeRow struct {
	id        uuid.UUID
	eventType string
	payload   json.RawMessage
	status    string // pending | published | failed
	attempts  int32
}

type fakeStore struct {
	rows      []*fakeRow // in insertion (seq) order
	oldestAge int64      // reported OldestPendingAgeSeconds (fakeRow carries no created_at)
	statsErr  error      // injected OutboxStats failure
}

func (s *fakeStore) add(eventType string) *fakeRow {
	r := &fakeRow{id: uuid.New(), eventType: eventType, payload: json.RawMessage(`{"total":390000}`), status: "pending"}
	s.rows = append(s.rows, r)
	return r
}

func (s *fakeStore) find(id uuid.UUID) *fakeRow {
	for _, r := range s.rows {
		if r.id == id {
			return r
		}
	}
	return nil
}

func (s *fakeStore) SelectPendingOutbox(_ context.Context, limit int32) ([]sqlc.SelectPendingOutboxRow, error) {
	var out []sqlc.SelectPendingOutboxRow
	for _, r := range s.rows {
		if r.status != "pending" {
			continue
		}
		out = append(out, sqlc.SelectPendingOutboxRow{ID: r.id, EventType: r.eventType, Payload: r.payload, Attempts: r.attempts})
		if int32(len(out)) >= limit {
			break
		}
	}
	return out, nil
}

func (s *fakeStore) MarkOutboxPublished(_ context.Context, id uuid.UUID) error {
	s.find(id).status = "published"
	return nil
}
func (s *fakeStore) IncrementOutboxAttempts(_ context.Context, id uuid.UUID) error {
	s.find(id).attempts++
	return nil
}
func (s *fakeStore) MarkOutboxFailed(_ context.Context, id uuid.UUID) error {
	s.find(id).status = "failed"
	return nil
}

func (s *fakeStore) OutboxStats(_ context.Context) (sqlc.OutboxStatsRow, error) {
	if s.statsErr != nil {
		return sqlc.OutboxStatsRow{}, s.statsErr
	}
	var row sqlc.OutboxStatsRow
	for _, r := range s.rows {
		switch r.status {
		case "pending":
			row.Pending++
		case "failed":
			row.Failed++
		}
	}
	row.OldestPendingAgeSeconds = s.oldestAge
	return row, nil
}

type fakeBroker struct {
	reachable    bool
	publishErr   func(subject string) error // nil decision = ack
	panicSubject string                     // PublishMsg panics on this subject (recover test)
	published    []string                   // subjects that got a PubAck, in order
	ensureCalls  int
}

func (b *fakeBroker) Reachable() bool { return b.reachable }

func (b *fakeBroker) EnsureTopology(_ context.Context, _ time.Duration) error {
	b.ensureCalls++
	return nil
}

func (b *fakeBroker) PublishMsg(_ context.Context, msg *nats.Msg, _ ...jetstream.PublishOpt) (*jetstream.PubAck, error) {
	if b.panicSubject != "" && msg.Subject == b.panicSubject {
		panic("fakeBroker: injected publish panic")
	}
	if b.publishErr != nil {
		if err := b.publishErr(msg.Subject); err != nil {
			return nil, err
		}
	}
	b.published = append(b.published, msg.Subject)
	return &jetstream.PubAck{Stream: "ORDERS", Sequence: uint64(len(b.published))}, nil
}

// --- tests -----------------------------------------------------------------------------

func TestIsTransient(t *testing.T) {
	transient := []error{
		errBrokerDown,
		nats.ErrNoResponders,
		nats.ErrConnectionClosed,
		nats.ErrConnectionDraining,
		nats.ErrConnectionReconnecting,
		nats.ErrTimeout,
		jetstream.ErrNoStreamResponse,
		jetstream.ErrStreamNotFound,
		context.DeadlineExceeded,
		context.Canceled,
		fmt.Errorf("relay: publish %s: %w", "order.created", nats.ErrNoResponders), // wrapped still transient
	}
	for _, err := range transient {
		if !isTransient(err) {
			t.Errorf("isTransient(%v) = false, want true (transient outage must not burn attempts)", err)
		}
	}
	poison := []error{
		errors.New("maximum messages per subject exceeded"),
		errors.New("message size exceeds limits"),
		fmt.Errorf("rejected: %w", errors.New("invalid payload")),
	}
	for _, err := range poison {
		if isTransient(err) {
			t.Errorf("isTransient(%v) = true, want false (a real PubAck rejection must be quarantined)", err)
		}
	}
}

func TestDrainHappyPath(t *testing.T) {
	store := &fakeStore{}
	a := store.add("order.created")
	b := store.add("order.paid")
	broker := &fakeBroker{reachable: true}
	r := newRelay(store, broker, testCfg(), testLogger())

	r.drainOnce(context.Background())

	if a.status != "published" || b.status != "published" {
		t.Fatalf("rows not published: a=%s b=%s", a.status, b.status)
	}
	if len(broker.published) != 2 || broker.published[0] != "order.created" || broker.published[1] != "order.paid" {
		t.Fatalf("published subjects = %v, want [order.created order.paid]", broker.published)
	}
}

func TestDrainBrokerDownSkipsPublish(t *testing.T) {
	store := &fakeStore{}
	a := store.add("order.created")
	broker := &fakeBroker{reachable: false} // connection down
	r := newRelay(store, broker, testCfg(), testLogger())

	r.drainOnce(context.Background())

	if len(broker.published) != 0 {
		t.Fatalf("published %d msgs while broker down, want 0 (must not even attempt)", len(broker.published))
	}
	if a.status != "pending" || a.attempts != 0 {
		t.Fatalf("row mutated while broker down: status=%s attempts=%d, want pending/0", a.status, a.attempts)
	}
	if broker.ensureCalls != 0 {
		t.Fatalf("re-ensured topology %d× while broker unreachable, want 0", broker.ensureCalls)
	}
}

func TestDrainTransientLeavesBatchPendingNoAttempts(t *testing.T) {
	store := &fakeStore{}
	a := store.add("order.created")
	b := store.add("order.paid")
	// Reachable, but every publish reports the stream missing (no-responders → ErrNoStreamResponse).
	broker := &fakeBroker{reachable: true, publishErr: func(string) error { return jetstream.ErrNoStreamResponse }}
	r := newRelay(store, broker, testCfg(), testLogger())

	r.drainOnce(context.Background())

	if a.status != "pending" || b.status != "pending" {
		t.Fatalf("rows not left pending on transient failure: a=%s b=%s", a.status, b.status)
	}
	if a.attempts != 0 || b.attempts != 0 {
		t.Fatalf("attempts burned on transient failure: a=%d b=%d, want 0/0 (ADR-029)", a.attempts, b.attempts)
	}
	if broker.ensureCalls != 1 {
		t.Fatalf("topology re-ensure called %d×, want exactly 1 (recover the missing stream once, then back off)", broker.ensureCalls)
	}

	// Recovery: the stream now exists → the same pending batch drains on the next tick.
	broker.publishErr = nil
	r.drainOnce(context.Background())
	if a.status != "published" || b.status != "published" {
		t.Fatalf("rows did not drain on recovery: a=%s b=%s", a.status, b.status)
	}
}

func TestDrainPoisonQuarantinedAfterMaxAttempts(t *testing.T) {
	store := &fakeStore{}
	poison := store.add("order.created") // permanently rejected
	good := store.add("order.paid")      // must still publish — head-of-line not blocked
	broker := &fakeBroker{
		reachable: true,
		publishErr: func(subject string) error {
			if subject == "order.created" {
				return errors.New("permanent rejection") // non-transient → poison
			}
			return nil
		},
	}
	r := newRelay(store, broker, testCfg(), testLogger()) // RelayMaxAttempts = 3

	r.drainOnce(context.Background())
	// The good row publishes on the very first tick despite the poison row preceding it.
	if good.status != "published" {
		t.Fatalf("good row status = %s after tick 1, want published (poison must not block head-of-line)", good.status)
	}
	if poison.attempts != 1 || poison.status != "pending" {
		t.Fatalf("poison after tick 1: attempts=%d status=%s, want 1/pending", poison.attempts, poison.status)
	}

	r.drainOnce(context.Background())
	if poison.attempts != 2 || poison.status != "pending" {
		t.Fatalf("poison after tick 2: attempts=%d status=%s, want 2/pending", poison.attempts, poison.status)
	}

	r.drainOnce(context.Background())
	if poison.attempts != 3 || poison.status != "failed" {
		t.Fatalf("poison after tick 3: attempts=%d status=%s, want 3/failed (quarantined at RelayMaxAttempts)", poison.attempts, poison.status)
	}
}

// TestDrainPanicRecovered proves the documented safety net: a panic inside a tick (e.g. a relay
// bug) is recovered so the goroutine — and the shared core-api HTTP process — never crashes, and
// the loop keeps draining on the next tick. If the recover() in drainOnce were removed, the first
// drainOnce here would propagate the panic and fail the test.
func TestDrainPanicRecovered(t *testing.T) {
	store := &fakeStore{}
	store.add("order.created") // PublishMsg panics on this subject
	good := store.add("order.paid")
	broker := &fakeBroker{reachable: true, panicSubject: "order.created"}
	r := newRelay(store, broker, testCfg(), testLogger())

	r.drainOnce(context.Background()) // must NOT propagate the panic

	// Loop survives: with the panic cleared, the next tick drains the still-pending rows.
	broker.panicSubject = ""
	r.drainOnce(context.Background())
	if good.status != "published" {
		t.Fatalf("good row status = %s after a recovered panic, want published (loop must continue)", good.status)
	}
}

// TestNewRelayClampsNonPositiveKnobs guards the lifecycle fix: a non-positive poll/batch/maxAtt
// from a misconfigured env is clamped to a safe default, so Run()'s time.NewTicker can never
// panic (which, being outside drainOnce's recover, would crash the whole process).
func TestNewRelayClampsNonPositiveKnobs(t *testing.T) {
	cfg := config.Config{RelayPollInterval: 0, RelayBatchSize: 0, RelayMaxAttempts: -1, RelayDupWindow: time.Minute}
	r := newRelay(&fakeStore{}, &fakeBroker{}, cfg, testLogger())
	if r.poll <= 0 {
		t.Fatalf("poll = %v, want clamped > 0 (else time.NewTicker panics in Run)", r.poll)
	}
	if r.batch <= 0 {
		t.Fatalf("batch = %d, want clamped > 0 (else LIMIT 0 silently stops draining)", r.batch)
	}
	if r.maxAtt <= 0 {
		t.Fatalf("maxAtt = %d, want clamped > 0 (else first poison quarantines immediately)", r.maxAtt)
	}
}

// TestMaybeWarnUnhealthy pins the periodic-warning contract (ops/outbox-observability): a
// quarantined failed row (or a too-old pending backlog) keeps re-surfacing in the logs once per
// healthWarnInterval — never per tick (spam) and never only-once (silence forever).
func TestMaybeWarnUnhealthy(t *testing.T) {
	t0 := time.Now()

	t.Run("healthy outbox never warns", func(t *testing.T) {
		store := &fakeStore{}
		store.add("order.paid") // pending but fresh (oldestAge 0)
		r := newRelay(store, &fakeBroker{}, testCfg(), testLogger())
		if r.maybeWarnUnhealthy(context.Background(), t0) {
			t.Fatal("warned on a healthy outbox")
		}
	})

	t.Run("failed row warns, throttled, then warns again", func(t *testing.T) {
		store := &fakeStore{}
		store.add("order.paid").status = "failed"
		r := newRelay(store, &fakeBroker{}, testCfg(), testLogger())
		if !r.maybeWarnUnhealthy(context.Background(), t0) {
			t.Fatal("failed row present but no warning")
		}
		if r.maybeWarnUnhealthy(context.Background(), t0.Add(time.Second)) {
			t.Fatal("warned again inside the throttle window (spam)")
		}
		if !r.maybeWarnUnhealthy(context.Background(), t0.Add(healthWarnInterval+time.Second)) {
			t.Fatal("did not re-warn after the throttle window (poison went silent)")
		}
	})

	t.Run("stale pending backlog warns", func(t *testing.T) {
		store := &fakeStore{oldestAge: int64(staleAgeThreshold/time.Second) + 1}
		store.add("order.paid")
		r := newRelay(store, &fakeBroker{}, testCfg(), testLogger())
		if !r.maybeWarnUnhealthy(context.Background(), t0) {
			t.Fatal("stale pending backlog but no warning")
		}
	})

	t.Run("stats error does not warn and does not consume the throttle", func(t *testing.T) {
		store := &fakeStore{statsErr: errors.New("db down")}
		store.add("order.paid").status = "failed"
		r := newRelay(store, &fakeBroker{}, testCfg(), testLogger())
		if r.maybeWarnUnhealthy(context.Background(), t0) {
			t.Fatal("warned despite a stats read failure")
		}
		store.statsErr = nil
		if !r.maybeWarnUnhealthy(context.Background(), t0.Add(time.Second)) {
			t.Fatal("stats error must not consume the throttle window")
		}
	})
}
