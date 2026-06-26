package db

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
)

// ErrInvalidEvent is returned for a structurally invalid OutboxEvent (missing id/keys or a
// non-JSON payload), before any database round-trip.
var ErrInvalidEvent = errors.New("outbox: invalid event")

// OutboxEvent is one domain event to enqueue transactionally. The relay (slice 3) reads
// these rows and publishes EventType as the NATS subject with ID as the Nats-Msg-Id.
type OutboxEvent struct {
	ID            uuid.UUID       // app-generated; reused as the event id + Nats-Msg-Id dedup header
	AggregateType string          // "order" | "asset_job"
	AggregateID   uuid.UUID       // the aggregate this event is about
	EventType     string          // canonical dotted NATS subject, e.g. "order.created"
	Payload       json.RawMessage // event body; int VND only, never float; no binary blobs
	DedupKey      string          // idempotency key (UNIQUE) — rejects a buggy double-insert at write time
}

// EnqueueOutbox writes ev into the outbox table USING THE CALLER'S TRANSACTION. tx is the
// FIRST argument (not the pool) by design: the type system forces every caller to enlist
// the outbox write inside an already-open domain transaction, so the event row and the
// domain mutation commit — or roll back — as ONE unit. That is the structural dual-write
// guard (ADR-006): there is a single commit, so no window exists where the state changed
// but the event was lost. The committed `pending` row IS the publish-on-commit signal; the
// relay/NATS publisher that drains pending rows is deferred to slice 3.
func EnqueueOutbox(ctx context.Context, tx pgx.Tx, ev OutboxEvent) error {
	if err := ev.validate(); err != nil {
		return err
	}
	err := sqlc.New(tx).InsertOutbox(ctx, sqlc.InsertOutboxParams{
		ID:            ev.ID,
		AggregateType: ev.AggregateType,
		AggregateID:   ev.AggregateID,
		EventType:     ev.EventType,
		Payload:       ev.Payload,
		DedupKey:      ev.DedupKey,
	})
	if err != nil {
		return fmt.Errorf("outbox: enqueue %s: %w", ev.EventType, err)
	}
	return nil
}

// validate rejects a malformed event before the round-trip. Postgres still enforces the
// dedup_key UNIQUE constraint and the NOT NULLs; catching empties here gives a clearer
// error and avoids a doomed insert.
func (ev OutboxEvent) validate() error {
	switch {
	case ev.ID == uuid.Nil:
		return fmt.Errorf("%w: id required", ErrInvalidEvent)
	case ev.AggregateType == "":
		return fmt.Errorf("%w: aggregateType required", ErrInvalidEvent)
	case ev.AggregateID == uuid.Nil:
		return fmt.Errorf("%w: aggregateId required", ErrInvalidEvent)
	case ev.EventType == "":
		return fmt.Errorf("%w: eventType required", ErrInvalidEvent)
	case ev.DedupKey == "":
		return fmt.Errorf("%w: dedupKey required", ErrInvalidEvent)
	case len(ev.Payload) == 0 || !json.Valid(ev.Payload):
		return fmt.Errorf("%w: payload must be valid JSON", ErrInvalidEvent)
	}
	return nil
}
