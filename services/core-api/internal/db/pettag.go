package db

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

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

// defaultHandleBase is the vanity-handle fallback when a pet name folds to an empty slug (e.g. an
// all-emoji name). The route key is short_id, so a generic base is harmless — it just reads @pet-xxxx.
const defaultHandleBase = "pet"

// GetByShortID resolves a tag by its /t/{shortId} routing key (public page + activation guard). No lock.
func (t *PetTags) GetByShortID(ctx context.Context, shortID string) (sqlc.PetTag, error) {
	row, err := t.q.GetPetTagByShortID(ctx, shortID)
	if errors.Is(err, pgx.ErrNoRows) {
		return sqlc.PetTag{}, ErrNotFound
	}
	return row, err
}

// Activate is the atomic claim (spec §10 step 2d): attach the tag to the customer + flip ENCODED →
// ACTIVATED. The status guard means 0 rows = the tag was NOT in ENCODED state (already activated, or a
// concurrent activate won the race); that surfaces as ErrNotFound, which the handler — having just read an
// ENCODED tag — maps to a 409, not a 404 (the tag exists, it just can't be activated a second time).
func (t *PetTags) Activate(ctx context.Context, id, ownerID uuid.UUID) (sqlc.PetTag, error) {
	row, err := t.q.AttachAndActivateTag(ctx, sqlc.AttachAndActivateTagParams{
		ID:             id,
		OwnerAccountID: pgtype.UUID{Bytes: ownerID, Valid: true},
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return sqlc.PetTag{}, ErrNotFound
	}
	return row, err
}

// CreateProfile inserts the pet page built at activation. The caller resolves a unique handle first
// (ResolveHandle); pet_profiles.handle UNIQUE is the final backstop, so a check-then-insert race surfaces
// as a plain error (the whole activation rolls back and the customer retries) — see ResolveHandle.
func (t *PetTags) CreateProfile(ctx context.Context, params sqlc.InsertPetProfileParams) (sqlc.PetProfile, error) {
	return t.q.InsertPetProfile(ctx, params)
}

// ProfileByTagID loads the profile behind an ACTIVATED tag (the public page summary). ErrNoRows → ErrNotFound.
func (t *PetTags) ProfileByTagID(ctx context.Context, tagID uuid.UUID) (sqlc.PetProfile, error) {
	row, err := t.q.GetPetProfileByTagID(ctx, tagID)
	if errors.Is(err, pgx.ErrNoRows) {
		return sqlc.PetProfile{}, ErrNotFound
	}
	return row, err
}

// SetLostMode flips the lost-mode flag on the profile behind a tag, but ONLY for the owning customer — the
// owner_account_id guard is the authorization boundary (spec §10: chỉ chủ bật/tắt). A signed-in non-owner (or
// a tag with no profile) matches 0 rows → ErrNotFound, which the handler — having already resolved the tag by
// shortId — maps to a 403, not a 404 (the tag exists; this caller just doesn't own it). Returns the updated row.
func (t *PetTags) SetLostMode(ctx context.Context, tagID, ownerID uuid.UUID, lost bool) (sqlc.PetProfile, error) {
	row, err := t.q.SetLostMode(ctx, sqlc.SetLostModeParams{TagID: tagID, LostMode: lost, OwnerAccountID: ownerID})
	if errors.Is(err, pgx.ErrNoRows) {
		return sqlc.PetProfile{}, ErrNotFound
	}
	return row, err
}

// UpdateProfileContent replaces the owner-editable page content (spec §10 sửa-tại-chỗ, t-4c). Thin over the
// query: the caller (the handler) has already marshalled the jsonb params and set the owner_account_id guard,
// so a non-owner matches 0 rows → ErrNotFound, which the handler maps to a 403 (mirrors SetLostMode). The
// query never touches theme/blocks/lost_mode/handle.
func (t *PetTags) UpdateProfileContent(ctx context.Context, params sqlc.UpdatePetProfileContentParams) (sqlc.PetProfile, error) {
	row, err := t.q.UpdatePetProfileContent(ctx, params)
	if errors.Is(err, pgx.ErrNoRows) {
		return sqlc.PetProfile{}, ErrNotFound
	}
	return row, err
}

// UpdateAppearance replaces the owner-set theme + block order (spec §10 giao diện + sắp xếp, t-4c-2). Thin
// over the query, same shape as UpdateProfileContent: the handler has marshalled the theme/blocks jsonb and
// set the owner_account_id guard, so a non-owner matches 0 rows → ErrNotFound → the handler's 403. It never
// touches the content columns or lost_mode/handle.
func (t *PetTags) UpdateAppearance(ctx context.Context, params sqlc.UpdatePetAppearanceParams) (sqlc.PetProfile, error) {
	row, err := t.q.UpdatePetAppearance(ctx, params)
	if errors.Is(err, pgx.ErrNoRows) {
		return sqlc.PetProfile{}, ErrNotFound
	}
	return row, err
}

// FinderLocation is the {lat,lng} stored in lost_events.finder_location (spec §10). Defined here (the write
// side) so the marshal and the pet-page read decode share one shape.
type FinderLocation struct {
	Lat float64 `json:"lat"`
	Lng float64 `json:"lng"`
}

// RecordLostScan writes ONE finder location share for a lost pet (spec §10 rescue 4b, P3-t t-4b). A single
// autocommit insert — money-free, and NO outbox: the tag axis publishes no events (there is no pettag.* NATS
// stream and no owner-notify worker yet, so there is nothing to co-commit). The row's existence + its non-null
// finder_location ARE the PDPL consent-point-2 record. The caller has already verified the pet is in lost mode.
func (t *PetTags) RecordLostScan(ctx context.Context, tagID uuid.UUID, loc FinderLocation) (sqlc.LostEvent, error) {
	b, err := json.Marshal(loc)
	if err != nil {
		return sqlc.LostEvent{}, fmt.Errorf("pet tag: marshal finder location: %w", err)
	}
	return t.q.InsertLostEvent(ctx, sqlc.InsertLostEventParams{
		ID:             uuid.New(),
		TagID:          tagID,
		FinderLocation: b,
	})
}

// RecentLostScans returns a tag's most-recent finder location-shares for the owner's in-app notify (spec §10
// D4). Only rows carrying a location come back (the query filters); limit bounds the list.
func (t *PetTags) RecentLostScans(ctx context.Context, tagID uuid.UUID, limit int32) ([]sqlc.LostEvent, error) {
	return t.q.RecentLostScansForTag(ctx, sqlc.RecentLostScansForTagParams{TagID: tagID, Limit: limit})
}

// ResolveHandle folds the pet name into a unique vanity handle (spec §10 "handle auto từ tên, unique").
// The base is accent-folded in SQL (SlugifyHandle → immutable_unaccent); a collision auto-suffixes (-2..-9,
// then a random suffix) rather than 400 — the user never types the handle (it's derived) and the route key
// is short_id, so the handle is cosmetic. ponytail: bounded, no FOR UPDATE — the handle UNIQUE index is the
// race backstop; a lost race just fails the (rare, human-paced) activate, which the customer retries.
func (t *PetTags) ResolveHandle(ctx context.Context, petName string) (string, error) {
	base, err := t.q.SlugifyHandle(ctx, petName)
	if err != nil {
		return "", err
	}
	if base == "" {
		base = defaultHandleBase
	}
	for _, cand := range handleCandidates(base) {
		taken, err := t.q.PetHandleTaken(ctx, cand)
		if err != nil {
			return "", err
		}
		if !taken {
			return cand, nil
		}
	}
	suffix, err := randHandleSuffix()
	if err != nil {
		return "", err
	}
	return base + "-" + suffix, nil
}

// handleCandidates is the ordered try-list for a base slug: the bare base, then base-2…base-9. Pure, so
// the suffix sequence is unit-testable; exhausting it (8 same-named pets) falls through to a random suffix.
func handleCandidates(base string) []string {
	cands := make([]string, 0, 9)
	cands = append(cands, base)
	for n := 2; n <= 9; n++ {
		cands = append(cands, fmt.Sprintf("%s-%d", base, n))
	}
	return cands
}

// randHandleSuffix is 2 crypto/rand bytes → 4 lowercase hex chars, the last-resort handle disambiguator.
func randHandleSuffix() (string, error) {
	b := make([]byte, 2)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
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
