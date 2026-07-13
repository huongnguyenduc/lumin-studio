package httpapi

import (
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
)

// stubURL is a deterministic petPageURL for the pure DTO test — it lets the test assert the roster composes
// the pet-page URL from the row's short_id without a running Server (the real petPageURL uses PET_TAG_BASE_URL).
// strptr/boolptr are shared test helpers (admin_filament_test.go).
func stubURL(shortID string) string { return "https://pet.test/t/" + shortID }

// TestAdminPetTagsDTO pins the row→wire mapping of the roster (P3-t t-5): the URL is composed from short_id;
// chipUid passes through (nil until ENCODED); and the pet-derived fields (handle/petName/species/lostMode)
// are nil for a tag with no profile (a LEFT JOIN miss) and populated once ACTIVATED. Docker-free.
func TestAdminPetTagsDTO(t *testing.T) {
	// Empty in → non-nil empty slice (JSON `[]`, not `null` — spec §03).
	if got := adminPetTagsDTO(nil, stubURL); got == nil || len(got) != 0 {
		t.Fatalf("empty rows → %#v, want non-nil empty slice", got)
	}

	unencodedID, encodedID, activatedID := uuid.New(), uuid.New(), uuid.New()
	rows := []sqlc.ListPetTagsRow{
		// UNENCODED — freshly minted, blank chip, no pet yet (all LEFT-JOIN columns NULL).
		{ID: unencodedID, Code: "#LMN-T0001", ShortID: "aaa", Status: sqlc.PetTagStatusUNENCODED, CreatedAt: pgtype.Timestamptz{Valid: true}},
		// ENCODED — chip written, still no pet.
		{ID: encodedID, Code: "#LMN-T0002", ShortID: "bbb", Status: sqlc.PetTagStatusENCODED, ChipUid: strptr("04:A1:B2:C3"), CreatedAt: pgtype.Timestamptz{Valid: true}},
		// ACTIVATED — linked to a pet in lost mode.
		{
			ID: activatedID, Code: "#LMN-T0003", ShortID: "ccc", Status: sqlc.PetTagStatusACTIVATED,
			ChipUid: strptr("04:D4:E5:F6"), CreatedAt: pgtype.Timestamptz{Valid: true},
			Handle: strptr("bo"), PetName: strptr("Bơ"), Species: sqlc.NullPetSpecies{PetSpecies: sqlc.PetSpeciesDog, Valid: true}, LostMode: boolptr(true),
		},
	}

	got := adminPetTagsDTO(rows, stubURL)
	if len(got) != 3 {
		t.Fatalf("got %d rows, want 3", len(got))
	}

	// Order preserved (the query already sorts newest-first).
	un, en, ac := got[0], got[1], got[2]

	// URL composed from short_id for every row, regardless of status.
	if un.Url != "https://pet.test/t/aaa" || ac.Url != "https://pet.test/t/ccc" {
		t.Fatalf("url not composed from short_id: %q / %q", un.Url, ac.Url)
	}

	// UNENCODED: no chip, no pet fields.
	if un.Status != api.UNENCODED || un.ChipUid != nil || un.Handle != nil || un.PetName != nil || un.Species != nil || un.LostMode != nil {
		t.Fatalf("unencoded row leaked chip/pet fields: %+v", un)
	}

	// ENCODED: chip present, still no pet.
	if en.Status != api.ENCODED || en.ChipUid == nil || *en.ChipUid != "04:A1:B2:C3" || en.Handle != nil || en.Species != nil {
		t.Fatalf("encoded row wrong: %+v", en)
	}

	// ACTIVATED: pet fields populated, species mapped through the null-enum.
	if ac.Status != api.ACTIVATED || ac.Handle == nil || *ac.Handle != "bo" || ac.PetName == nil || *ac.PetName != "Bơ" {
		t.Fatalf("activated row missing pet fields: %+v", ac)
	}
	if ac.Species == nil || *ac.Species != api.Dog {
		t.Fatalf("activated species = %v, want dog", ac.Species)
	}
	if ac.LostMode == nil || !*ac.LostMode {
		t.Fatalf("activated lostMode = %v, want true", ac.LostMode)
	}
}
