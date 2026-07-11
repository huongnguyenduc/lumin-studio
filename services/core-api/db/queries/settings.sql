-- settings.sql — config/reference queries (PR-2g): the settings singleton, the append-only
-- bank-account audit log, and the extension reply templates. spec.md §02 · conventions.md §57.
--
-- bank_account is NOT changed through UpdateSettings — money-out config goes through
-- internal/db/settings.go UpdateBankAccountTx, which runs UpdateBankAccount + InsertBankAudit on ONE
-- tx so the STK change and its audit row commit together (conventions §57). setting_bank_audit has
-- INSERT + SELECT only — no UPDATE/DELETE query exists, and a DB trigger blocks them anyway.

-- name: GetSettings :one
SELECT * FROM settings WHERE id = true;

-- UpdateSettings writes the non-money config (shop info, shipping rules, refund policy). It does NOT
-- touch bank_account — that goes through the audited UpdateBankAccountTx seam.
-- name: UpdateSettings :one
UPDATE settings
SET shop_info = sqlc.arg('shop_info'),
    shipping_rules = sqlc.arg('shipping_rules'),
    refund_policy = sqlc.arg('refund_policy'),
    updated_at = now()
WHERE id = true
RETURNING *;

-- UpdateShippingRules writes ONLY the per-region fee table (settings.shipping_rules), leaving
-- shop_info/refund_policy untouched — a targeted PATCH cannot clobber the rest of the singleton (the
-- 3-column UpdateSettings would). The server resolves shippingFee from this jsonb (pricing.ShippingFee),
-- so the shape MUST stay [{province, fee}]; the handler validates that before this write. Not audited
-- (P3-i open-q #2: only the STK is a high-value money-out field worth an audit trail).
-- name: UpdateShippingRules :one
UPDATE settings
SET shipping_rules = sqlc.arg('shipping_rules'),
    updated_at = now()
WHERE id = true
RETURNING *;

-- UpdateRefundPolicy writes ONLY the refund-policy text (ADR-012), same targeted reasoning as above.
-- name: UpdateRefundPolicy :one
UPDATE settings
SET refund_policy = sqlc.arg('refund_policy'),
    updated_at = now()
WHERE id = true
RETURNING *;

-- UpdateBankAccount sets the VietQR STK the server renders the static QR from. Called only inside
-- UpdateBankAccountTx, alongside InsertBankAudit, so every change is audited (conventions §57).
-- name: UpdateBankAccount :one
UPDATE settings
SET bank_account = sqlc.arg('bank_account'),
    updated_at = now()
WHERE id = true
RETURNING *;

-- name: InsertBankAudit :one
INSERT INTO setting_bank_audit (id, changed_by, bank_account, reason)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- ListBankAudit returns the money-out config history, newest first (the owner audit view). Ordering is
-- by seq (monotonic insertion order), so it is deterministic even when two changes share a created_at
-- microsecond — a random-uuid tiebreaker would not be.
-- name: ListBankAudit :many
SELECT * FROM setting_bank_audit ORDER BY seq DESC;

-- name: InsertReplyTemplate :one
INSERT INTO reply_templates (id, title, body, variables)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: GetReplyTemplateByID :one
SELECT * FROM reply_templates WHERE id = $1;

-- name: ListReplyTemplates :many
SELECT * FROM reply_templates ORDER BY title;

-- UpdateReplyTemplate replaces a template's title/body/variables. RETURNING with no matched row yields
-- pgx.ErrNoRows → mapped to ErrNotFound (404) in the db wrapper, like GetReplyTemplateByID.
-- name: UpdateReplyTemplate :one
UPDATE reply_templates
SET title = $2, body = $3, variables = $4, updated_at = now()
WHERE id = $1
RETURNING *;

-- DeleteReplyTemplate removes a template. :execrows so the wrapper can map 0-rows → ErrNotFound (404)
-- rather than silently succeeding on a bogus id.
-- name: DeleteReplyTemplate :execrows
DELETE FROM reply_templates WHERE id = $1;
