package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
)

// petNameMax mirrors the pet_profiles.pet_name CHECK (1..40 runes) so a too-long name is a clean 400, not
// a DB CHECK 500 (spec §10 validation: "Tên bé — bắt buộc, 1–40 ký tự").
const petNameMax = 40

// errPetTagNotActivatable flags a tag that cannot be activated: already ACTIVATED (a re-submit or a lost
// race) or still UNENCODED (chip not written). Caught in the handler → 409, never a 500.
var errPetTagNotActivatable = errors.New("pet tag: not in an activatable (ENCODED) state")

// GetPetPage handles GET /pet-tags/{shortId} (public, P3-t t-3): resolve a tag by its routing key for the
// /t/{shortId} page. Returns the lifecycle status (the FE routes on it: ENCODED → login/onboarding,
// ACTIVATED → the page) plus, once ACTIVATED, a MINIMAL profile summary. PDPL data-minimization: no owner
// PII here (phone/contact) — only the display summary; the masked-contact states land in t-4. Unknown
// shortId → 404.
func (s *Server) GetPetPage(ctx context.Context, request api.GetPetPageRequestObject) (api.GetPetPageResponseObject, error) {
	tags := db.NewPetTags(s.pool)
	tag, err := tags.GetByShortID(ctx, request.ShortId)
	if err != nil {
		return nil, err // ErrNotFound → 404; else 500
	}
	var profile *sqlc.PetProfile
	if tag.Status == sqlc.PetTagStatusACTIVATED {
		p, err := tags.ProfileByTagID(ctx, tag.ID)
		if err != nil {
			return nil, err // an ACTIVATED tag always has a profile (created atomically); a miss is a broken invariant → 500
		}
		profile = &p
	}
	return api.GetPetPage200JSONResponse(petPageDTO(tag, profile)), nil
}

// ActivatePetTag handles POST /pet-tags/{shortId}/activate (customer-authed, P3-t t-3): onboarding
// completion (spec §10 step 2d). The scanned ENCODED tag auto-attaches to the signed-in customer, a
// PetProfile is created from the 2-step form, and the tag flips to ACTIVATED — all in one tx. PDPL consent
// point 1 (pet + owner PII) is recorded here as a pet_profile consent grant (ADR-042), reusing the
// consent_grants table checkout writes. An already-activated / not-yet-encoded tag → 409; unknown → 404; a
// bad field (name / phone / consent) → 400.
func (s *Server) ActivatePetTag(ctx context.Context, request api.ActivatePetTagRequestObject) (api.ActivatePetTagResponseObject, error) {
	customerID, ok := customerFrom(ctx)
	if !ok {
		// The middleware injects the customer for this operation; a miss is a wiring bug, not an
		// anonymous request. Fail closed rather than mint a profile with a zero owner.
		return nil, errUnauthenticated
	}
	if request.Body == nil {
		return api.ActivatePetTag400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(envelope(codeValidation))}, nil
	}
	in := *request.Body
	if fields := validateActivateInput(in); len(fields) > 0 {
		return api.ActivatePetTag400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(fieldEnvelope(fields))}, nil
	}

	var page api.PetPage
	err := withTx(ctx, s.pool, func(tx pgx.Tx) error {
		tags := db.NewPetTags(tx)
		tag, err := tags.GetByShortID(ctx, request.ShortId)
		if err != nil {
			return err // ErrNotFound → 404
		}
		if tag.Status != sqlc.PetTagStatusENCODED {
			return errPetTagNotActivatable // ACTIVATED (re-activate) or UNENCODED (not ready) → 409
		}
		tag, err = tags.Activate(ctx, tag.ID, customerID)
		if err != nil {
			if errors.Is(err, db.ErrNotFound) {
				return errPetTagNotActivatable // 0 rows = a concurrent activate won the status guard
			}
			return err
		}
		handle, err := tags.ResolveHandle(ctx, in.PetName)
		if err != nil {
			return err
		}
		profile, err := tags.CreateProfile(ctx, profileParams(tag, customerID, handle, in))
		if err != nil {
			return err
		}
		// PDPL consent point 1 (spec §10) — reuse consent_grants (000004) with the new pet_profile scope
		// on the web channel. Idempotent: a customer activating a SECOND pet already has an active grant.
		if err := db.NewIdentity(tx).GrantConsentIfAbsent(ctx, sqlc.InsertConsentGrantIfAbsentParams{
			ID:            uuid.New(),
			CustomerID:    customerID,
			Scope:         sqlc.ConsentScopePetProfile,
			Channel:       sqlc.ConsentChannelWeb,
			PolicyVersion: consentPolicyVersion,
		}); err != nil {
			return err
		}
		page = petPageDTO(tag, &profile)
		return nil
	})
	if err != nil {
		if errors.Is(err, errPetTagNotActivatable) {
			return api.ActivatePetTag409JSONResponse{ConflictJSONResponse: api.ConflictJSONResponse(envelope(codePetTagNotActivatable))}, nil
		}
		return nil, err // ErrNotFound → 404; else 500 (mapError, no leak)
	}
	return api.ActivatePetTag200JSONResponse(page), nil
}

// validateActivateInput enforces the spec §10 onboarding rules the DB CHECK/regex would otherwise turn
// into a 500. Only the spec-required fields gate: pet name 1..40 runes, a known species, the owner's VN
// phone (what makes lost mode useful), and consent=true (PDPL point 1 — a profile can't be created without
// it). Owner name + the rest are optional per the spec validation table. Returns per-field VALIDATION keys.
func validateActivateInput(in api.PetActivateInput) map[string]string {
	fields := map[string]string{}
	if n := utf8.RuneCountInString(strings.TrimSpace(in.PetName)); n < 1 || n > petNameMax {
		fields["petName"] = msgKey(codeValidation)
	}
	switch in.Species {
	case api.Dog, api.Cat, api.Other:
	default:
		fields["species"] = msgKey(codeValidation)
	}
	if !vnPhoneRe.MatchString(strings.TrimSpace(in.OwnerContact.Phone)) {
		fields["ownerContact.phone"] = msgKey(codeValidation)
	}
	if !in.Consent {
		fields["consent"] = msgKey(codeValidation)
	}
	return fields
}

// profileParams builds the insert from the validated onboarding payload: optional text trimmed to nil (no
// stored ""), medical/ownerContact/socials marshalled to jsonb defaulting to {} / [] (never NULL, mirroring
// the order-item jsonb helpers). The handle is pre-resolved unique by the caller.
func profileParams(tag sqlc.PetTag, ownerID uuid.UUID, handle string, in api.PetActivateInput) sqlc.InsertPetProfileParams {
	medical := []byte("{}")
	if in.Medical != nil {
		if b, err := json.Marshal(in.Medical); err == nil {
			medical = b
		}
	}
	socials := []byte("[]")
	if in.Socials != nil {
		if b, err := json.Marshal(in.Socials); err == nil {
			socials = b
		}
	}
	// OwnerContact is required (a value, always present) — marshal directly; fall back to {} on the
	// impossible marshal error so the NOT NULL jsonb column always holds valid json.
	ownerContact := []byte("{}")
	if b, err := json.Marshal(in.OwnerContact); err == nil {
		ownerContact = b
	}
	return sqlc.InsertPetProfileParams{
		ID:             uuid.New(),
		TagID:          tag.ID,
		OwnerAccountID: ownerID,
		Handle:         handle,
		PetName:        strings.TrimSpace(in.PetName),
		Species:        sqlc.PetSpecies(in.Species),
		Breed:          trimPtr(in.Breed),
		Age:            trimPtr(in.Age),
		Weight:         trimPtr(in.Weight),
		PhotoUrl:       trimPtr(in.PhotoUrl),
		Medical:        medical,
		OwnerContact:   ownerContact,
		Socials:        socials,
	}
}

// petPageDTO projects a tag (+ optional profile) to the public page read. profile is nil until ACTIVATED;
// the summary carries NO owner PII (handle / name / species / photo only — PDPL data-minimization).
func petPageDTO(tag sqlc.PetTag, profile *sqlc.PetProfile) api.PetPage {
	page := api.PetPage{
		ShortId: tag.ShortID,
		Status:  api.PetTagStatus(tag.Status),
	}
	if profile != nil {
		page.Profile = &api.PetPageProfile{
			Handle:   profile.Handle,
			PetName:  profile.PetName,
			Species:  api.PetSpecies(profile.Species),
			PhotoUrl: profile.PhotoUrl,
		}
	}
	return page
}

// trimPtr normalizes an optional text field: nil or whitespace-only → nil (don't store ""), else trimmed.
func trimPtr(s *string) *string {
	if s == nil {
		return nil
	}
	t := strings.TrimSpace(*s)
	if t == "" {
		return nil
	}
	return &t
}
