-- Reverse 000018: drop filament inventory (batches first — it FKs materials). Back to no-costing.
DROP TABLE IF EXISTS filament_batches;
DROP TABLE IF EXISTS filament_materials;
