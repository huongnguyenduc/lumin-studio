package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
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

// GetPetPage handles GET /pet-tags/{shortId} (public, P3-t t-3/t-4a): resolve a tag by its routing key for
// the /t/{shortId} page. Returns the lifecycle status (the FE routes on it: ENCODED → login/onboarding,
// ACTIVATED → the page) plus, once ACTIVATED, the profile the 3-state page renders. The customer session is
// resolved OPTIONALLY (authOptionalCustomer): when it belongs to the tag's owner, viewerIsOwner flips true
// and the contact is un-masked (PDPL — the reveal is decided server-side, never in the browser). Unknown
// shortId → 404.
func (s *Server) GetPetPage(ctx context.Context, request api.GetPetPageRequestObject) (api.GetPetPageResponseObject, error) {
	tags := db.NewPetTags(s.pool)
	tag, err := tags.GetByShortID(ctx, request.ShortId)
	if err != nil {
		return nil, err // ErrNotFound → 404; else 500
	}
	var profile *sqlc.PetProfile
	viewerIsOwner := false
	if tag.Status == sqlc.PetTagStatusACTIVATED {
		p, err := tags.ProfileByTagID(ctx, tag.ID)
		if err != nil {
			return nil, err // an ACTIVATED tag always has a profile (created atomically); a miss is a broken invariant → 500
		}
		profile = &p
		// authOptionalCustomer injects the customer iff a valid session cookie was present. Owner iff it matches.
		if cid, ok := customerFrom(ctx); ok && cid == p.OwnerAccountID {
			viewerIsOwner = true
		}
	}
	return api.GetPetPage200JSONResponse(petPageDTO(tag, profile, viewerIsOwner)), nil
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
		page = petPageDTO(tag, &profile, true) // the activating customer is, by construction, the owner
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

// ToggleLostMode handles PATCH /pet-tags/{shortId}/lost-mode (customer-authed, P3-t t-4a): the owner flips
// the lost-mode switch (spec §10 công tắc thất lạc). Only the owner may toggle — SetLostMode's
// owner_account_id guard is the authorization boundary, so a signed-in non-owner is a 403, not a silent
// no-op. lostMode drives the public page's view-state + the contact reveal. Unknown shortId → 404; a tag the
// caller does not own → 403.
func (s *Server) ToggleLostMode(ctx context.Context, request api.ToggleLostModeRequestObject) (api.ToggleLostModeResponseObject, error) {
	customerID, ok := customerFrom(ctx)
	if !ok {
		return nil, errUnauthenticated // wiring guard — authCustomer injects the owner; a miss is not an anonymous toggle
	}
	if request.Body == nil {
		return api.ToggleLostMode400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(envelope(codeValidation))}, nil
	}
	tags := db.NewPetTags(s.pool)
	tag, err := tags.GetByShortID(ctx, request.ShortId)
	if err != nil {
		return nil, err // ErrNotFound → 404 (bad link); else 500
	}
	profile, err := tags.SetLostMode(ctx, tag.ID, customerID, request.Body.LostMode)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			return nil, errForbidden // 0 rows = the tag exists but this customer does not own it → 403
		}
		return nil, err
	}
	return api.ToggleLostMode200JSONResponse(petPageDTO(tag, &profile, true)), nil
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

// petPageDTO projects a tag (+ optional profile) to the public page read. profile is nil until ACTIVATED.
// The contact is masked unless the page is in lost mode OR the viewer is the owner — masking is decided HERE
// (server-side) so the raw phone never reaches the wire in the masked case (PDPL). Owner-only sections
// (bio/gallery/favorites/theme/blocks) are not projected — they have no writer until the t-4c editor.
func petPageDTO(tag sqlc.PetTag, profile *sqlc.PetProfile, viewerIsOwner bool) api.PetPage {
	page := api.PetPage{
		ShortId:       tag.ShortID,
		Status:        api.PetTagStatus(tag.Status),
		ViewerIsOwner: viewerIsOwner,
	}
	if profile != nil {
		page.Profile = &api.PetPageProfile{
			Handle:   profile.Handle,
			PetName:  profile.PetName,
			Species:  api.PetSpecies(profile.Species),
			PhotoUrl: profile.PhotoUrl,
			Breed:    profile.Breed,
			Age:      profile.Age,
			Weight:   profile.Weight,
			LostMode: profile.LostMode,
			Medical:  petMedicalDTO(profile.Medical),
			Socials:  petSocialsDTO(profile.Socials),
			Contact:  petContactDTO(profile.OwnerContact, viewerIsOwner || profile.LostMode, viewerIsOwner),
		}
	}
	return page
}

// petMedicalDTO unmarshals the medical jsonb to the public block, returning nil (omitted) when it carries no
// data — an empty {} shouldn't render an empty section. allergies drives the on-page allergy warning.
func petMedicalDTO(b []byte) *api.PetMedical {
	if len(b) == 0 {
		return nil
	}
	var m api.PetMedical
	if err := json.Unmarshal(b, &m); err != nil {
		return nil // a corrupt medical blob just drops the section, never 500s the whole page
	}
	if m.Allergies == nil && m.Neutered == nil && m.Vaccinated == nil && m.VetClinic == nil {
		return nil
	}
	return &m
}

// petSocialsDTO unmarshals the socials jsonb, returning nil (omitted) when empty so the FE renders no pills.
func petSocialsDTO(b []byte) *[]api.PetSocial {
	if len(b) == 0 {
		return nil
	}
	var s []api.PetSocial
	if err := json.Unmarshal(b, &s); err != nil || len(s) == 0 {
		return nil
	}
	return &s
}

// petOwnerContactRow is the stored owner_contact jsonb (spec §10) — the raw values onboarding captured.
type petOwnerContactRow struct {
	Name  string `json:"name"`
	Phone string `json:"phone"`
	Zalo  string `json:"zalo"`
	Email string `json:"email"`
}

// petContactDTO projects the owner contact to the page with PDPL masking. phoneMasked is ALWAYS present (the
// safe partial). When reveal is false (a stranger on an at-home page) that is ALL that ships — no callable
// value leaves the server. When reveal is true (lost mode, or the owner) the full phone/zalo/email are
// included so the finder can reach the owner. The owner name is included only for the owner (viewerIsOwner);
// a finder never needs it (the CTAs read "sen của {petName}").
func petContactDTO(b []byte, reveal, viewerIsOwner bool) api.PetPageContact {
	var c petOwnerContactRow
	if len(b) > 0 {
		_ = json.Unmarshal(b, &c) // a corrupt blob yields an empty contact + a "••••" mask, never a leak
	}
	contact := api.PetPageContact{
		Masked:      !reveal,
		PhoneMasked: maskPhone(c.Phone),
	}
	if viewerIsOwner && c.Name != "" {
		contact.Name = &c.Name
	}
	if reveal {
		if c.Phone != "" {
			contact.Phone = &c.Phone
		}
		if c.Zalo != "" {
			contact.Zalo = &c.Zalo
		}
		if c.Email != "" {
			contact.Email = &c.Email
		}
	}
	return contact
}

// maskPhone renders the PDPL-safe partial phone (spec §10: "+84 90 •••• 261"). Onboarding validates the
// number as ^(0|\+84)\d{9}$, so it folds to 9 national digits; the mask shows the first 2 + last 3, bulleting
// the middle. Anything that doesn't fold to ≥5 digits (corrupt/absent) returns bullets only — never a leak.
func maskPhone(raw string) string {
	national := strings.TrimPrefix(strings.TrimPrefix(strings.TrimSpace(raw), "+84"), "0")
	var digits strings.Builder
	for _, r := range national {
		if r >= '0' && r <= '9' {
			digits.WriteRune(r)
		}
	}
	n := digits.String()
	if len(n) < 5 {
		return "••••"
	}
	return fmt.Sprintf("+84 %s •••• %s", n[:2], n[len(n)-3:])
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
