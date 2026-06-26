-- 000007_settings.up.sql — config/reference: extension reply templates + the settings singleton +
-- the append-only bank-account audit log (Core slice 2, PR-2g, the final data-layer axis).
-- spec.md §02 (ReplyTemplate, Setting) · conventions.md §57 (STK owner-only + audit append-only;
-- static QR rendered server-side from the stored STK) · ADR-012 (refund_policy, NOT return_policy) ·
-- compliance.md §5 (e-invoice/tax NOT automated this phase → NO tax columns here) · ADR-028.
--
-- settings is a SINGLETON: `id boolean PRIMARY KEY DEFAULT true CHECK (id)` admits exactly one row
-- (id = true), seeded below, so GetSettings/UpdateSettings always hit a row. Money-out config —
-- bank_account, the VietQR STK the server renders the static QR from — is split from the rest: it
-- is changed ONLY through the UpdateBankAccountTx seam (internal/db/settings.go), which updates the
-- column AND appends a setting_bank_audit row in ONE tx, so an STK change can never land without its
-- audit trail (conventions §57 — the audit analogue of the outbox publish-on-commit seam).
-- refund_policy is plain text and ADR-012's name (NOT return_policy).
--
-- setting_bank_audit is APPEND-ONLY at the DB level: a row-level BEFORE UPDATE OR DELETE trigger AND a
-- statement-level BEFORE TRUNCATE trigger both RAISE, so the money-out audit log cannot be rewritten or
-- erased through UPDATE, DELETE or TRUNCATE (a row-level trigger alone does NOT fire on TRUNCATE). This
-- is defence in depth beyond "no UPDATE/DELETE query exists". (A superuser can still ALTER TABLE …
-- DISABLE TRIGGER; true tamper-evidence needs WORM backups — out of scope for the data layer.)
-- Owner-only is enforced by the slice-3 RBAC middleware (there is no HTTP layer in this slice); the data
-- layer guarantees append-only + that every bank-account change writes a row. seq (bigserial) gives the
-- trail a monotonic order for a deterministic "newest first" view (mirrors outbox.seq).

CREATE TABLE reply_templates (
  id         uuid        PRIMARY KEY,
  title      text        NOT NULL CHECK (length(title) > 0),
  body       text        NOT NULL,
  variables  jsonb       NOT NULL DEFAULT '[]',  -- placeholder tokens, e.g. ["{tên}","{mã đơn}","{STK}"] (spec §02)
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE settings (
  id             boolean     PRIMARY KEY DEFAULT true CHECK (id),  -- singleton guard: only one row (id = true)
  shop_info      jsonb       NOT NULL DEFAULT '{}',                -- shop name/contact/blurb (spec shopInfo)
  bank_account   jsonb       NOT NULL DEFAULT '{}',                -- VietQR STK {bin, accountNumber, accountName} — server renders the static QR from this
  shipping_rules jsonb       NOT NULL DEFAULT '[]',                -- per-region fee table (spec shippingRules; server computes shippingFee)
  refund_policy  text        NOT NULL DEFAULT '',                  -- ADR-012: refund_policy, NOT return_policy
  updated_at     timestamptz NOT NULL DEFAULT now()
);
-- Seed the singleton so reads never miss and UpdateSettings always targets a row.
INSERT INTO settings (id) VALUES (true);

CREATE TABLE setting_bank_audit (
  id           uuid        PRIMARY KEY,
  seq          bigserial   NOT NULL,                        -- monotonic insertion order → deterministic "newest first" (mirrors outbox.seq)
  changed_by   uuid        NOT NULL REFERENCES users (id),  -- the owner who changed the STK (RBAC owner-only enforced slice 3)
  bank_account jsonb       NOT NULL,                        -- snapshot of the NEW bank_account after the change
  reason       text,                                       -- optional note (e.g. "đổi sang STK Vietcombank")
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX setting_bank_audit_created_idx ON setting_bank_audit (created_at);

-- Append-only enforcement: block UPDATE/DELETE at the DB so the money-out audit trail is immutable.
-- CREATE OR REPLACE keeps the up migration re-runnable; the down drops the function explicitly.
CREATE OR REPLACE FUNCTION setting_bank_audit_append_only() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'setting_bank_audit is append-only (% rejected)', TG_OP;
END;
$$;
CREATE TRIGGER setting_bank_audit_no_mutate
  BEFORE UPDATE OR DELETE ON setting_bank_audit
  FOR EACH ROW EXECUTE FUNCTION setting_bank_audit_append_only();
-- Row-level triggers do NOT fire on TRUNCATE; guard the wipe-the-trail path with a statement-level one.
CREATE TRIGGER setting_bank_audit_no_truncate
  BEFORE TRUNCATE ON setting_bank_audit
  FOR EACH STATEMENT EXECUTE FUNCTION setting_bank_audit_append_only();
