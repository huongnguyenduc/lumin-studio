-- outbox.sql — the transactional outbox write path (PR-2b) + the slice-3 relay drain path
-- (PR-3b). InsertOutbox is the only mutation a domain tx performs; the four relay queries
-- below run OUTSIDE any domain tx (the relay reads committed rows only). seq/status/attempts/
-- created_at use column defaults; published_at stays NULL until the relay publishes.
-- name: InsertOutbox :exec
INSERT INTO outbox (id, aggregate_type, aggregate_id, event_type, payload, dedup_key)
VALUES ($1, $2, $3, $4, $5, $6);

-- SelectPendingOutbox scans the WHOLE pending SET in commit order each tick (ADR-029). It
-- deliberately scans `status='pending' ORDER BY seq` — NOT a `seq > watermark` cursor and NOT
-- `FOR UPDATE SKIP LOCKED`: bigserial `seq` is assigned at INSERT, not COMMIT, so a lower-seq
-- tx can become visible AFTER a higher-seq one already published. A watermark would skip that
-- late-committing lower-seq row forever = silent money-event loss. Single instance (ADR-009)
-- ⇒ no SKIP LOCKED / advisory lock. Uses the partial index outbox_unpublished_idx.
-- name: SelectPendingOutbox :many
SELECT id, event_type, payload, attempts
FROM outbox
WHERE status = 'pending'
ORDER BY seq
LIMIT $1;

-- MarkOutboxPublished flips a row to published ONLY after its JetStream PubAck (ADR-029:
-- publish → await PubAck → mark, never mark-then-publish).
-- name: MarkOutboxPublished :exec
UPDATE outbox SET status = 'published', published_at = now()
WHERE id = $1;

-- IncrementOutboxAttempts bumps the per-row publish-attempt counter on a poison (per-message
-- PubAck rejection). A transient connection/no-stream failure must NOT call this.
-- name: IncrementOutboxAttempts :exec
UPDATE outbox SET attempts = attempts + 1
WHERE id = $1;

-- MarkOutboxFailed quarantines a poison row after RelayMaxAttempts so it stops re-poisoning
-- the seq scan and blocking later rows (head-of-line). Surfaced in a future Admin view.
-- name: MarkOutboxFailed :exec
UPDATE outbox SET status = 'failed'
WHERE id = $1;
