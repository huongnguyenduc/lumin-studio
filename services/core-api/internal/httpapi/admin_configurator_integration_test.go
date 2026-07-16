package httpapi

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
)

// Integration tests for the ADR-037 configurator write surface (Stage 2a) against real Postgres
// (testcontainers: skip local without Docker, run in CI — ADR-020). Owner actor context (owner-only is
// proven Docker-free in TestAdminProductWritesAreOwnerOnly). Exercises the full DB round-trip parts/choices
// bring: part CRUD, a colour joining a part, a flat colour, choice CRUD nested under an option, the detail
// assembly (parts[] + colour.partId + option.choices[]), plus the branches only real FKs prove —
// cross-product scoping (404), the "colour ∈ its claimed part" guard (400), and part-delete CASCADEing its
// colours (the flat colour survives).
func TestConfiguratorCRUDEndToEnd(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()
	owner := ownerCtx()
	srv := NewServer(slog.New(slog.NewTextHandler(io.Discard, nil)), pool, nil, nil)
	repo := db.NewCatalog(pool)

	cat, err := repo.CreateCategory(ctx, sqlc.InsertCategoryParams{ID: uuid.New(), Slug: "cat-cfg", Name: "DM"})
	if err != nil {
		t.Fatalf("seed category: %v", err)
	}
	mkProduct := func(slug string) uuid.UUID {
		p, err := repo.CreateProduct(ctx, sqlc.InsertProductParams{
			ID: uuid.New(), Slug: slug, Name: slug, Description: "", CategoryID: cat.ID, BasePrice: 1,
			Dimensions: []byte(`{"w":1,"d":1,"h":1}`), Material: "PLA", Images: []byte(`[]`), Status: sqlc.ProductStatusDraft,
		})
		if err != nil {
			t.Fatalf("seed product %s: %v", slug, err)
		}
		return p.ID
	}
	pid := mkProduct("den-cfg")
	mat := seedFilament(t, ctx, pool, "Cam", 100, 39_000) // f-1: a colour's name/hex come from its filament

	// --- part ---
	partResp, err := srv.CreateProductPart(owner, api.CreateProductPartRequestObject{Id: pid, Body: &api.PartInput{Name: "Chao đèn"}})
	if err != nil {
		t.Fatalf("create part: %v", err)
	}
	part := api.Part(partResp.(api.CreateProductPart201JSONResponse))

	// --- a colour that belongs to the part ---
	partColorResp, err := srv.CreateProductColor(owner, api.CreateProductColorRequestObject{Id: pid, Body: &api.ColorInput{Available: true, PartId: &part.Id, FilamentMaterialId: mat}})
	if err != nil {
		t.Fatalf("create part colour: %v", err)
	}
	partColor := api.Color(partColorResp.(api.CreateProductColor201JSONResponse))
	if partColor.PartId == nil || *partColor.PartId != part.Id {
		t.Fatalf("part colour partId = %v, want %v", partColor.PartId, part.Id)
	}

	// --- a flat colour (no part) ---
	flatResp, err := srv.CreateProductColor(owner, api.CreateProductColorRequestObject{Id: pid, Body: &api.ColorInput{Available: true, FilamentMaterialId: mat}})
	if err != nil {
		t.Fatalf("create flat colour: %v", err)
	}
	if flat := api.Color(flatResp.(api.CreateProductColor201JSONResponse)); flat.PartId != nil {
		t.Fatalf("flat colour partId = %v, want nil", flat.PartId)
	}

	// --- option + a choice under it ---
	optResp, err := srv.CreateProductOption(owner, api.CreateProductOptionRequestObject{Id: pid, Body: &api.OptionInput{Label: "Kích thước", Type: api.OptionType("choice")}})
	if err != nil {
		t.Fatalf("create option: %v", err)
	}
	opt := api.Option(optResp.(api.CreateProductOption201JSONResponse))
	pd := int64(30_000)
	choiceResp, err := srv.CreateOptionChoice(owner, api.CreateOptionChoiceRequestObject{Id: pid, OptionId: opt.Id, Body: &api.OptionChoiceInput{Label: "M", PriceDelta: &pd}})
	if err != nil {
		t.Fatalf("create choice: %v", err)
	}
	choice := api.OptionChoice(choiceResp.(api.CreateOptionChoice201JSONResponse))

	// --- detail assembles parts[] + colour.partId + option.choices[] ---
	det := getDetail(t, srv, owner, pid)
	if len(det.Parts) != 1 || det.Parts[0].Id != part.Id {
		t.Fatalf("detail parts = %+v, want the 1 part", det.Parts)
	}
	if len(det.Colors) != 2 {
		t.Fatalf("detail colours = %d, want 2 (1 part + 1 flat)", len(det.Colors))
	}
	if len(det.Options) != 1 || len(det.Options[0].Choices) != 1 || det.Options[0].Choices[0].Id != choice.Id {
		t.Fatalf("detail option.choices = %+v, want the 1 choice", det.Options)
	}

	// --- updates ---
	if _, err := srv.UpdateProductPart(owner, api.UpdateProductPartRequestObject{Id: pid, PartId: part.Id, Body: &api.PartInput{Name: "Chao đèn v2"}}); err != nil {
		t.Fatalf("update part: %v", err)
	}
	if _, err := srv.UpdateOptionChoice(owner, api.UpdateOptionChoiceRequestObject{Id: pid, OptionId: opt.Id, ChoiceId: choice.Id, Body: &api.OptionChoiceInput{Label: "L"}}); err != nil {
		t.Fatalf("update choice: %v", err)
	}

	// --- scoping / guards (only real FKs prove these) ---
	other := mkProduct("den-other")
	otherPartResp, err := srv.CreateProductPart(owner, api.CreateProductPartRequestObject{Id: other, Body: &api.PartInput{Name: "Đế"}})
	if err != nil {
		t.Fatalf("create other part: %v", err)
	}
	otherPart := api.Part(otherPartResp.(api.CreateProductPart201JSONResponse))

	// a colour on pid claiming OTHER product's part → 400 field partId (colour ∈ its claimed part).
	if resp, err := srv.CreateProductColor(owner, api.CreateProductColorRequestObject{Id: pid, Body: &api.ColorInput{Available: true, PartId: &otherPart.Id, FilamentMaterialId: mat}}); err != nil {
		t.Fatalf("foreign-part colour: unexpected err %v", err)
	} else if _, ok := resp.(api.CreateProductColor400JSONResponse); !ok {
		t.Fatalf("foreign-part colour resp = %T, want 400", resp)
	}

	// updating pid's part through the OTHER product's path → 404.
	if _, err := srv.UpdateProductPart(owner, api.UpdateProductPartRequestObject{Id: other, PartId: part.Id, Body: &api.PartInput{Name: "hack"}}); !errors.Is(err, db.ErrNotFound) {
		t.Fatalf("cross-product part update: err = %v, want ErrNotFound (404)", err)
	}
	// a choice under an option that belongs to pid, reached through OTHER product's path → 404.
	if _, err := srv.CreateOptionChoice(owner, api.CreateOptionChoiceRequestObject{Id: other, OptionId: opt.Id, Body: &api.OptionChoiceInput{Label: "z"}}); !errors.Is(err, db.ErrNotFound) {
		t.Fatalf("cross-product choice create: err = %v, want ErrNotFound (404)", err)
	}

	// --- delete the choice, then the part (CASCADEs the part-colour; the flat colour survives) ---
	if _, err := srv.DeleteOptionChoice(owner, api.DeleteOptionChoiceRequestObject{Id: pid, OptionId: opt.Id, ChoiceId: choice.Id}); err != nil {
		t.Fatalf("delete choice: %v", err)
	}
	if _, err := srv.DeleteProductPart(owner, api.DeleteProductPartRequestObject{Id: pid, PartId: part.Id}); err != nil {
		t.Fatalf("delete part: %v", err)
	}
	det2 := getDetail(t, srv, owner, pid)
	if len(det2.Parts) != 0 {
		t.Fatalf("after delete: parts = %d, want 0", len(det2.Parts))
	}
	if len(det2.Colors) != 1 || det2.Colors[0].PartId != nil {
		t.Fatalf("after part delete: colours = %+v, want just the flat colour (part-colour cascaded)", det2.Colors)
	}
	if len(det2.Options[0].Choices) != 0 {
		t.Fatalf("after delete: option.choices = %d, want 0", len(det2.Options[0].Choices))
	}
}

// TestPartModelObjectMapping proves f-2's part↔object handle round-trips through the real DB: create/update
// stores parts.model_object_name and the DTO surfaces it; omitting the field clears it (replace semantics);
// an unmapped part omits it on the wire; an over-long name is a 400 (not a doomed insert); and — crucially —
// an ARBITRARY name matching no ingested object is ACCEPTED, not rejected. The mapping is a free handle: an
// unmatched name renders as the part's default filament downstream (plan D-C), so setting a name before
// ingest or keeping one across a re-ingest must stay valid (no membership check at the boundary).
func TestPartModelObjectMapping(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()
	owner := ownerCtx()
	srv := NewServer(slog.New(slog.NewTextHandler(io.Discard, nil)), pool, nil, nil)
	repo := db.NewCatalog(pool)

	cat, err := repo.CreateCategory(ctx, sqlc.InsertCategoryParams{ID: uuid.New(), Slug: "cat-obj", Name: "DM"})
	if err != nil {
		t.Fatalf("seed category: %v", err)
	}
	prod, err := repo.CreateProduct(ctx, sqlc.InsertProductParams{
		ID: uuid.New(), Slug: "den-obj", Name: "den-obj", Description: "", CategoryID: cat.ID, BasePrice: 1,
		Dimensions: []byte(`{"w":1,"d":1,"h":1}`), Material: "PLA", Images: []byte(`[]`), Status: sqlc.ProductStatusDraft,
	})
	if err != nil {
		t.Fatalf("seed product: %v", err)
	}
	pid := prod.ID

	// create WITH a mapping → round-trips onto the DTO.
	obj := "Chao đèn"
	createResp, err := srv.CreateProductPart(owner, api.CreateProductPartRequestObject{Id: pid, Body: &api.PartInput{Name: "Chao", ModelObjectName: &obj}})
	if err != nil {
		t.Fatalf("create mapped part: %v", err)
	}
	part := api.Part(createResp.(api.CreateProductPart201JSONResponse))
	if part.ModelObjectName == nil || *part.ModelObjectName != obj {
		t.Fatalf("created modelObjectName = %v, want %q", part.ModelObjectName, obj)
	}

	// update to a DIFFERENT arbitrary name that matches no ingested object → ACCEPTED (drift is not an error).
	obj2 := "Đối tượng lạ 123"
	updResp, err := srv.UpdateProductPart(owner, api.UpdateProductPartRequestObject{Id: pid, PartId: part.Id, Body: &api.PartInput{Name: "Chao", ModelObjectName: &obj2}})
	if err != nil {
		t.Fatalf("update mapped part: %v", err)
	}
	if got := api.Part(updResp.(api.UpdateProductPart200JSONResponse)); got.ModelObjectName == nil || *got.ModelObjectName != obj2 {
		t.Fatalf("updated modelObjectName = %v, want %q", got.ModelObjectName, obj2)
	}

	// omitting the field on update clears the mapping (replace semantics) → an unmapped part omits it on the wire.
	if r, err := srv.UpdateProductPart(owner, api.UpdateProductPartRequestObject{Id: pid, PartId: part.Id, Body: &api.PartInput{Name: "Chao"}}); err != nil {
		t.Fatalf("update clear: %v", err)
	} else if got := api.Part(r.(api.UpdateProductPart200JSONResponse)); got.ModelObjectName != nil {
		t.Fatalf("cleared modelObjectName = %v, want nil (omitted)", got.ModelObjectName)
	}

	// an over-long name → 400 field modelObjectName (a capped handle, never a doomed insert).
	long := strings.Repeat("x", maxPartNameChars+1)
	if r, err := srv.CreateProductPart(owner, api.CreateProductPartRequestObject{Id: pid, Body: &api.PartInput{Name: "X", ModelObjectName: &long}}); err != nil {
		t.Fatalf("over-long name: unexpected err %v", err)
	} else if _, ok := r.(api.CreateProductPart400JSONResponse); !ok {
		t.Fatalf("over-long name resp = %T, want 400", r)
	}
}

// getDetail reads a product's full admin detail (owner) and asserts the 200 shape.
func getDetail(t *testing.T, srv *Server, ctx context.Context, pid uuid.UUID) api.Product {
	t.Helper()
	resp, err := srv.GetAdminProduct(ctx, api.GetAdminProductRequestObject{Id: pid})
	if err != nil {
		t.Fatalf("get detail: %v", err)
	}
	return api.Product(resp.(api.GetAdminProduct200JSONResponse))
}
