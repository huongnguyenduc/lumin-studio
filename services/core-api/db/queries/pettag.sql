-- pettag.sql — Pet Tag NFC reads/writes (P3-t). Slice t-2 needs only the encode path: mint a tag for
-- an nfc_tag order line and stamp it ENCODED. Activation (t-3), the pet page (t-4) and the roster (t-5)
-- add their own queries here. The tag lifecycle is MONEY-FREE and SEPARATE from OrderStatus (spec §10).

-- NextPetTagCode hands the encode tx the next display-code number from pet_tag_code_seq (000025) —
-- mirrors NextOrderCode. nextval is atomic + collision-free across concurrent encoders; the Go seam
-- formats it `#LMN-T<n>`. Gaps are expected (a rolled-back encode burns its number).
-- name: NextPetTagCode :one
SELECT nextval('pet_tag_code_seq')::bigint AS n;

-- GetPetTagByOrderItem returns the (first) pet tag minted for an order line, or no rows. A qty>1 line
-- maps to N physical tags (order_item_id is NOT unique — t-1); t-2 mints/encodes ONE per line, so LIMIT
-- 1 by age is the tag this line's encode operates on (ADR-041 — the per-unit N-tag loop is a follow-up).
-- name: GetPetTagByOrderItem :one
SELECT * FROM pet_tags WHERE order_item_id = $1 ORDER BY created_at LIMIT 1;

-- InsertPetTag mints a tag in the default UNENCODED state (chip_uid/encoded_at NULL until the chip is
-- written). code + short_id are generated in the Go seam (sequence + crypto/rand); the UNIQUE indexes on
-- both are the collision backstop.
-- name: InsertPetTag :one
INSERT INTO pet_tags (id, code, short_id, order_item_id)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- MarkPetTagEncoded records the chip write (spec §10 "→ tag ENCODED"): stamp chip_uid + encoded_at and
-- flip status to ENCODED. Idempotent enough for a re-encode before packing (a fresh chip_uid overwrites);
-- the physical NTAG215 write-once lock, not the DB, is what enforces "ghi 1 lần rồi khoá".
-- name: MarkPetTagEncoded :one
UPDATE pet_tags
SET status = 'ENCODED', chip_uid = $2, encoded_at = now()
WHERE id = $1
RETURNING *;

-- ==== Admin roster (t-5) ======================================================================

-- ListPetTags rolls every tag up with its linked pet for the admin /pet-tag roster (spec §10, P3-t t-5).
-- LEFT JOIN pet_profiles so a tag with no pet yet (UNENCODED/ENCODED) still appears — the pet-derived
-- columns come back NULL and the DTO omits them. Newest tag first (mirrors the order the encode mints
-- them). NOT paginated: the FE filters the whole set by status in memory (mirrors ListAdminCustomers).
-- MONEY-FREE and no owner PII — the pet is identified by its public @handle, never the customer account.
-- ponytail: no status predicate here — the 3-status filter is a client chip over the full list (the roster
-- is small); add a WHERE + server paging only if the tag volume ever outgrows a single fetch.
-- name: ListPetTags :many
SELECT
  pt.id, pt.code, pt.short_id, pt.status, pt.chip_uid, pt.created_at,
  pp.handle, pp.pet_name, pp.species, pp.lost_mode
FROM pet_tags pt
LEFT JOIN pet_profiles pp ON pp.tag_id = pt.id
ORDER BY pt.created_at DESC;

-- ==== Activation + public pet page (t-3) ======================================================

-- GetPetTagByShortID resolves a tag by its URL routing key (the /t/{shortId} segment burned to the chip),
-- for the public pet page (t-3) and the activation guard. No lock — the public GET never writes; the
-- activation race is handled by AttachAndActivateTag's status guard, not a SELECT FOR UPDATE.
-- name: GetPetTagByShortID :one
SELECT * FROM pet_tags WHERE short_id = $1;

-- AttachAndActivateTag is the atomic claim: attach the tag to the signed-in customer, stamp activated_at,
-- flip ENCODED → ACTIVATED (spec §10 step 2d). The `status = 'ENCODED'` guard makes it idempotent AND
-- race-safe: a concurrent activate that already flipped the tag leaves 0 rows, which the handler maps to a
-- 409 (a tag can only be activated once). A profile is created only alongside this flip, so a tag that
-- passes the guard has no pet_profiles row yet (the tag_id UNIQUE is a further backstop).
-- name: AttachAndActivateTag :one
UPDATE pet_tags
SET owner_account_id = $2, status = 'ACTIVATED', activated_at = now()
WHERE id = $1 AND status = 'ENCODED'
RETURNING *;

-- InsertPetProfile creates the pet page at activation (spec §10). gallery/favorites/theme/blocks +
-- lost_mode take their table DEFAULTS (empty/[]/{}/false) — onboarding only collects profile + contact +
-- medical + socials; the rest is filled later on the page (t-4). medical/owner_contact/socials are jsonb
-- ([]byte in Go). handle is resolved unique before this insert (SlugifyHandle + PetHandleTaken loop).
-- name: InsertPetProfile :one
INSERT INTO pet_profiles (
  id, tag_id, owner_account_id, handle, pet_name, species,
  breed, age, weight, photo_url, medical, owner_contact, socials
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
RETURNING *;

-- GetPetProfileByTagID loads the profile for an ACTIVATED tag's public page (t-3 returns a minimal
-- summary; t-4 renders the full page). One profile per tag (pet_profiles.tag_id UNIQUE).
-- name: GetPetProfileByTagID :one
SELECT * FROM pet_profiles WHERE tag_id = $1;

-- SlugifyHandle folds a pet name into a URL-safe vanity handle base, reusing the search stack's
-- immutable_unaccent (000012) so Vietnamese diacritics fold the same way everywhere (Bơ → bo, Mai Lê →
-- mai-le). The handle is cosmetic (@handle) — the route key is short_id — so an empty result (e.g. an
-- all-emoji name) is fine; the handler falls back. Uniqueness is resolved by the PetHandleTaken loop.
-- name: SlugifyHandle :one
SELECT trim(both '-' from lower(regexp_replace(immutable_unaccent(trim($1::text)), '[^a-zA-Z0-9]+', '-', 'g')))::text AS handle;

-- PetHandleTaken reports whether a candidate vanity handle is already used, driving the auto-suffix loop
-- (pet_profiles.handle UNIQUE is the final backstop against a check-then-insert race — astronomically
-- rare at one-shop volume, and a lost race just fails the activate, which the customer retries).
-- name: PetHandleTaken :one
SELECT EXISTS (SELECT 1 FROM pet_profiles WHERE handle = $1) AS taken;

-- ==== Pet page — lost mode (t-4a) =============================================================

-- SetLostMode flips the profile's lost-mode flag (spec §10 công tắc thất lạc). The owner_account_id guard
-- makes this the authorization boundary: a signed-in NON-owner matches 0 rows → the handler maps that to a
-- 403 (not a silent no-op). Scoped by tag_id (resolved from shortId first, so an unknown tag is a 404 before
-- this runs). updated_at moves so the toggle leaves a minimal trace (the lostmode_toggled analytics event +
-- lost_events are the fuller audit — t-4b/t-6). ponytail: no separate audit table for a boolean flip.
-- name: SetLostMode :one
UPDATE pet_profiles
SET lost_mode = $2, updated_at = now()
WHERE tag_id = $1 AND owner_account_id = $3
RETURNING *;

-- ==== Pet page — in-place content edit (t-4c) =================================================

-- UpdatePetProfileContent replaces the owner-editable page content in one write (spec §10 sửa-tại-chỗ): the
-- display fields + the content blocks (bio, gallery, favorites) + medical/owner_contact/socials jsonb. Like
-- SetLostMode, the owner_account_id guard IS the authorization boundary — a signed-in non-owner matches 0
-- rows → the handler maps that to a 403 (not a silent no-op). It deliberately does NOT touch theme/blocks
-- (the theme sheet + reorder mode write those in t-4c-2), lost_mode (its own endpoint), or handle (derived,
-- cosmetic — not re-slugged on edit). Scoped by tag_id (resolved from shortId first, so an unknown tag 404s
-- before this runs). updated_at moves. The jsonb params ([]byte) are marshalled in the Go seam.
-- name: UpdatePetProfileContent :one
UPDATE pet_profiles
SET pet_name = $2, species = $3, breed = $4, age = $5, weight = $6, photo_url = $7,
    bio = $8, gallery = $9, favorites = $10, medical = $11, owner_contact = $12, socials = $13,
    updated_at = now()
WHERE tag_id = $1 AND owner_account_id = $14
RETURNING *;

-- UpdatePetAppearance replaces the owner-set page appearance in one write (spec §10 giao diện + sắp xếp,
-- t-4c-2): the theme jsonb (colorway/background/opacity/font) and the blocks jsonb (order + visibility).
-- A full replace of BOTH — the theme sheet + reorder mode each send the whole appearance — kept apart from
-- UpdatePetProfileContent so an appearance save never touches the page CONTENT (and vice versa). Same
-- owner_account_id guard as the content update: a signed-in non-owner matches 0 rows → the handler maps
-- that to a 403 (not a silent no-op). It touches neither the content columns nor lost_mode/handle. Scoped
-- by tag_id (resolved from shortId first, so an unknown tag 404s before this runs). updated_at moves. The
-- jsonb params ([]byte) are marshalled + validated in the Go seam.
-- name: UpdatePetAppearance :one
UPDATE pet_profiles
SET theme = $2, blocks = $3, updated_at = now()
WHERE tag_id = $1 AND owner_account_id = $4
RETURNING *;

-- ==== Pet page — rescue: finder location share (t-4b) =========================================

-- InsertLostEvent records ONE finder location share for a lost pet (spec §10 LostEvent). The row itself IS the
-- PDPL consent artifact (consent point 2): it exists only because an anonymous finder saw the stated purpose,
-- tapped "send", and granted the browser geolocation permission — so scanned_at (DEFAULT now()) + a non-null
-- finder_location capture {scope=location_share, channel=web, timestamp} (compliance.md §2). owner_notified_at
-- stays NULL until a push is actually delivered — the email/notification worker is a later slice; t-4b notifies
-- the owner IN-APP (RecentLostScansForTag on their own page), which needs no worker.
-- name: InsertLostEvent :one
INSERT INTO lost_events (id, tag_id, finder_location)
VALUES ($1, $2, $3)
RETURNING *;

-- RecentLostScansForTag lists a tag's most-recent finder location-shares for the OWNER's in-app notify (spec
-- §10 D4). Only rows that carry a location (a plain scan with no share is not a notify). Bounded by $2, newest
-- first, via lost_events_tag_idx. ponytail: no time-window filter — the retention sweep (t-6) bounds row age,
-- so LIMIT is the only cap needed.
-- name: RecentLostScansForTag :many
SELECT * FROM lost_events
WHERE tag_id = $1 AND finder_location IS NOT NULL
ORDER BY scanned_at DESC
LIMIT $2;
