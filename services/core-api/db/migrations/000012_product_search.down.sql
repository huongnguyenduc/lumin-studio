-- 000012_product_search.down.sql — reverse the no-accent search index (PR-P1-e).
-- Drop the two objects THIS migration owns, in dependency order: the index (references the function) → the
-- function (references the extension). TestMigrationsReversible re-applies all downs in reverse and asserts
-- an empty public schema (no leftover tables/enums); this migration adds neither.
--
-- We intentionally do NOT `DROP EXTENSION unaccent`. The UP uses `CREATE EXTENSION IF NOT EXISTS`, so on a
-- restricted-role deploy where a superuser pre-created the extension (operations.md §4c) it was NOT created
-- here and may be shared with other objects/DBs. Dropping it would (a) fail for a restricted role that does
-- not own the extension — breaking the rollback mid-way — and (b) destructively remove infrastructure this
-- migration never created. A leftover extension is harmless and idempotent to re-CREATE; reversing only what
-- we own is the safe, privilege-symmetric choice.
DROP INDEX IF EXISTS products_search_idx;
DROP FUNCTION IF EXISTS immutable_unaccent(text);
