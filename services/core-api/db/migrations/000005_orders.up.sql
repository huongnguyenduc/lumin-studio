-- 000005_orders.up.sql — order spine (Core slice 2, PR-2e). spec.md §02/§04.
-- ADR-004 (jsonb for statusHistory/address/personalization, NOT child tables) · ADR-006
-- (publish-on-commit) · ADR-012 (REFUNDED, no RETURNED) · ADR-017 (no district) · ADR-019
-- (server-authoritative int-VND totals).
--
-- channel / status are native enums from 000001, byte-identical to internal/order
-- (status.go) and packages/core. status_history is a jsonb column (ADR-004 — one order's
-- timeline is read whole; cross-order audit reporting is an open question, not built here);
-- a sqlc override maps it to []order.StatusEvent so the persisted history reuses the exact
-- type the state machine appends. Money columns are int8 (bigint) VND NOT NULL CHECK(>=0)
-- (ADR-019); the server computes subtotal/total via internal/money.CalcTotals — a client
-- total is never even a column. shipping_address is jsonb {province,ward,street} with NO
-- district key (ADR-017). refund_proof_url is a DENORMALIZED copy of the latest REFUNDED
-- status-event's refundProofUrl, written in the SAME atomic UPDATE so the two cannot diverge.

CREATE TABLE orders (
  id                   uuid           PRIMARY KEY,
  code                 text           NOT NULL UNIQUE,                       -- display code, e.g. #LMN-2261
  channel              order_channel  NOT NULL,
  status               order_status   NOT NULL,
  customer_id          uuid           NOT NULL REFERENCES customers (id),    -- RESTRICT: orders are retained history
  shipping_address     jsonb          NOT NULL,                              -- Address {province,ward,street}, NO district
  subtotal             bigint         NOT NULL CHECK (subtotal >= 0),
  shipping_fee         bigint         NOT NULL CHECK (shipping_fee >= 0),
  total                bigint         NOT NULL CHECK (total >= 0),
  payment_method       payment_method NOT NULL DEFAULT 'bank_transfer',      -- phase 1: bank_transfer only (spec §02)
  payment_proof_url    text,                                                 -- CK receipt attached at web create (inbox: none); read-only after
  payment_confirmed_at timestamptz,                                          -- set when an order reaches PAID
  refund_proof_url     text,                                                 -- denormalized copy of latest REFUNDED event proof
  tracking_code        text,                                                 -- carrier code (set on SHIPPING; slice-3)
  note                 text,
  status_history       jsonb          NOT NULL DEFAULT '[]',                 -- []order.StatusEvent (ADR-004)
  created_at           timestamptz    NOT NULL DEFAULT now(),
  updated_at           timestamptz    NOT NULL DEFAULT now()
);
CREATE INDEX orders_status_idx ON orders (status);
CREATE INDEX orders_customer_idx ON orders (customer_id);

CREATE TABLE order_items (
  id              uuid    PRIMARY KEY,
  order_id        uuid    NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  product_id      uuid    NOT NULL REFERENCES products (id),                 -- RESTRICT: a product with orders cannot be deleted
  color_id        uuid             REFERENCES colors (id),                   -- nullable: not every product has color choices
  option_ids      jsonb   NOT NULL DEFAULT '[]',                            -- string[] of selected option ids
  personalization jsonb,                                                     -- {text, zoneId} or NULL (no engraving)
  quantity        integer NOT NULL CHECK (quantity > 0),
  unit_price      bigint  NOT NULL CHECK (unit_price >= 0)                  -- effective per-unit VND (base + color + options), snapshot
);
CREATE INDEX order_items_order_idx ON order_items (order_id);
