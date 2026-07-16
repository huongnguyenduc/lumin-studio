package httpapi

import (
	"reflect"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
)

// spritePartColors freezes each mapped part's DEFAULT colour (the first AVAILABLE colour in catalog order)
// into the {objectName → hex} render snapshot (f-5, oracle D-C/D-E). Proven purely (no DB): unmapped parts
// and parts with no available colour are omitted (they render in the baked material, never grey), flat
// colours (no partId) are ignored, and a hex that isn't #RRGGBB rejects the whole build (a poison colour
// never reaches Blender).
func TestSpritePartColors(t *testing.T) {
	shade := uuid.New()
	base := uuid.New()
	unmapped := uuid.New()
	nocolor := uuid.New()
	partID := func(p uuid.UUID) pgtype.UUID { return pgtype.UUID{Bytes: p, Valid: true} }

	parts := []sqlc.Part{
		{ID: shade, ModelObjectName: "Chao đèn"},
		{ID: base, ModelObjectName: "Đế"},
		{ID: unmapped, ModelObjectName: ""},    // no object handle → omitted
		{ID: nocolor, ModelObjectName: "Trục"}, // mapped, but its only colour is unavailable → omitted
	}
	colors := []sqlc.Color{
		{PartID: partID(shade), Hex: "#E8B923", Available: false}, // first for shade but unavailable → skip
		{PartID: partID(shade), Hex: "#111111", Available: true},  // → shade's default (first AVAILABLE)
		{PartID: partID(base), Hex: "#3A3A3A", Available: true},   // → base's default
		{PartID: partID(nocolor), Hex: "#FFFFFF", Available: false},
		{PartID: pgtype.UUID{Valid: false}, Hex: "#ABCDEF", Available: true}, // flat colour → ignored
	}

	got, err := spritePartColors(parts, colors)
	if err != nil {
		t.Fatalf("spritePartColors: %v", err)
	}
	want := map[string]string{"Chao đèn": "#111111", "Đế": "#3A3A3A"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("map = %v, want %v", got, want)
	}

	// A malformed hex destined for the render payload rejects the whole build (D-E), never a silent skip.
	bad := []sqlc.Color{{PartID: partID(shade), Hex: "red", Available: true}}
	if _, err := spritePartColors([]sqlc.Part{{ID: shade, ModelObjectName: "Chao đèn"}}, bad); err == nil {
		t.Fatal("malformed hex: want error, got nil")
	}

	// No parts at all → empty (not nil-panic); a model with no mapping renders uncoloured.
	if m, err := spritePartColors(nil, nil); err != nil || len(m) != 0 {
		t.Fatalf("empty: m=%v err=%v", m, err)
	}
}
