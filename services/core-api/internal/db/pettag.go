package db

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
)

// PetTags is the read/write repository for the Pet Tag NFC axis (pet_tags; pet_profiles + lost_events
// land with t-3/t-4). MONEY-FREE and SEPARATE from OrderStatus — the tag lifecycle
// (UNENCODED→ENCODED→ACTIVATED) never touches statusHistory or packages/core (spec §10, ADR-040), so its
// writes are plain repo methods with no outbox seam. Construct over the *pgxpool.Pool for autocommit, or
// over a pgx.Tx to enlist in the encode transaction.
type PetTags struct {
	q *sqlc.Queries
}

// NewPetTags builds a PetTags over any sqlc.DBTX (the pool or a pgx.Tx).
func NewPetTags(db sqlc.DBTX) *PetTags {
	return &PetTags{q: sqlc.New(db)}
}

// GetOrCreateForOrderItem returns the pet tag minted for an order line, creating one (UNENCODED, with a
// fresh display code + short_id) if none exists yet. This is where a tag is BORN in t-2: no
// order→print_job wiring mints tags upstream, so the NFC-encode step is the mint point (ADR-041). A
// qty>1 line gets ONE tag for now (GetPetTagByOrderItem LIMIT 1) — the per-unit N-tag loop is a
// follow-up. Enlist over the encode tx so the code sequence bump + insert commit atomically with the
// encode; a rolled-back encode just burns a code number (gaps are expected).
func (t *PetTags) GetOrCreateForOrderItem(ctx context.Context, orderItemID uuid.UUID) (sqlc.PetTag, error) {
	existing, err := t.q.GetPetTagByOrderItem(ctx, orderItemID)
	if err == nil {
		return existing, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return sqlc.PetTag{}, err
	}
	n, err := t.q.NextPetTagCode(ctx)
	if err != nil {
		return sqlc.PetTag{}, fmt.Errorf("pet tag: mint code: %w", err)
	}
	shortID, err := newShortID()
	if err != nil {
		return sqlc.PetTag{}, fmt.Errorf("pet tag: mint short id: %w", err)
	}
	return t.q.InsertPetTag(ctx, sqlc.InsertPetTagParams{
		ID:          uuid.New(),
		Code:        fmt.Sprintf("#LMN-T%04d", n),
		ShortID:     shortID,
		OrderItemID: orderItemID,
	})
}

// MarkEncoded stamps the chip UID + encoded_at and flips the tag to ENCODED — the confirmed chip write
// (spec §10 "→ tag ENCODED"). chipUID is the NTAG215 hardware UID read off the just-written chip. Returns
// ErrNotFound if the tag id is gone.
func (t *PetTags) MarkEncoded(ctx context.Context, id uuid.UUID, chipUID string) (sqlc.PetTag, error) {
	row, err := t.q.MarkPetTagEncoded(ctx, sqlc.MarkPetTagEncodedParams{ID: id, ChipUid: &chipUID})
	if errors.Is(err, pgx.ErrNoRows) {
		return sqlc.PetTag{}, ErrNotFound
	}
	return row, err
}

// newShortID mints the public /t/{shortId} routing key burned to the chip: 8 crypto/rand bytes →
// base64url (11 chars, no padding). 64 bits is collision-safe at a one-shop tag volume; the
// pet_tags.short_id UNIQUE index is the backstop (a dupe would surface as an insert error, effectively
// never). ponytail: no retry loop — add one only if a collision is ever observed.
func newShortID() (string, error) {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}
