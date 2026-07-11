-- 000018_filament.up.sql — Vật tư slice 4a (ADR-039): filament inventory. `filament_materials` is the
-- shop-wide palette (one row per named colour); `filament_batches` records each "nhập cuộn" import lot.
-- Stock + weighted-average cost/unit are DERIVED from the batches at read (Σ remaining, weighted by
-- remaining × per-lot ₫/unit) — never stored, so an import never has to rewrite a cached number, and the
-- consumption ledger (slice 4b) stays the single source of truth for what's left. Money is int-VND bigint
-- CHECK(>=0) (ADR-019); `material` is TEXT+CHECK not a native enum (ADR-028, open-ended set). Additive
-- greenfield, no backfill; reversible (down drops both tables — RESTRICT keeps a material with lots alive).

CREATE TABLE filament_materials (
  id                  uuid        PRIMARY KEY,
  name                text        NOT NULL,
  material            text        NOT NULL CHECK (material IN ('PLA', 'PETG', 'recycled-PLA', 'Resin')),
  unit                text        NOT NULL DEFAULT 'gram' CHECK (unit IN ('gram', 'ml')),
  hex                 text,                                          -- swatch; NULL = no colour chip
  low_stock_threshold bigint      NOT NULL DEFAULT 0 CHECK (low_stock_threshold >= 0),
  archived            boolean     NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE filament_batches (
  id             uuid        PRIMARY KEY,
  material_id    uuid        NOT NULL REFERENCES filament_materials (id) ON DELETE RESTRICT,
  imported_at    timestamptz NOT NULL DEFAULT now(),
  qty_original   bigint      NOT NULL CHECK (qty_original > 0),                      -- unit qty imported (số cuộn × g/cuộn)
  qty_remaining  bigint      NOT NULL CHECK (qty_remaining >= 0 AND qty_remaining <= qty_original),
  total_cost_vnd bigint      NOT NULL CHECK (total_cost_vnd >= 0)                    -- lot cost; per-unit ₫ = total/original (derived)
);
CREATE INDEX filament_batches_material_idx ON filament_batches (material_id, imported_at);
