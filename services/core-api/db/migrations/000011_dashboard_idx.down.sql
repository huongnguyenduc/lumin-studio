-- 000011_dashboard_idx.down.sql — drop the dashboard read-path indexes (PR-3i). Reverse order of up.
DROP INDEX IF EXISTS reviews_waiting_idx;
DROP INDEX IF EXISTS orders_created_at_idx;
