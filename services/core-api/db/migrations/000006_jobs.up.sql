-- 000006_jobs.up.sql — fulfillment/asset jobs (Core slice 2, PR-2f).
-- architecture.md §3D-pipeline · spec.md §02 (PrintJob) · ADR-006 (publish-on-commit) ·
-- ADR-007 (render contract) · ADR-028 (data layer).
--
-- asset_jobs is the render/ingest work queue the slice-3 relay drains onto NATS (the subject is
-- the outbox event_type). Its shape is INFERRED — spec §02 has NO AssetJob field table; it is
-- reconstructed from the architecture pipeline (admin upload → AssetJob → worker normalize / LOD /
-- 360° sprite → callback) plus ADR-007. Two job kinds (D3, user-confirmed 2026-06-26):
--   * model_ingest  — normalize geometry, extract dims/material to prefill Product, build LOD .glb
--   * sprite_render — render the 360° sprite alone (so it can re-render without re-ingesting)
-- The worker's OUTPUTS (glb/sprite URLs) land on Product, not here (D3) — asset_jobs is INPUT +
-- lifecycle only. source_model_url + source_version make the job reconstructable from the source
-- object (ADR-006 — the event payload carries the pointer, never a blob); Garage has no object
-- versioning (ADR-004) so source_version is the content hash. status defaults 'queued'; only the
-- slice-3 worker/relay mutates status/attempts/last_error/completed_at.
--
-- print_jobs is the admin print queue. stage is STORED, not derived from order.status (D6,
-- user-confirmed): the queue is staff-driven / drag-droppable and finer-grained than order status
-- (one PRINTING order status spans the PRINTING + PACKING print stages), and Pet Tag's future
-- NFC-encode stage has no order-status twin (a later ALTER TYPE print_stage ADD VALUE). stage is
-- seeded from order status at creation (slice 3) then advanced independently. NO outbox seam — the
-- print queue is admin-internal (SSE to the browser in slice 3; NATS is never involved).

CREATE TYPE asset_job_status AS ENUM ('queued', 'processing', 'ready', 'failed');
CREATE TYPE asset_job_type   AS ENUM ('model_ingest', 'sprite_render');

CREATE TABLE asset_jobs (
  id               uuid             PRIMARY KEY,
  product_id       uuid             NOT NULL REFERENCES products (id),         -- RESTRICT: a product with render history is retained
  job_type         asset_job_type   NOT NULL,
  source_model_url text             NOT NULL,                                  -- Garage pointer the worker reconstructs from (ADR-006/007)
  source_version   text             NOT NULL,                                  -- content hash of the source object (Garage has no versioning, ADR-004)
  status           asset_job_status NOT NULL DEFAULT 'queued',
  attempts         integer          NOT NULL DEFAULT 0 CHECK (attempts >= 0),  -- retry count; only the slice-3 worker/relay mutates (ADR-007)
  last_error       text,                                                       -- failure reason / DLQ context (set on 'failed', cleared on 'ready')
  created_at       timestamptz      NOT NULL DEFAULT now(),
  updated_at       timestamptz      NOT NULL DEFAULT now(),
  completed_at     timestamptz                                                 -- set when the job reaches 'ready' or 'failed'
);
CREATE INDEX asset_jobs_status_idx  ON asset_jobs (status);
CREATE INDEX asset_jobs_product_idx ON asset_jobs (product_id);

CREATE TABLE print_jobs (
  id            uuid        PRIMARY KEY,
  order_item_id uuid        NOT NULL REFERENCES order_items (id) ON DELETE CASCADE,  -- spec orderItemRef; dies with its item
  stage         print_stage NOT NULL,                                               -- STORED (D6); seeded from order status, then staff-driven
  printer       text,                                                               -- assigned printer (staff)
  color_name    text,                                                               -- denormalized for the queue card (spec colorName)
  eta           timestamptz,                                                        -- estimated handoff
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX print_jobs_stage_idx ON print_jobs (stage);
CREATE INDEX print_jobs_item_idx  ON print_jobs (order_item_id);
