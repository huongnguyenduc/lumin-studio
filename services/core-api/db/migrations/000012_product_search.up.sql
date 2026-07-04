-- 000012_product_search.up.sql — storefront no-accent full-text search (Core · PR-P1-e). ADR-016.
--
-- Wires the `?q=` catalog-search param declared (but reserved/ignored) since PR-P1-c. spec §02: search
-- the small, made-to-order Vietnamese catalog by product name/description WITHOUT accents ("den" must
-- match "đèn"). ADR-016 chose Postgres FTS + unaccent over a separate search service — enough for a tiny
-- catalog; Meilisearch (typo-tolerant search-as-you-type) is deliberately out of scope.
--
-- Numbered 000012 (head was 000011; 000008 was intentionally skipped) — golang-migrate applies a version
-- only if it is ABOVE the current schema version, so a new migration MUST be numbered above main, never by
-- plan slot (lumin migration-numbering rule).
--
-- Design — a FUNCTIONAL GIN index, NOT a stored/generated column:
--   * unaccent() is only STABLE (it depends on the text-search dictionary, which is mutable), so it cannot
--     appear directly in an index or generated-column expression, which require IMMUTABLE inputs. The
--     canonical fix (Postgres wiki "unaccent") is a thin SQL wrapper pinned to the shipped `unaccent`
--     dictionary and DECLARED immutable. It is immutable in practice for us: we never ALTER the dictionary,
--     and the two-arg unaccent('unaccent', …) form ignores search_path so the result is stable. The single
--     caveat: if the dictionary were ever changed, this index would need a REINDEX — acceptable and documented.
--   * A functional index (vs a `search_tsv` column) keeps `products` unchanged, so `sqlc.Product` / every
--     `SELECT *` read (detail, checkout intake, the 4-way parity test) is untouched — no blast radius, no
--     tsvector column to scan/serialize on reads that never search.
--   * to_tsvector('simple', …) — the 'simple' config (lowercase + tokenize, no stemming/stopwords) is right
--     for accent-folded exact-token matching on Vietnamese; Postgres has no Vietnamese stemmer and we do not
--     want one (ADR-016 scope is exact tokens after unaccent, not fuzzy search). The WHERE predicate in
--     db/queries/catalog.sql repeats this exact expression so the planner uses this index.

CREATE EXTENSION IF NOT EXISTS unaccent;

-- immutable_unaccent pins the accent-folding to the shipped 'unaccent' dictionary and is DECLARED immutable
-- (see the dictionary-mutation caveat above) so it may be used in the index expression below and in the
-- matching query predicate. STRICT: name/description are NOT NULL so the argument is never NULL, but a NULL
-- in yields NULL out for free. The two-arg unaccent(regdictionary, text) form is search_path-independent.
--
-- The translate(…, 'đĐ', 'dd') is NOT redundant: Vietnamese đ/Đ (U+0111/U+0110) is a STROKE letter with no
-- Unicode canonical decomposition, so unaccent's decomposition-derived rules do not reliably fold it to d
-- across Postgres versions — yet "đèn" (lamp) is the shop's core term and MUST match "den". Folding it
-- explicitly here guarantees that regardless of the shipped unaccent.rules; it is idempotent where unaccent
-- already handles đ. Every other Vietnamese letter (ăâêôơư + all tone marks) DOES decompose, so đ/Đ is the
-- only gap. Because this exact expression is shared by the index and the query predicate, both stay in sync.
CREATE FUNCTION immutable_unaccent(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT translate(unaccent('unaccent', $1), 'đĐ', 'dd') $$;

CREATE INDEX products_search_idx ON products USING gin (
  to_tsvector('simple', immutable_unaccent(name || ' ' || description))
);
