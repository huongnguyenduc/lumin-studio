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

	// No parts at all → empty (not nil-panic); a model with no mapping AND no colours renders uncoloured.
	if m, err := spritePartColors(nil, nil); err != nil || len(m) != 0 {
		t.Fatalf("empty: m=%v err=%v", m, err)
	}

	// A FLAT product (no parts, product-level colours) paints the whole model via the "*" match-all key
	// (_bl_render.py) in its first AVAILABLE flat colour — the same default the storefront opens on.
	flat := []sqlc.Color{
		{PartID: pgtype.UUID{Valid: false}, Hex: "#E8B923", Available: false}, // unavailable → skip
		{PartID: pgtype.UUID{Valid: false}, Hex: "#ABCDEF", Available: true},  // → the default
		{PartID: pgtype.UUID{Valid: false}, Hex: "#111111", Available: true},
	}
	if m, err := spritePartColors(nil, flat); err != nil || !reflect.DeepEqual(m, map[string]string{"*": "#ABCDEF"}) {
		t.Fatalf("flat: m=%v err=%v", m, err)
	}
	// Parts products NEVER get the wildcard — an unmapped part keeps its baked material.
	if m, err := spritePartColors(parts, colors); err != nil || m["*"] != "" {
		t.Fatalf("parts product got wildcard: m=%v err=%v", m, err)
	}
	// A malformed FLAT hex also rejects the build.
	if _, err := spritePartColors(nil, []sqlc.Color{{PartID: pgtype.UUID{Valid: false}, Hex: "gold", Available: true}}); err == nil {
		t.Fatal("malformed flat hex: want error, got nil")
	}

	// An owner-picked is_default colour BEATS catalog order — per part and flat — but an UNAVAILABLE
	// default is skipped (never freeze an out-of-stock colour into the render).
	defParts := []sqlc.Part{{ID: shade, ModelObjectName: "Chao đèn"}}
	defColors := []sqlc.Color{
		{PartID: partID(shade), Hex: "#111111", Available: true},
		{PartID: partID(shade), Hex: "#E8B923", Available: true, IsDefault: true}, // later in order, but the default
	}
	if m, err := spritePartColors(defParts, defColors); err != nil || m["Chao đèn"] != "#E8B923" {
		t.Fatalf("is_default part: m=%v err=%v", m, err)
	}
	defFlat := []sqlc.Color{
		{PartID: pgtype.UUID{Valid: false}, Hex: "#ABCDEF", Available: true},
		{PartID: pgtype.UUID{Valid: false}, Hex: "#111111", Available: true, IsDefault: true},
	}
	if m, err := spritePartColors(nil, defFlat); err != nil || m["*"] != "#111111" {
		t.Fatalf("is_default flat: m=%v err=%v", m, err)
	}
	unavailDef := []sqlc.Color{
		{PartID: pgtype.UUID{Valid: false}, Hex: "#111111", Available: false, IsDefault: true},
		{PartID: pgtype.UUID{Valid: false}, Hex: "#ABCDEF", Available: true},
	}
	if m, err := spritePartColors(nil, unavailDef); err != nil || m["*"] != "#ABCDEF" {
		t.Fatalf("unavailable is_default falls back: m=%v err=%v", m, err)
	}
}
