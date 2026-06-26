-- 000002_outbox.down.sql — reverse of 000002_outbox.up.sql.
-- The index is dropped with the table. No FK in or out, so the drop is clean.
DROP TABLE IF EXISTS outbox;
