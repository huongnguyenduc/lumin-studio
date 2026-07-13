-- 000023_pet_tag.up.sql — Pet Tag NFC data model (P3-t slice t-1, ADR-040). spec.md §10.
--
-- A Pet Tag is a 3D-printed NFC ID ring sold as a normal product, then tap-to-open a per-pet page.
-- This axis is MONEY-FREE (the tag is sold through the existing product/order flow; nothing here
-- carries VND) and the tag lifecycle (UNENCODED→ENCODED→ACTIVATED) is SEPARATE from OrderStatus §04
-- (the order still runs PENDING_CONFIRM→…→COMPLETED). No OrderStatus / statusHistory touch here.
--
-- Owner decisions locked in ADR-040: the pet page is served under the storefront app path /t/{shortId}
-- (lumin.pet reserved for a later edge-rewrite) · activation reuses the existing email customer session
-- (P1-r) · the NFC encode runs from admin-mobile Web NFC (t-2). Google OAuth deferred.
--
-- Normalization vs the spec §10 field list (documented in ADR-040 — spec is conceptual, schema
-- normalizes):
--   * pet_tags has NO profile_id back-pointer — the 1-1 link lives on pet_profiles.tag_id (UNIQUE),
--     so tag→profile is a lookup. Avoids a circular FK.
--   * ProfileBlock[] is a `blocks` jsonb column on pet_profiles, not its own table — blocks are only
--     ever read/written with the whole profile, exactly like gallery/socials/medical/theme jsonb here.
--   * The tag's URL is derived from short_id (routing key), not stored twice; chip_uid IS stored
--     (a hardware UID that can't be derived).
-- Numbered above 000022 (monotonic — memory lumin-migration-numbering-monotonic).

-- product_type marks which products need a physical tag + activation. Additive + backward-compatible:
-- every existing and new product defaults to 'standard'. Closed, code-coupled set → native enum
-- (mirrors product_status).
CREATE TYPE product_type AS ENUM ('standard', 'nfc_tag');
ALTER TABLE products ADD COLUMN product_type product_type NOT NULL DEFAULT 'standard';

-- Tag fulfillment lifecycle (spec §10 "Trạng thái tag"), parallel to but separate from OrderStatus.
CREATE TYPE pet_tag_status AS ENUM ('UNENCODED', 'ENCODED', 'ACTIVATED');
-- Species is a fixed 3-choice set on the onboarding form (spec §10); 'other' catches the rest.
CREATE TYPE pet_species AS ENUM ('dog', 'cat', 'other');

-- One physical ring per printed tag. Sold via order_items (a tag is a normal line item; a quantity-N
-- line spawns N tags, so order_item_id is NOT unique). short_id is the URL routing key set at creation
-- (the chip is burned before the pet is named, so the routing key can't depend on the profile).
CREATE TABLE pet_tags (
  id               uuid           PRIMARY KEY,
  code             text           NOT NULL UNIQUE,                              -- display code #LMN-Txxxx
  short_id         text           NOT NULL UNIQUE,                              -- URL segment /t/{shortId}, burned to the chip
  order_item_id    uuid           NOT NULL REFERENCES order_items (id),         -- the sale line (RESTRICT — keep the tag's provenance)
  status           pet_tag_status NOT NULL DEFAULT 'UNENCODED',
  chip_uid         text,                                                        -- NTAG215 hardware UID, recorded at encode
  owner_account_id uuid           REFERENCES customers (id) ON DELETE SET NULL, -- set when the customer logs in (activation 2a); PDPL erasure unlinks
  encoded_at       timestamptz,                                                 -- when the chip was written + locked
  activated_at     timestamptz,                                                 -- when onboarding finished (status → ACTIVATED)
  created_at       timestamptz    NOT NULL DEFAULT now()
);
CREATE INDEX pet_tags_owner_idx ON pet_tags (owner_account_id);

-- The pet's page. 1-1 with a tag (tag_id UNIQUE). owner_account_id is the page owner (one account →
-- many pets). Content sections that are only ever loaded with the whole page stay jsonb (gallery,
-- favorites, medical, owner_contact, socials, theme, blocks) — the same shape the rest of the app uses.
CREATE TABLE pet_profiles (
  id               uuid        PRIMARY KEY,
  tag_id           uuid        NOT NULL UNIQUE REFERENCES pet_tags (id) ON DELETE CASCADE,
  owner_account_id uuid        NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  handle           text        NOT NULL UNIQUE,                                 -- vanity slug (auto from name, unique — spec §10 validation)
  pet_name         text        NOT NULL CHECK (char_length(pet_name) BETWEEN 1 AND 40),
  species          pet_species NOT NULL,
  breed            text,
  age              text,                                                        -- free-form ("2 tuổi", "6 tháng") — not a number in the design
  weight           text,
  photo_url        text,
  gallery          jsonb       NOT NULL DEFAULT '[]',                           -- Image[]
  bio              text,
  favorites        jsonb       NOT NULL DEFAULT '[]',                           -- string[] "khoái khẩu" chips
  medical          jsonb       NOT NULL DEFAULT '{}',                           -- {vaccinated, neutered, allergies, vetClinic}
  owner_contact    jsonb       NOT NULL,                                        -- {name, phone, zalo, email?}; phone required (spec §10)
  socials          jsonb       NOT NULL DEFAULT '[]',                           -- {platform, handle}[]
  lost_mode        boolean     NOT NULL DEFAULT false,                          -- false = at home (default); owner flips on when lost
  theme            jsonb       NOT NULL DEFAULT '{}',                           -- {palette, background, bgOpacity, nameFont}
  blocks           jsonb       NOT NULL DEFAULT '[]',                           -- ProfileBlock[] {type, order, visible}; photo_name is always first
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pet_profiles_owner_idx ON pet_profiles (owner_account_id);

-- One row per scan-while-lost / finder location share (spec §10 LostEvent). finder_location is filled
-- only when the finder consents to share once (PDPL); the row + geo are retention-bound (t-6).
CREATE TABLE lost_events (
  id                uuid        PRIMARY KEY,
  tag_id            uuid        NOT NULL REFERENCES pet_tags (id) ON DELETE CASCADE,
  scanned_at        timestamptz NOT NULL DEFAULT now(),
  finder_location   jsonb,                                                      -- {lat,lng} only on finder consent; else NULL
  owner_notified_at timestamptz
);
CREATE INDEX lost_events_tag_idx ON lost_events (tag_id);
