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
