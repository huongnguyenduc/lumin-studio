-- 000032_encode_tokens.up.sql — scoped, revocable Bearer tokens for the "Ghi chip NFC" endpoint
-- (POST /admin/print-jobs/{id}/encode) only. Lets an owner mint a credential for an iOS Shortcuts
-- automation without handing out a full-power admin session JWT (which the extension's ADR-043
-- bearer flow would otherwise be — that token authenticates every authRequired/authOwnerOnly route).
--
-- token_hash stores SHA-256(raw token) only — the raw token is shown once at creation and never
-- persisted or logged. scope is a plain text column (not an enum): today only 'pettag_encode'
-- exists, and a text column lets a future second scope land without a migration.
CREATE TABLE encode_tokens (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  label text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  scope text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

-- The auth-middleware lookup is by hash on every request carrying this token shape.
CREATE INDEX encode_tokens_token_hash_idx ON encode_tokens (token_hash);
