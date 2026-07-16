-- Reverse 000028: drop both mapping columns (round-trips cleanly). The editor's object-name dropdown and
-- the part mapping fall back to the pre-f-2 state — parts carry no object handle.
ALTER TABLE products DROP COLUMN model_object_names;
ALTER TABLE parts DROP COLUMN model_object_name;
