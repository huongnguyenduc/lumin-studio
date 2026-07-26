-- Guest Identity: pseudonymous browser/device identity scoped to one wedding.
-- Raw IP, user-agent and screen details are never persisted; only keyed HMACs
-- and coarse browser/device family codes are stored.

ALTER TABLE guests ADD COLUMN legacy_opened_at TIMESTAMPTZ;
UPDATE guests SET legacy_opened_at = opened_at WHERE opened_at IS NOT NULL;

CREATE TABLE guest_identities (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wedding_slug      TEXT NOT NULL REFERENCES weddings(slug) ON DELETE CASCADE,
  fingerprint_hash  BYTEA,
  fingerprint_ver   SMALLINT NOT NULL DEFAULT 1,
  browser_family    TEXT NOT NULL DEFAULT 'other',
  device_family     TEXT NOT NULL DEFAULT 'other',
  match_confidence  TEXT NOT NULL DEFAULT 'token'
                    CHECK (match_confidence IN ('token', 'fingerprint', 'new')),
  consented_at      TIMESTAMPTZ NOT NULL,
  first_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at        TIMESTAMPTZ NOT NULL
);

CREATE INDEX guest_identities_match_idx
  ON guest_identities (wedding_slug, fingerprint_ver, fingerprint_hash);
CREATE INDEX guest_identities_expiry_idx ON guest_identities (expires_at);

CREATE TABLE guest_identity_tokens (
  identity_id    UUID NOT NULL REFERENCES guest_identities(id) ON DELETE CASCADE,
  wedding_slug   TEXT NOT NULL REFERENCES weddings(slug) ON DELETE CASCADE,
  token_hash     BYTEA NOT NULL,
  trusted_for_profile BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (wedding_slug, token_hash)
);
CREATE INDEX guest_identity_tokens_identity_idx ON guest_identity_tokens (identity_id);

CREATE TABLE admin_identity_claims (
  identity_id    UUID PRIMARY KEY REFERENCES guest_identities(id) ON DELETE CASCADE,
  wedding_slug   TEXT NOT NULL REFERENCES weddings(slug) ON DELETE CASCADE,
  claimed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  claimed_via    TEXT NOT NULL CHECK (claimed_via IN ('session', 'link', 'manual'))
);
CREATE INDEX admin_identity_claims_wedding_idx ON admin_identity_claims (wedding_slug);

CREATE TABLE identity_claim_tokens (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wedding_slug   TEXT NOT NULL REFERENCES weddings(slug) ON DELETE CASCADE,
  token_hash     BYTEA NOT NULL UNIQUE,
  expires_at     TIMESTAMPTZ NOT NULL,
  consumed_at    TIMESTAMPTZ
);
CREATE INDEX identity_claim_tokens_expiry_idx ON identity_claim_tokens (expires_at);

CREATE TABLE invite_opens (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_id    UUID NOT NULL REFERENCES guest_identities(id) ON DELETE CASCADE,
  event_slug     TEXT NOT NULL REFERENCES events(slug) ON DELETE CASCADE,
  guest_id       TEXT REFERENCES guests(id) ON DELETE SET NULL,
  source         TEXT NOT NULL CHECK (source IN ('shared', 'personalized')),
  opened_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX invite_opens_identity_idx ON invite_opens (identity_id, opened_at DESC);
CREATE INDEX invite_opens_guest_idx ON invite_opens (guest_id, opened_at)
  WHERE guest_id IS NOT NULL;
CREATE INDEX invite_opens_event_idx ON invite_opens (event_slug, source, opened_at DESC);

CREATE TABLE shared_guest_responses (
  identity_id    UUID NOT NULL REFERENCES guest_identities(id) ON DELETE CASCADE,
  event_slug     TEXT NOT NULL REFERENCES events(slug) ON DELETE CASCADE,
  name           TEXT NOT NULL CHECK (btrim(name) <> '' AND char_length(name) <= 100),
  -- rsvp NULL = khách đã nhập tên nhưng chưa bấm tham dự/không tham dự. Tên tự
  -- lưu sau khi ngưng gõ nên hàng này có trước lựa chọn RSVP.
  rsvp           TEXT CHECK (rsvp IN ('yes', 'no')),
  rsvp_at        TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (identity_id, event_slug)
);
CREATE INDEX shared_guest_responses_event_idx
  ON shared_guest_responses (event_slug, updated_at DESC);

ALTER TABLE wishes ADD COLUMN identity_id UUID
  REFERENCES guest_identities(id) ON DELETE SET NULL;
CREATE INDEX wishes_identity_id_idx ON wishes (identity_id);

-- Consent-declined visits are deliberately aggregate-only: no identity,
-- fingerprint, IP, UA or per-guest link is retained.
CREATE TABLE anonymous_open_counts (
  event_slug     TEXT NOT NULL REFERENCES events(slug) ON DELETE CASCADE,
  day            DATE NOT NULL DEFAULT CURRENT_DATE,
  source         TEXT NOT NULL CHECK (source IN ('shared', 'personalized')),
  opens          BIGINT NOT NULL DEFAULT 0 CHECK (opens >= 0),
  PRIMARY KEY (event_slug, day, source)
);
