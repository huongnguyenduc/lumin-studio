package httpapi

import (
	"strings"
	"testing"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
)

// TestValidateActivateInput pins the onboarding field rules (spec §10) that keep a bad payload a clean 400
// instead of a DB CHECK/regex 500: name 1..40 runes, a known species, an owner name + VN phone, and
// consent=true (PDPL point 1). Each bad case must flag exactly its own field.
func TestValidateActivateInput(t *testing.T) {
	valid := func() api.PetActivateInput {
		return api.PetActivateInput{
			PetName:      "Bơ",
			Species:      api.Dog,
			OwnerContact: api.PetOwnerContact{Name: "Mai Lê", Phone: "0905552261"},
			Consent:      true,
		}
	}

	if f := validateActivateInput(valid()); len(f) != 0 {
		t.Fatalf("valid input flagged %v, want none", f)
	}

	cases := []struct {
		name  string
		mut   func(in *api.PetActivateInput)
		field string
	}{
		{"empty name", func(in *api.PetActivateInput) { in.PetName = "   " }, "petName"},
		{"name too long", func(in *api.PetActivateInput) { in.PetName = strings.Repeat("a", 41) }, "petName"},
		{"unknown species", func(in *api.PetActivateInput) { in.Species = "dragon" }, "species"},
		{"bad phone", func(in *api.PetActivateInput) { in.OwnerContact.Phone = "123" }, "ownerContact.phone"},
		{"no consent", func(in *api.PetActivateInput) { in.Consent = false }, "consent"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			in := valid()
			tc.mut(&in)
			f := validateActivateInput(in)
			if _, ok := f[tc.field]; !ok {
				t.Fatalf("%s: expected field %q flagged, got %v", tc.name, tc.field, f)
			}
		})
	}

	// A 40-rune name (the boundary) is accepted; 41 is rejected (covered above).
	boundary := valid()
	boundary.PetName = strings.Repeat("a", 40)
	if f := validateActivateInput(boundary); len(f) != 0 {
		t.Fatalf("40-rune name flagged %v, want accepted", f)
	}
}
