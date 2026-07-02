-- 000011_dashboard_idx.up.sql — read-path indexes backing the admin dashboard aggregates (Core
-- slice 3, PR-3i). spec.md §03 (dashboard states) / §04 (net-revenue formula) · ADR-028 (golang-migrate).
--
-- NOTE numbering: 000008 is intentionally skipped — 3e-1 landed 000009 first, so 3f renumbered its
-- order_code_seq to 000010 (a 000008 would be silently skipped by golang-migrate on a DB already at
-- 9/10). This dashboard migration is the next free number, 000011 (monotonic-above-main).
--
-- Purely covering indexes — NO new tables/columns — so sqlc's schema (compiled from *.up.sql) is
-- unchanged; only the new db/queries/dashboard.sql reads are added.
--
-- orders_created_at_idx backs the recent-orders read (ORDER BY created_at DESC LIMIT n). It does NOT
-- accelerate DashboardOrderStats — that query computes all-time counts alongside the today-FILTERs, so
-- it is a full-table aggregate scan by design (fine at one-shop scale). orders(status) is already
-- indexed (000005). The index is cheap and pays off for the recent-orders sort as the table grows.
--
-- reviews_waiting_idx is PARTIAL (WHERE reply IS NULL): the "reviews waiting for a reply" count scans
-- only the un-replied rows — the small hot set an owner acts on — while the replied majority never
-- enters the index. status is the leading column so the published-only filter is covered too.

CREATE INDEX orders_created_at_idx ON orders (created_at);
CREATE INDEX reviews_waiting_idx  ON reviews (status) WHERE reply IS NULL;
