// Package relay drains the transactional outbox to NATS JetStream — the publish-on-commit
// half of the dual-write-avoidance spine (ADR-006/ADR-029). Domain code commits a `pending`
// outbox row inside its own tx (db.EnqueueOutbox is the ONLY writer); this relay is the ONLY
// reader of those committed rows. One in-process goroutine, single instance (ADR-009): no
// separate binary, no advisory lock, no leader election — durability lives in the committed
// rows, so a crash loses nothing (restart re-scans WHERE status='pending').
//
// Each tick scans the WHOLE pending SET in seq order (never a seq>watermark cursor, never
// SKIP LOCKED — see SelectPendingOutbox), publishes each row, awaits its PubAck, then marks it
// published. A transient failure (broker down / stream missing) leaves the batch pending
// without burning attempts and re-ensures topology; a poison row (a per-message PubAck
// rejection) is counted and quarantined as `failed` after RelayMaxAttempts so it never blocks
// later rows. A recover() wrapper keeps a relay bug off the shared HTTP server.
package relay

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/config"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
)

// broker is the slice of *natsx.Conn the relay needs. Kept as an interface so a fake can drive
// the transient/poison branches deterministically in Docker-free unit tests (the integration
// tests use a real *natsx.Conn against a NATS testcontainer).
type broker interface {
	PublishMsg(ctx context.Context, msg *nats.Msg, opts ...jetstream.PublishOpt) (*jetstream.PubAck, error)
	Reachable() bool
	EnsureTopology(ctx context.Context, dupWindow time.Duration) error
}

// store is the slice of *sqlc.Queries the relay needs (interfaced for the same reason).
type store interface {
	SelectPendingOutbox(ctx context.Context, limit int32) ([]sqlc.SelectPendingOutboxRow, error)
	MarkOutboxPublished(ctx context.Context, id uuid.UUID) error
	IncrementOutboxAttempts(ctx context.Context, id uuid.UUID) error
	MarkOutboxFailed(ctx context.Context, id uuid.UUID) error
}

// errBrokerDown marks a tick skipped because the connection is down — a transient cause the
// drain loop classifies WITHOUT attempting a publish (so it never burns a ctx timeout per row
// while NATS is down).
var errBrokerDown = errors.New("relay: broker not reachable")

// Relay is the in-process outbox→NATS drainer.
type Relay struct {
	store     store
	broker    broker
	log       *slog.Logger
	poll      time.Duration
	batch     int32
	maxAtt    int32
	dupWindow time.Duration
}

// New builds a relay over the live pool + NATS connection. *natsx.Conn satisfies broker.
func New(pool *pgxpool.Pool, b broker, cfg config.Config, log *slog.Logger) *Relay {
	return newRelay(sqlc.New(pool), b, cfg, log)
}

// newRelay is the injection seam for tests (fake store + fake broker). It clamps the three
// relay knobs to safe defaults: a non-positive poll would panic time.NewTicker in Run() —
// OUTSIDE drainOnce's recover, so it would crash the shared core-api process, not just the
// loop; a non-positive batch would scan LIMIT 0 (the relay silently stops draining money
// events); a non-positive maxAttempts would quarantine the first poison immediately. Clamping
// here (not only in config.Load) makes any caller safe and keeps the guarantee that a
// misconfigured env never takes down HTTP serving.
func newRelay(s store, b broker, cfg config.Config, log *slog.Logger) *Relay {
	poll := cfg.RelayPollInterval
	if poll <= 0 {
		log.Warn("relay: non-positive RELAY_POLL_INTERVAL, falling back to 1s", "got", poll)
		poll = time.Second
	}
	batch := int32(cfg.RelayBatchSize)
	if batch <= 0 {
		log.Warn("relay: non-positive RELAY_BATCH_SIZE, falling back to 100", "got", cfg.RelayBatchSize)
		batch = 100
	}
	maxAtt := int32(cfg.RelayMaxAttempts)
	if maxAtt <= 0 {
		log.Warn("relay: non-positive RELAY_MAX_ATTEMPTS, falling back to 5", "got", cfg.RelayMaxAttempts)
		maxAtt = 5
	}
	return &Relay{
		store:     s,
		broker:    b,
		log:       log,
		poll:      poll,
		batch:     batch,
		maxAtt:    maxAtt,
		dupWindow: cfg.RelayDupWindow,
	}
}

// Run drives the drain loop until ctx is cancelled (shutdown). main launches it in a goroutine
// and joins on shutdown before closing the pool, so the relay releases its DB + NATS handles
// first.
func (r *Relay) Run(ctx context.Context) {
	r.log.Info("outbox relay started", "poll", r.poll, "batch", r.batch, "maxAttempts", r.maxAtt)
	ticker := time.NewTicker(r.poll)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			r.log.Info("outbox relay stopped")
			return
		case <-ticker.C:
			r.drainOnce(ctx)
		}
	}
}

// drainOnce publishes one batch of pending rows. It is panic-safe: a relay bug recovers + logs
// rather than crashing the shared core-api process / HTTP server (chi's Recoverer does not
// cover this goroutine). Per-row failures are handled in place and retried on the next tick.
func (r *Relay) drainOnce(ctx context.Context) {
	defer func() {
		if rec := recover(); rec != nil {
			r.log.Error("outbox relay panic recovered (loop continues)", "panic", rec)
		}
	}()

	rows, err := r.store.SelectPendingOutbox(ctx, r.batch)
	if err != nil {
		if ctx.Err() == nil {
			r.log.Warn("relay: select pending failed", "err", err)
		}
		return
	}
	for _, row := range rows {
		if ctx.Err() != nil {
			return
		}
		switch err := r.publishOne(ctx, row); {
		case err == nil:
			r.markPublished(ctx, row.ID)
		case isTransient(err):
			// accept-downtime (ADR-009): broker unreachable or stream missing. Leave the WHOLE
			// remaining batch pending, do NOT burn attempts, re-ensure topology in case it was
			// lost, and back off to the next tick. Head-of-line order is preserved: lower-seq
			// rows publish first when the broker returns.
			r.onTransient(ctx, err)
			return
		default:
			// poison: a per-message rejection on a reachable broker. Quarantine after the budget
			// so it stops re-poisoning the seq scan; skip it and keep draining later rows.
			r.quarantine(ctx, row)
		}
	}
}

// publishOne publishes a single row and awaits its PubAck. Subject = the literal event_type
// (== NATS subject, ADR-029, no lookup); Nats-Msg-Id = outbox.id for JetStream server-side
// dedup within the stream's duplicate window; payload is forwarded BYTE-FOR-BYTE (the camelCase
// JSON the future worker/notification consumers parse — any reshape silently breaks them).
func (r *Relay) publishOne(ctx context.Context, row sqlc.SelectPendingOutboxRow) error {
	if !r.broker.Reachable() {
		return errBrokerDown
	}
	msg := &nats.Msg{Subject: row.EventType, Data: row.Payload}
	_, err := r.broker.PublishMsg(ctx, msg, jetstream.WithMsgID(row.ID.String()))
	return err
}

// markPublished flips the row to published ONLY after its PubAck succeeded.
func (r *Relay) markPublished(ctx context.Context, id uuid.UUID) {
	if err := r.store.MarkOutboxPublished(ctx, id); err != nil {
		// The PubAck already succeeded but the mark failed (a DB blip). Leave the row pending:
		// it republishes next tick and JetStream collapses the duplicate by Nats-Msg-Id within
		// the window. Order is inviolate — publish → PubAck → mark, never mark-then-publish.
		if ctx.Err() == nil {
			r.log.Warn("relay: mark published failed (will republish, deduped)", "id", id, "err", err)
		}
	}
}

// onTransient handles a connection/no-stream failure: the batch stays pending, no attempts are
// burned, and topology is best-effort re-ensured so the next tick can publish.
func (r *Relay) onTransient(ctx context.Context, cause error) {
	if ctx.Err() != nil {
		return // shutting down — not a real outage
	}
	r.log.Warn("relay: transient publish failure — batch left pending, no attempts burned", "err", cause)
	// The streams may be missing: NATS came up fresh after a down-at-boot (which fires no
	// reconnect handler), or were lost across a restart. Best-effort re-ensure so the next tick
	// publishes; CreateOrUpdateStream is idempotent. Skip if the broker is still unreachable —
	// EnsureTopology would just block to its timeout.
	if !r.broker.Reachable() {
		return
	}
	ectx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := r.broker.EnsureTopology(ectx, r.dupWindow); err != nil {
		r.log.Warn("relay: topology re-ensure failed", "err", err)
	}
}

// quarantine counts a poison row's attempt and marks it failed once the budget is spent, so a
// permanently-rejecting row stops re-poisoning the seq scan and blocking later (good) rows.
func (r *Relay) quarantine(ctx context.Context, row sqlc.SelectPendingOutboxRow) {
	if err := r.store.IncrementOutboxAttempts(ctx, row.ID); err != nil {
		if ctx.Err() == nil {
			r.log.Warn("relay: increment attempts failed", "id", row.ID, "err", err)
		}
		return
	}
	attempts := row.Attempts + 1
	if attempts < r.maxAtt {
		r.log.Warn("relay: publish rejected, will retry", "id", row.ID, "attempts", attempts, "max", r.maxAtt)
		return
	}
	if err := r.store.MarkOutboxFailed(ctx, row.ID); err != nil {
		if ctx.Err() == nil {
			r.log.Warn("relay: mark failed failed", "id", row.ID, "err", err)
		}
		return
	}
	r.log.Error("relay: outbox row quarantined as failed (poison)", "id", row.ID, "attempts", attempts)
}

// isTransient classifies a publish error as a transient outage (leave pending, no attempts
// burn, ADR-029) vs a per-message poison rejection (count + quarantine). Connection-level
// failures and a missing stream (no-responders, surfaced as ErrNoStreamResponse after the
// jetstream client's own retries) are transient — the exact accept-downtime case. Anything else
// (a genuine PubAck rejection on a reachable broker) is poison.
func isTransient(err error) bool {
	switch {
	case errors.Is(err, errBrokerDown),
		errors.Is(err, nats.ErrNoResponders),
		errors.Is(err, nats.ErrConnectionClosed),
		errors.Is(err, nats.ErrConnectionDraining),
		errors.Is(err, nats.ErrConnectionReconnecting),
		errors.Is(err, nats.ErrTimeout),
		errors.Is(err, jetstream.ErrNoStreamResponse),
		errors.Is(err, jetstream.ErrStreamNotFound),
		errors.Is(err, context.DeadlineExceeded),
		errors.Is(err, context.Canceled):
		return true
	}
	return false
}
