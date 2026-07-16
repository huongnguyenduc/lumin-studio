package httpapi

import (
	"strings"
	"testing"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
)

// cleanPartInput trims the name, requires it non-empty within the cap, defaults displayOrder to 0, carries
// the ADR-039 per-part est (default 0, must be ≥ 0), and trims + caps the f-2 model-object handle.
func TestCleanPartInput(t *testing.T) {
	order := 3
	est := int64(45)
	obj := "  Chao đèn  "
	name, ord, gotEst, gotObj, fields := cleanPartInput(api.PartInput{Name: " Chao đèn ", DisplayOrder: &order, EstFilamentQty: &est, ModelObjectName: &obj})
	if len(fields) != 0 || name != "Chao đèn" || ord != 3 || gotEst != 45 || gotObj != "Chao đèn" {
		t.Fatalf("valid part: name=%q order=%d est=%d obj=%q fields=%v", name, ord, gotEst, gotObj, fields)
	}
	if _, _, _, _, f := cleanPartInput(api.PartInput{Name: "  "}); f["name"] == "" {
		t.Fatalf("empty name should be a field error, got %v", f)
	}
	neg := int64(-1)
	if _, _, _, _, f := cleanPartInput(api.PartInput{Name: "x", EstFilamentQty: &neg}); f["estFilamentQty"] == "" {
		t.Fatalf("negative estFilamentQty should be a field error, got %v", f)
	}
	// f-2: an over-long object handle is a field error (a capped, best-effort mapping — never a doomed insert).
	long := strings.Repeat("x", maxPartNameChars+1)
	if _, _, _, _, f := cleanPartInput(api.PartInput{Name: "x", ModelObjectName: &long}); f["modelObjectName"] == "" {
		t.Fatalf("over-long modelObjectName should be a field error, got %v", f)
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
