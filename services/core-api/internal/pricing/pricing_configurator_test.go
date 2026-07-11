package pricing

import (
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
)

// cfgIDs are the ids of the configurator fixture (ADR-037): a product with two named parts (each with
// a part-colour + an unavailable part-colour), a `choice` option that offers choices, a text option,
// and a legacy toggle choice-option that offers NO choices.
type cfgIDs struct {
	product                   uuid.UUID
	partA, partB              uuid.UUID
	colorA, colorAout, colorB uuid.UUID
	optSize, choiceS, choiceM uuid.UUID
	optText, optToggle        uuid.UUID
}

func cfgFixture() (sqlc.Product, []sqlc.Color, []sqlc.Option, []sqlc.Part, []sqlc.OptionChoice, cfgIDs) {
	i := cfgIDs{
		product: uuid.New(),
		partA:   uuid.New(), partB: uuid.New(),
		colorA: uuid.New(), colorAout: uuid.New(), colorB: uuid.New(),
		optSize: uuid.New(), choiceS: uuid.New(), choiceM: uuid.New(),
		optText: uuid.New(), optToggle: uuid.New(),
	}
	pgPart := func(id uuid.UUID) pgtype.UUID { return pgtype.UUID{Bytes: id, Valid: true} }
	p := sqlc.Product{ID: i.product, BasePrice: 100_000}
	colors := []sqlc.Color{
		{ID: i.colorA, ProductID: i.product, Name: "Cam", Available: true, PriceDelta: 10_000, PartID: pgPart(i.partA)},
		{ID: i.colorAout, ProductID: i.product, Name: "Cam hết", Available: false, PriceDelta: 10_000, PartID: pgPart(i.partA)},
		{ID: i.colorB, ProductID: i.product, Name: "Trắng", Available: true, PriceDelta: 5_000, PartID: pgPart(i.partB)},
	}
	parts := []sqlc.Part{
		{ID: i.partA, ProductID: i.product, Name: "Chao đèn"},
		{ID: i.partB, ProductID: i.product, Name: "Đế"},
	}
	max := int32(12)
	options := []sqlc.Option{
		// optSize's own PriceDelta is deliberately huge: a choice-option that offers choices is priced by
		// the picked choice, NOT the option base (ADR-037, one price source) — the tests assert base is ignored.
		{ID: i.optSize, ProductID: i.product, Label: "Kích thước", Type: sqlc.OptionTypeChoice, PriceDelta: 999_999},
		{ID: i.optText, ProductID: i.product, Label: "Khắc tên", Type: sqlc.OptionTypeText, PriceDelta: 30_000, MaxChars: &max},
		{ID: i.optToggle, ProductID: i.product, Label: "Gói quà", Type: sqlc.OptionTypeChoice, PriceDelta: 20_000},
	}
	choices := []sqlc.OptionChoice{
		{ID: i.choiceS, OptionID: i.optSize, Label: "S", PriceDelta: 0},
		{ID: i.choiceM, OptionID: i.optSize, Label: "M", PriceDelta: 40_000},
	}
	return p, colors, options, parts, choices, i
}

// Happy path: one colour per part + one choice → base + Σ part-colour deltas + the picked choice delta.
func TestPriceConfiguratorHappy(t *testing.T) {
	p, colors, options, parts, choices, i := cfgFixture()
	got, err := PriceItem(p, colors, options, parts, choices, Selection{
		PartColors:    []PartColorSelection{{PartID: i.partA, ColorID: i.colorA}, {PartID: i.partB, ColorID: i.colorB}},
		OptionChoices: []OptionChoiceSelection{{OptionID: i.optSize, ChoiceID: i.choiceM}},
	})
	if err != nil {
		t.Fatalf("PriceItem: %v", err)
	}
	// 100_000 + 10_000 (partA/Cam) + 5_000 (partB/Trắng) + 40_000 (choice M) = 155_000
	if got != 155_000 {
		t.Fatalf("unit = %d, want 155000", got)
	}
}

// A choice option is priced by its picked choice, never the option's own base (ADR-037 one price source):
// choiceS has delta 0, so the unit must NOT include optSize.PriceDelta (999_999).
func TestPriceConfiguratorChoiceIgnoresOptionBase(t *testing.T) {
	p, colors, options, parts, choices, i := cfgFixture()
	got, err := PriceItem(p, colors, options, parts, choices, Selection{
		PartColors:    []PartColorSelection{{PartID: i.partA, ColorID: i.colorA}, {PartID: i.partB, ColorID: i.colorB}},
		OptionChoices: []OptionChoiceSelection{{OptionID: i.optSize, ChoiceID: i.choiceS}},
	})
	if err != nil {
		t.Fatalf("PriceItem: %v", err)
	}
	if got != 115_000 { // 100k + 10k + 5k + 0 — NOT + 999_999
		t.Fatalf("unit = %d, want 115000 (choice base 0, option base ignored)", got)
	}
}

// A `choice` option with NO choices is a legacy toggle, priced by the option delta via OptionIDs.
func TestPriceConfiguratorLegacyToggle(t *testing.T) {
	p, colors, options, parts, choices, i := cfgFixture()
	got, err := PriceItem(p, colors, options, parts, choices, Selection{
		PartColors: []PartColorSelection{{PartID: i.partA, ColorID: i.colorA}, {PartID: i.partB, ColorID: i.colorB}},
		OptionIDs:  []uuid.UUID{i.optToggle},
	})
	if err != nil {
		t.Fatalf("PriceItem: %v", err)
	}
	if got != 135_000 { // 100k + 10k + 5k + 20k (toggle)
		t.Fatalf("unit = %d, want 135000 (legacy toggle)", got)
	}
}

// The full matrix of invalid selections — each is a distinct 422 sentinel (the money-path guards).
func TestPriceConfiguratorInvalid(t *testing.T) {
	p, colors, options, parts, choices, i := cfgFixture()
	bogus := uuid.New()
	both := []PartColorSelection{{PartID: i.partA, ColorID: i.colorA}, {PartID: i.partB, ColorID: i.colorB}}

	cases := map[string]struct {
		sel  Selection
		want error
	}{
		"missing part colour": {
			Selection{PartColors: []PartColorSelection{{PartID: i.partA, ColorID: i.colorA}}}, // partB unselected
			ErrMissingPartColor,
		},
		"colour of the wrong part": {
			Selection{PartColors: []PartColorSelection{{PartID: i.partA, ColorID: i.colorB}, {PartID: i.partB, ColorID: i.colorB}}},
			ErrColorNotForPart,
		},
		"duplicate part": {
			Selection{PartColors: []PartColorSelection{{PartID: i.partA, ColorID: i.colorA}, {PartID: i.partA, ColorID: i.colorA}}},
			ErrDuplicatePartColor,
		},
		"flat ColorID on parts product": {
			Selection{ColorID: &i.colorA, PartColors: both},
			ErrColorForPartsProduct,
		},
		"extra bogus part": {
			Selection{PartColors: append(append([]PartColorSelection{}, both...), PartColorSelection{PartID: bogus, ColorID: i.colorA})},
			ErrColorNotForPart,
		},
		"unavailable part colour": {
			Selection{PartColors: []PartColorSelection{{PartID: i.partA, ColorID: i.colorAout}, {PartID: i.partB, ColorID: i.colorB}}},
			ErrColorUnavailable,
		},
		"unknown colour for part": {
			Selection{PartColors: []PartColorSelection{{PartID: i.partA, ColorID: bogus}, {PartID: i.partB, ColorID: i.colorB}}},
			ErrColorNotForProduct,
		},
		"choice option toggled instead of chosen": {
			Selection{PartColors: both, OptionIDs: []uuid.UUID{i.optSize}},
			ErrOptionNeedsChoice,
		},
		"unknown choice for option": {
			Selection{PartColors: both, OptionChoices: []OptionChoiceSelection{{OptionID: i.optSize, ChoiceID: bogus}}},
			ErrChoiceNotForOption,
		},
		"choice on a text option": {
			Selection{PartColors: both, OptionChoices: []OptionChoiceSelection{{OptionID: i.optText, ChoiceID: i.choiceM}}},
			ErrChoiceNotForOption,
		},
		"duplicate option choice": {
			Selection{PartColors: both, OptionChoices: []OptionChoiceSelection{{OptionID: i.optSize, ChoiceID: i.choiceM}, {OptionID: i.optSize, ChoiceID: i.choiceS}}},
			ErrDuplicateOptionChoice,
		},
		"option both toggled and choice-picked": {
			Selection{PartColors: both, OptionIDs: []uuid.UUID{i.optToggle}, OptionChoices: []OptionChoiceSelection{{OptionID: i.optToggle, ChoiceID: i.choiceS}}},
			ErrDuplicateOption,
		},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := PriceItem(p, colors, options, parts, choices, tc.sel); !errors.Is(err, tc.want) {
				t.Fatalf("err = %v, want %v", err, tc.want)
			}
		})
	}
}

// A flat product (no parts) rejects a per-part selection — the two modes never mix.
func TestPriceFlatRejectsPartColors(t *testing.T) {
	p, colors, options, _ := fixture() // the flat fixture from pricing_test.go
	if _, err := PriceItem(p, colors, options, nil, nil, Selection{
		PartColors: []PartColorSelection{{PartID: uuid.New(), ColorID: uuid.New()}},
	}); !errors.Is(err, ErrPartColorForFlatProduct) {
		t.Fatalf("err = %v, want ErrPartColorForFlatProduct", err)
	}
}
