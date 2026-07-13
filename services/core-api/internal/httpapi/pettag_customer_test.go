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

// TestMaskPhone pins the PDPL masked-phone shape (spec §10 "+84 90 •••• 261"): first 2 + last 3 national
// digits, middle bulleted, from either a 0… or +84… number. A number that doesn't fold to ≥5 digits (absent
// or corrupt) NEVER leaks digits — it masks to bullets only.
func TestMaskPhone(t *testing.T) {
	cases := []struct{ in, want string }{
		{"0905552261", "+84 90 •••• 261"},
		{"+84905552261", "+84 90 •••• 261"},
		{"0912345678", "+84 91 •••• 678"},
		{" 0905552261 ", "+84 90 •••• 261"},
		{"", "••••"},
		{"123", "••••"},
	}
	for _, tc := range cases {
		if got := maskPhone(tc.in); got != tc.want {
			t.Fatalf("maskPhone(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

// TestPetContactDTO is the PDPL masking gate in isolation (no DB): when reveal is false ONLY the masked
// phone ships — no callable value leaves the server; when reveal is true the full phone/zalo ship; and the
// owner name is included ONLY for the owner (a finder never gets it). This is the load-bearing privacy rule.
func TestPetContactDTO(t *testing.T) {
	raw := []byte(`{"name":"Mai Lê","phone":"0905552261","zalo":"0905550000"}`)

	// Stranger, at-home page (reveal=false): masked, and NOTHING callable ships.
	home := petContactDTO(raw, false, false)
	if !home.Masked || home.Phone != nil || home.Zalo != nil || home.Name != nil {
		t.Fatalf("home contact leaked PII: %+v", home)
	}
	if home.PhoneMasked != "+84 90 •••• 261" {
		t.Fatalf("home masked phone = %q, want the partial", home.PhoneMasked)
	}

	// Stranger, lost page (reveal=true, not owner): full phone/zalo revealed, but NO owner name.
	lost := petContactDTO(raw, true, false)
	if lost.Masked || lost.Phone == nil || *lost.Phone != "0905552261" || lost.Zalo == nil {
		t.Fatalf("lost contact should reveal phone+zalo: %+v", lost)
	}
	if lost.Name != nil {
		t.Fatalf("lost (stranger) contact exposed owner name %q — finders must not get it", *lost.Name)
	}

	// Owner viewing (reveal=true, owner): full contact + the owner's own name.
	owner := petContactDTO(raw, true, true)
	if owner.Name == nil || *owner.Name != "Mai Lê" || owner.Phone == nil {
		t.Fatalf("owner contact should include name+phone: %+v", owner)
	}
}
