-- Reverse 000021: drop the machine-time standard then the COGS snapshot column. Reversible → the catalog
-- keeps today's filament-only deduct behaviour and orders carry no cost_snapshot (ADR-039 "đảo được").
ALTER TABLE products    DROP COLUMN est_print_minutes;
ALTER TABLE order_items DROP COLUMN cost_snapshot;
