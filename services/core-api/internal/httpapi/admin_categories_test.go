package httpapi

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/order"
)

// --- Docker-free unit -----------------------------------------------------------------

// Every category WRITE is owner-only (P3-o; spec §08 catalog is an owner power). Each rejects a staff actor
// with 403 and an absent actor with 401 BEFORE any DB touch (nil pool) — defense in depth behind the
// authOwnerOnly boundary gate, so a classify() regress cannot let staff mutate the taxonomy. Mirror of
// TestAdminProductWritesAreOwnerOnly. GetAdminCategories is an admin READ (owner+staff), so it is excluded.
func TestAdminCategoryWritesAreOwnerOnly(t *testing.T) {
	srv := NewServer(slog.New(slog.NewTextHandler(io.Discard, nil)), nil, nil, nil)
	id := uuid.New()
	in := api.CategoryInput{Slug: "x", Name: "x"}
	upd := api.CategoryUpdate{Slug: "x", Name: "x", Visible: true}

	calls := map[string]func(context.Context) error{
		"CreateAdminCategory": func(ctx context.Context) error {
			_, err := srv.CreateAdminCategory(ctx, api.CreateAdminCategoryRequestObject{Body: &in})
			return err
		},
		"UpdateAdminCategory": func(ctx context.Context) error {
			_, err := srv.UpdateAdminCategory(ctx, api.UpdateAdminCategoryRequestObject{Id: id, Body: &upd})
			return err
		},
		"DeleteAdminCategory": func(ctx context.Context) error {
			_, err := srv.DeleteAdminCategory(ctx, api.DeleteAdminCategoryRequestObject{Id: id})
			return err
		},
		"ReorderAdminCategories": func(ctx context.Context) error {
			_, err := srv.ReorderAdminCategories(ctx, api.ReorderAdminCategoriesRequestObject{Body: &api.CategoryReorder{Ids: []uuid.UUID{id}}})
			return err
		},
	}
	for name, call := range calls {
		t.Run(name+"/staff→403", func(t *testing.T) {
			ctx := withActor(context.Background(), Actor{ByUser: uuid.NewString(), Role: order.RoleStaff, At: time.Now().UTC()})
			if err := call(ctx); !errors.Is(err, errForbidden) {
				t.Fatalf("staff: err = %v, want errForbidden", err)
			}
		})
		t.Run(name+"/no-actor→401", func(t *testing.T) {
			if err := call(context.Background()); !errors.Is(err, errUnauthenticated) {
				t.Fatalf("no actor: err = %v, want errUnauthenticated", err)
			}
		})
	}
}

// cleanCategoryInput trims + validates a category body before any DB write: a valid body is trimmed and
// passes; a junk slug (kept out of the storefront URL) and an empty/over-long name are per-field 400s.
func TestCleanCategoryInput(t *testing.T) {
	slug, name, fields := cleanCategoryInput(api.CategoryInput{Slug: " den-de-ban ", Name: " Đèn để bàn "})
	if len(fields) != 0 {
		t.Fatalf("valid category rejected: %v", fields)
	}
	if slug != "den-de-ban" || name != "Đèn để bàn" {
		t.Fatalf("trim wrong: slug=%q name=%q", slug, name)
	}

	if _, _, f := cleanCategoryInput(api.CategoryInput{Slug: "Den De Ban", Name: "x"}); f["slug"] == "" {
		t.Errorf("uppercase/spaced slug should be a slug field error, got %v", f)
	}
	if _, _, f := cleanCategoryInput(api.CategoryInput{Slug: "ok", Name: "   "}); f["name"] == "" {
		t.Errorf("blank name should be a name field error, got %v", f)
	}
	if _, _, f := cleanCategoryInput(api.CategoryInput{Slug: "ok", Name: strings.Repeat("a", maxCategoryNameChars+1)}); f["name"] == "" {
		t.Errorf("over-long name should be a name field error, got %v", f)
	}
}

// cleanCategoryUpdate reuses the slug/name rules and adds the o-2 metadata: a valid edit body is trimmed and
// passes; an over-long description/imageUrl is a per-field 400; slug/name faults are still reported (and
// collected ALONGSIDE the metadata faults, not short-circuited).
func TestCleanCategoryUpdate(t *testing.T) {
	slug, name, desc, img, visible, fields := cleanCategoryUpdate(api.CategoryUpdate{
		Slug: " den-de-ban ", Name: " Đèn để bàn ", Description: " ánh ấm ", ImageUrl: " https://a/x.jpg ", Visible: false,
	})
	if len(fields) != 0 {
		t.Fatalf("valid update rejected: %v", fields)
	}
	if slug != "den-de-ban" || name != "Đèn để bàn" || desc != "ánh ấm" || img != "https://a/x.jpg" || visible {
		t.Fatalf("trim/carry wrong: slug=%q name=%q desc=%q img=%q visible=%v", slug, name, desc, img, visible)
	}

	if _, _, _, _, _, f := cleanCategoryUpdate(api.CategoryUpdate{Slug: "ok", Name: "ok", Description: strings.Repeat("a", maxCategoryDescChars+1)}); f["description"] == "" {
		t.Errorf("over-long description should be a description field error, got %v", f)
	}
	if _, _, _, _, _, f := cleanCategoryUpdate(api.CategoryUpdate{Slug: "ok", Name: "ok", ImageUrl: strings.Repeat("a", maxCategoryImageURLChars+1)}); f["imageUrl"] == "" {
		t.Errorf("over-long imageUrl should be an imageUrl field error, got %v", f)
	}
	// A bad slug AND a bad description both surface (all-faults-at-once, not short-circuited).
	if _, _, _, _, _, f := cleanCategoryUpdate(api.CategoryUpdate{Slug: "Bad Slug", Name: "ok", Description: strings.Repeat("a", maxCategoryDescChars+1)}); f["slug"] == "" || f["description"] == "" {
		t.Errorf("both slug and description faults should surface, got %v", f)
	}
}
