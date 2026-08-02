-- encode_tokens.sql — scoped Bearer tokens for the NFC-encode-only Shortcuts automation (see
-- 000032_encode_tokens.up.sql). Owner-only surface (mirrors staff & roles, users.sql).

-- name: InsertEncodeToken :one
INSERT INTO encode_tokens (id, user_id, label, token_hash, scope)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: ListEncodeTokens :many
-- The token-management list (Cài đặt › NFC Shortcuts). Newest first; token_hash is never projected
-- to the handler's wire type (toEncodeToken drops it) — this query still selects * for InsertEncodeToken's
-- sibling shape, but the handler never serializes the hash column.
SELECT * FROM encode_tokens ORDER BY created_at DESC;

-- name: GetEncodeTokenByHash :one
-- The auth-middleware lookup on every request bearing a scoped-token-shaped Bearer credential.
-- Unfiltered by revoked_at — the middleware checks revoked_at/scope itself so a revoked token can
-- still be told apart from "no such token" (both fail closed the same way to the caller either way).
SELECT * FROM encode_tokens WHERE token_hash = $1;

-- name: TouchEncodeToken :exec
-- Bumps last_used_at on a successful auth — best-effort observability for "is this Shortcut still
-- in use", not a security control.
UPDATE encode_tokens SET last_used_at = now() WHERE id = $1;

-- name: RevokeEncodeToken :one
-- Owner-only management (classify → authOwnerOnly), so ANY owner may revoke ANY token — not scoped to
-- its creator (a small team's owners jointly administer the Shortcuts credentials). Re-revoking an
-- already-revoked (or nonexistent) row returns ErrNotFound via the zero-rows check in
-- Identity.RevokeEncodeToken, distinguishing "nothing to revoke" from a genuine write.
UPDATE encode_tokens SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL
RETURNING *;
