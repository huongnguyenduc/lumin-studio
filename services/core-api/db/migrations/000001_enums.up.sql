-- 000001_enums.up.sql — shared native ENUM types (Core slice 2, PR-2a).
--
-- Foundation migration: the later axis migrations (catalog/identity/orders/jobs/
-- settings) reference these types. Values are byte-identical to the slice-1 Go state
-- machine (internal/order/status.go) and packages/core (the OpenAPI contract), so the
-- DB, the Go spine and the TS frontends cannot drift (ADR-028, plan core-data-layer §2).
--
-- NOT here on purpose:
--   * product_material — open-ended in spec.md §02 ("PLA · PETG · recycled-PLA …"), so it
--     lands as a TEXT + CHECK column in the catalog migration, not a closed native enum.
--   * asset_job_status / asset_job_type — deferred with the (still-inferred) AssetJob
--     shape to the jobs migration (plan core-data-layer §6 D3).

CREATE TYPE order_status AS ENUM (
  'PENDING_CONFIRM', 'PAID', 'PRINTING', 'SHIPPING', 'COMPLETED', 'CANCELLED', 'REFUNDED'
);
CREATE TYPE order_channel AS ENUM ('web', 'inbox');
CREATE TYPE payment_method AS ENUM ('bank_transfer');
CREATE TYPE user_role AS ENUM ('owner', 'staff');
CREATE TYPE product_status AS ENUM ('active', 'draft', 'archived');
CREATE TYPE option_type AS ENUM ('text', 'choice');
CREATE TYPE review_status AS ENUM ('published', 'hidden');
CREATE TYPE print_stage AS ENUM ('NEED_PRINT', 'PRINTING', 'PACKING', 'SHIPPED');
CREATE TYPE consent_scope AS ENUM ('marketing', 'order_fulfillment', 'analytics', 'session_replay');
CREATE TYPE consent_channel AS ENUM ('web', 'inbox', 'zalo', 'extension');
