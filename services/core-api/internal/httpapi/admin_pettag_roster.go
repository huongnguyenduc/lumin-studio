package httpapi

import (
	"context"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
)

// admin_pettag_roster.go — the Pet Tag roster (P3-t t-5, spec §10 "Màn Pet Tag"). One read: every tag with
// its lifecycle status + the linked pet (@handle/name/species/lost-mode, once ACTIVATED). Admin-gated (owner
// AND staff via the default classify — fulfillment work, mirrors the print board + customers). Read-only,
// MONEY-FREE, and no owner PII: the pet is identified by its public @handle, never the customer account. The
// tag lifecycle is SEPARATE from OrderStatus (no statusHistory). The FE filters the roster by status in
// memory (mirrors the customers list), so this endpoint takes no query param.

// GetAdminPetTags handles GET /admin/pet-tags (P3-t t-5): the whole tag roster, newest first, each row
// carrying the pet-page URL (composed from PET_TAG_BASE_URL) + the linked pet's public fields.
func (s *Server) GetAdminPetTags(ctx context.Context, _ api.GetAdminPetTagsRequestObject) (api.GetAdminPetTagsResponseObject, error) {
	rows, err := db.NewPetTags(s.pool).ListForAdmin(ctx)
	if err != nil {
		return nil, err
	}
	return api.GetAdminPetTags200JSONResponse(adminPetTagsDTO(rows, s.petPageURL)), nil
}

// adminPetTagsDTO maps the roster rows to the wire list. Pure (no I/O — the pet-page URL is composed by the
// injected petPageURL func) so the row→DTO wiring is pinned by a Docker-free unit test. A nil/empty result
// yields a non-nil empty slice so the JSON renders `[]`, not `null` (spec §03). The pet-derived fields
// (handle/petName/species/lostMode) are nil for a tag with no profile → omitted from the wire (omitempty).
func adminPetTagsDTO(rows []sqlc.ListPetTagsRow, petPageURL func(shortID string) string) []api.AdminPetTag {
	out := make([]api.AdminPetTag, len(rows))
	for i, r := range rows {
		tag := api.AdminPetTag{
			Id:        r.ID,
			Code:      r.Code,
			Status:    api.PetTagStatus(r.Status),
			Url:       petPageURL(r.ShortID),
			ChipUid:   r.ChipUid, // *string, omitempty until the chip is written
			CreatedAt: r.CreatedAt.Time,
			Handle:    r.Handle,   // nil until ACTIVATED (LEFT JOIN)
			PetName:   r.PetName,  // nil until ACTIVATED
			LostMode:  r.LostMode, // nil until ACTIVATED
		}
		if r.Species.Valid {
			sp := api.PetSpecies(r.Species.PetSpecies)
			tag.Species = &sp
		}
		out[i] = tag
	}
	return out
}
