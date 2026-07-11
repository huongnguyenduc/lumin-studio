-- Reverse of 000020: drop the machine + aux-cost rate inputs → the 4c-2 rollup's machineVnd/auxVnd terms
-- become 0 (no rows), which is the same guarded behaviour as "none configured". 000019 (filament + scrap
-- ledger) is untouched.
DROP TABLE IF EXISTS aux_costs;
DROP TABLE IF EXISTS machines;
