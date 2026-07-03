package httpapi

import (
	"encoding/json"
	"testing"

	"github.com/google/uuid"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
)

// TestCategoriesDTO pins the row→wire mapping and the zero-state contract WITHOUT a DB (Docker-free). The
// mapping is trivial (three passthrough fields), but the empty/nil case is load-bearing: categoriesDTO must
// return a NON-nil slice so the endpoint renders JSON `[]`, never `null` (spec §03 zero-state) — a `null`
// body would break the storefront chip list (a client `.map` over null throws).
func TestCategoriesDTO(t *testing.T) {
	t.Run("maps fields in row order", func(t *testing.T) {
		id1, id2 := uuid.New(), uuid.New()
		rows := []sqlc.Category{
			{ID: id1, Slug: "den", Name: "Đèn"},
			{ID: id2, Slug: "moc-khoa", Name: "Móc khoá"},
		}
		got := categoriesDTO(rows)
		if len(got) != 2 {
			t.Fatalf("len = %d, want 2", len(got))
		}
		if got[0].Id != id1 || got[0].Slug != "den" || got[0].Name != "Đèn" {
			t.Errorf("row0 = %+v, want id=%s slug=den name=Đèn", got[0], id1)
		}
		if got[1].Id != id2 || got[1].Slug != "moc-khoa" || got[1].Name != "Móc khoá" {
			t.Errorf("row1 = %+v, want id=%s slug=moc-khoa name=Móc khoá", got[1], id2)
		}
	})

	t.Run("empty/nil input → non-nil slice marshals to []", func(t *testing.T) {
		for name, in := range map[string][]sqlc.Category{"nil": nil, "empty": {}} {
			got := categoriesDTO(in)
			if got == nil {
				t.Fatalf("%s input → nil slice (would render JSON null, not [])", name)
			}
			buf, err := json.Marshal(got)
			if err != nil {
				t.Fatalf("%s marshal: %v", name, err)
			}
			if string(buf) != "[]" {
				t.Errorf("%s input marshaled to %q, want []", name, buf)
			}
		}
	})
}
