package httpapi

import (
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
)

// TestProductDTO pins the row→wire mapping with a DISTINCT value in every field so a mis-slotted field
// (basePrice↔priceDelta, a dropped color availability) fails, and asserts the two JSONB decodes
// (dimensions object, images string array), the raw int-VND passthrough (no server-side formatting —
// always-must #2), the nullable widenings (ratingAvg, maxChars int32→*int), and that internal
// productId is dropped. Pure — runs in the Docker-free lane.
func TestProductDTO(t *testing.T) {
	pid := uuid.New()
	catID := uuid.New()
	colorID := uuid.New()
	optTextID := uuid.New()
	optChoiceID := uuid.New()
	rating := float32(4.5)
	maxChars := int32(20)
	created := mustParse(t, "2026-07-02T09:00:00Z")

	p := sqlc.Product{
		ID:          pid,
		Slug:        "den-nam",
		Name:        "Đèn nấm",
		Description: "ấm áp",
		CategoryID:  catID,
		BasePrice:   390_000,
		Dimensions:  []byte(`{"w":180,"d":180,"h":240}`),
		Material:    "PLA",
		Model3dUrl:  "https://x/m.glb",
		Images:      []byte(`["https://x/1.jpg","https://x/2.jpg"]`),
		Status:      sqlc.ProductStatusActive,
		RatingAvg:   &rating,
		ReviewCount: 7,
		CreatedAt:   pgtype.Timestamptz{Time: created, Valid: true},
	}
	colors := []sqlc.Color{{
		ID: colorID, ProductID: pid, Name: "Xanh mint", Hex: "#a8d8c8", Available: true, PriceDelta: 20_000,
	}}
	options := []sqlc.Option{
		{ID: optTextID, ProductID: pid, Label: "Khắc tên", Description: "khắc chữ", Type: sqlc.OptionTypeText, PriceDelta: 50_000, MaxChars: &maxChars},
		{ID: optChoiceID, ProductID: pid, Label: "Dimmer", Description: "chỉnh sáng", Type: sqlc.OptionTypeChoice, PriceDelta: 90_000, MaxChars: nil},
	}

	got, err := productDTO(p, colors, options)
	if err != nil {
		t.Fatalf("productDTO: %v", err)
	}

	if got.Id != pid || got.Slug != "den-nam" || got.Name != "Đèn nấm" || got.Description != "ấm áp" || got.CategoryId != catID {
		t.Fatalf("scalar identity fields wrong: %+v", got)
	}
	if got.BasePrice != 390_000 {
		t.Errorf("basePrice = %d, want 390000 raw int-VND (never formatted server-side)", got.BasePrice)
	}
	if got.Material != "PLA" || got.Model3dUrl != "https://x/m.glb" {
		t.Errorf("material/model3dUrl = %q/%q", got.Material, got.Model3dUrl)
	}
	if got.Status != "active" {
		t.Errorf("status = %q, want active", got.Status)
	}
	if got.ReviewCount != 7 {
		t.Errorf("reviewCount = %d, want 7", got.ReviewCount)
	}
	if got.RatingAvg == nil || *got.RatingAvg != 4.5 {
		t.Errorf("ratingAvg = %v, want 4.5", got.RatingAvg)
	}
	if !got.CreatedAt.Equal(created) {
		t.Errorf("createdAt = %v, want %v", got.CreatedAt, created)
	}
	// Dimensions object decode.
	if got.Dimensions.W != 180 || got.Dimensions.D != 180 || got.Dimensions.H != 240 {
		t.Errorf("dimensions = %+v, want w180 d180 h240", got.Dimensions)
	}
	// Images string-array decode, order preserved.
	if len(got.Images) != 2 || got.Images[0] != "https://x/1.jpg" || got.Images[1] != "https://x/2.jpg" {
		t.Errorf("images = %v", got.Images)
	}
	// Colors: internal productId dropped, availability + int-VND delta preserved.
	if len(got.Colors) != 1 {
		t.Fatalf("colors len = %d, want 1", len(got.Colors))
	}
	if got.Colors[0].Id != colorID || got.Colors[0].Name != "Xanh mint" || got.Colors[0].Hex != "#a8d8c8" ||
		!got.Colors[0].Available || got.Colors[0].PriceDelta != 20_000 {
		t.Errorf("color = %+v", got.Colors[0])
	}
	// Options: type + int-VND delta; maxChars widened int32→*int (text has it, choice is nil).
	if len(got.Options) != 2 {
		t.Fatalf("options len = %d, want 2", len(got.Options))
	}
	text, choice := got.Options[0], got.Options[1]
	if text.Id != optTextID || text.Type != "text" || text.PriceDelta != 50_000 {
		t.Errorf("text option = %+v", text)
	}
	if text.MaxChars == nil || *text.MaxChars != 20 {
		t.Errorf("text maxChars = %v, want 20 (widened from int32)", text.MaxChars)
	}
	if choice.Type != "choice" || choice.PriceDelta != 90_000 {
		t.Errorf("choice option = %+v", choice)
	}
	if choice.MaxChars != nil {
		t.Errorf("choice maxChars = %v, want nil (no limit)", choice.MaxChars)
	}
}

// TestProductDTOZeroState: empty colors/options and empty images decode to non-nil slices so the JSON
// renders `[]`, not `null` (spec §03 zero-state); a review-less product yields a nil ratingAvg (→ null).
func TestProductDTOZeroState(t *testing.T) {
	p := sqlc.Product{
		Slug: "trong", Dimensions: []byte(`{"w":10,"d":10,"h":10}`), Images: []byte(`[]`),
		Status: sqlc.ProductStatusActive, RatingAvg: nil, ReviewCount: 0,
		CreatedAt: pgtype.Timestamptz{Time: mustParse(t, "2026-07-02T09:00:00Z"), Valid: true},
	}
	got, err := productDTO(p, nil, nil)
	if err != nil {
		t.Fatalf("productDTO: %v", err)
	}
	if got.Images == nil || len(got.Images) != 0 {
		t.Errorf("images = %v, want non-nil empty []", got.Images)
	}
	if got.Colors == nil || len(got.Colors) != 0 {
		t.Errorf("colors = %v, want non-nil empty []", got.Colors)
	}
	if got.Options == nil || len(got.Options) != 0 {
		t.Errorf("options = %v, want non-nil empty []", got.Options)
	}
	if got.RatingAvg != nil {
		t.Errorf("ratingAvg = %v, want nil (→ JSON null)", got.RatingAvg)
	}
}

// TestProductDTOCorruptJSONB: corrupt dimensions/images JSONB is a server data fault, not a client
// error — productDTO returns an error (the handler maps it to 500 and logs), never a partial DTO.
func TestProductDTOCorruptJSONB(t *testing.T) {
	base := sqlc.Product{
		Slug: "x", Dimensions: []byte(`{"w":1,"d":1,"h":1}`), Images: []byte(`[]`),
		CreatedAt: pgtype.Timestamptz{Valid: true},
	}
	t.Run("dimensions", func(t *testing.T) {
		p := base
		p.Dimensions = []byte(`not-json`)
		if _, err := productDTO(p, nil, nil); err == nil {
			t.Fatal("want error on corrupt dimensions jsonb")
		}
	})
	t.Run("images", func(t *testing.T) {
		p := base
		p.Images = []byte(`{"not":"an-array"}`)
		if _, err := productDTO(p, nil, nil); err == nil {
			t.Fatal("want error on corrupt images jsonb")
		}
	})
}
