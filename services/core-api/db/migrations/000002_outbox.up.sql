-- 000002_outbox.up.sql — transactional outbox (Core slice 2, PR-2b; ADR-006).
--
-- The dual-write-avoidance spine: domain writers insert an outbox row IN THE SAME tx as
-- the domain mutation, so the event and the state change commit (or roll back) together.
-- The committed `pending` row IS the publish-on-commit signal. The relay/publisher that
-- drains pending rows to NATS JetStream is DEFERRED to slice 3 — slice 2 only accumulates
-- rows; nothing publishes (a safe write-only-until-relay state).

CREATE TABLE outbox (
  id             uuid        PRIMARY KEY,          -- app-generated in Go (reused as event id + Nats-Msg-Id), NOT a DB default
  seq            bigserial   NOT NULL,             -- monotonic commit-order for the slice-3 relay scan
  aggregate_type text        NOT NULL,             -- 'order' | 'asset_job'
  aggregate_id   uuid        NOT NULL,
  event_type     text        NOT NULL,             -- canonical dotted NATS subject (== subject; relay needs no lookup)
  payload        jsonb       NOT NULL,             -- event body; int VND only, never float; no binary blobs
  status         text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'published', 'failed')),
  dedup_key      text        NOT NULL,             -- idempotency key
  attempts       int         NOT NULL DEFAULT 0,   -- only the slice-3 relay mutates
  created_at     timestamptz NOT NULL DEFAULT now(),
  published_at   timestamptz,                      -- only the slice-3 relay sets
  CONSTRAINT outbox_dedup_key_uq UNIQUE (dedup_key)
);

-- Partial index for the slice-3 relay: scan unpublished rows in commit order.
CREATE INDEX outbox_unpublished_idx ON outbox (seq) WHERE status = 'pending';
