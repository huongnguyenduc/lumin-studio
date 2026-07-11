package httpapi

import (
	"testing"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
)

// cleanPartInput trims the name, requires it non-empty within the cap, and defaults displayOrder to 0.
func TestCleanPartInput(t *testing.T) {
	order := 3
	name, ord, fields := cleanPartInput(api.PartInput{Name: " Chao đèn ", DisplayOrder: &order})
	if len(fields) != 0 || name != "Chao đèn" || ord != 3 {
		t.Fatalf("valid part: name=%q order=%d fields=%v", name, ord, fields)
	}
	if _, _, f := cleanPartInput(api.PartInput{Name: "  "}); f["name"] == "" {
		t.Fatalf("empty name should be a field error, got %v", f)
	}
}

// cleanOptionChoiceInput trims label/description, requires the label, and rejects a negative priceDelta
// (money int-VND ≥ 0, not a 23514 check-violation 500).
func TestCleanOptionChoiceInput(t *testing.T) {
	pd := int64(30_000)
	order := 2
	desc := " 12×9 cm "
	label, d, priceDelta, ord, fields := cleanOptionChoiceInput(api.OptionChoiceInput{
		Label: " M ", Description: &desc, PriceDelta: &pd, DisplayOrder: &order,
	})
	if len(fields) != 0 || label != "M" || d != "12×9 cm" || priceDelta != 30_000 || ord != 2 {
		t.Fatalf("valid choice: label=%q desc=%q pd=%d order=%d fields=%v", label, d, priceDelta, ord, fields)
	}
	if _, _, _, _, f := cleanOptionChoiceInput(api.OptionChoiceInput{Label: " "}); f["label"] == "" {
		t.Fatalf("empty label should be a field error, got %v", f)
	}
	neg := int64(-1)
	if _, _, _, _, f := cleanOptionChoiceInput(api.OptionChoiceInput{Label: "x", PriceDelta: &neg}); f["priceDelta"] == "" {
		t.Fatalf("negative priceDelta should be a field error, got %v", f)
	}
}
