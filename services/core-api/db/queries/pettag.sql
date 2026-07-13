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
