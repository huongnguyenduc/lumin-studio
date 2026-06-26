-- outbox.sql — the transactional outbox write path (PR-2b). InsertOutbox is the only
-- mutation slice 2 performs on this table; the relay's SELECT/mark-published queries land
-- in slice 3. seq/status/attempts/created_at use column defaults; published_at stays NULL
-- until the relay publishes.
-- name: InsertOutbox :exec
INSERT INTO outbox (id, aggregate_type, aggregate_id, event_type, payload, dedup_key)
VALUES ($1, $2, $3, $4, $5, $6);
