package httpapi

import (
	"context"
	"encoding/json"
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

// Every catalog WRITE is owner-only (spec §08). Each rejects a staff actor with 403 and an absent actor
// with 401 BEFORE any DB touch (nil pool) — defense in depth behind the authOwnerOnly boundary gate, so a
// classify() regress cannot let staff mutate the catalog. Mirror of TestSettingsWritesAreOwnerOnly.
func TestAdminProductWritesAreOwnerOnly(t *testing.T) {
	srv := NewServer(slog.New(slog.NewTextHandler(io.Discard, nil)), nil, nil, nil)
	id, childID := uuid.New(), uuid.New()
	prod := api.ProductInput{Slug: "x", Name: "x", CategoryId: uuid.New(), BasePrice: 1,
		Dimensions: api.Dimensions{W: 1, D: 1, H: 1}, Material: "PLA", Status: api.ProductStatus("draft")}
	color := api.ColorInput{Name: "x", Hex: "#fff", Available: true}
	opt := api.OptionInput{Label: "x", Type: api.OptionType("choice")}

	calls := map[string]func(context.Context) error{
		"CreateAdminProduct": func(ctx context.Context) error {
			_, err := srv.CreateAdminProduct(ctx, api.CreateAdminProductRequestObject{Body: &prod})
			return err
		},
		"UpdateAdminProduct": func(ctx context.Context) error {
			_, err := srv.UpdateAdminProduct(ctx, api.UpdateAdminProductRequestObject{Id: id, Body: &prod})
			return err
		},
		"DeleteAdminProduct": func(ctx context.Context) error {
			_, err := srv.DeleteAdminProduct(ctx, api.DeleteAdminProductRequestObject{Id: id})
			return err
		},
		"CreateProductColor": func(ctx context.Context) error {
			_, err := srv.CreateProductColor(ctx, api.CreateProductColorRequestObject{Id: id, Body: &color})
			return err
		},
		"UpdateProductColor": func(ctx context.Context) error {
			_, err := srv.UpdateProductColor(ctx, api.UpdateProductColorRequestObject{Id: id, ColorId: childID, Body: &color})
			return err
		},
		"DeleteProductColor": func(ctx context.Context) error {
			_, err := srv.DeleteProductColor(ctx, api.DeleteProductColorRequestObject{Id: id, ColorId: childID})
			return err
		},
		"CreateProductOption": func(ctx context.Context) error {
			_, err := srv.CreateProductOption(ctx, api.CreateProductOptionRequestObject{Id: id, Body: &opt})
			return err
		},
		"UpdateProductOption": func(ctx context.Context) error {
			_, err := srv.UpdateProductOption(ctx, api.UpdateProductOptionRequestObject{Id: id, OptionId: childID, Body: &opt})
			return err
		},
		"DeleteProductOption": func(ctx context.Context) error {
			_, err := srv.DeleteProductOption(ctx, api.DeleteProductOptionRequestObject{Id: id, OptionId: childID})
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

// cleanProductInput trims + validates a product body before any DB write. basePrice/material/dimensions are
// validated here so a bad value is a 400 field error, not a check-violation 500; a bad slug shape stays out
// of the storefront URL.
func TestCleanProductInput(t *testing.T) {
	desc := "  ấm áp  "
	imgs := []string{"https://x/1.jpg"}
	c, fields, err := cleanProductInput(api.ProductInput{
		Slug: " den-de-ban ", Name: " Đèn để bàn ", Description: &desc, CategoryId: uuid.New(),
		BasePrice: 390_000, Dimensions: api.Dimensions{W: 180, D: 180, H: 240}, Material: "PLA",
		Images: &imgs, Status: api.ProductStatus("active"),
	})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if len(fields) != 0 {
		t.Fatalf("valid product rejected: %v", fields)
	}
	if c.Slug != "den-de-ban" || c.Name != "Đèn để bàn" || c.Description != "ấm áp" {
		t.Fatalf("trim wrong: %+v", c)
	}
	var gotDims api.Dimensions // jsonb key order is irrelevant (Postgres normalizes; readback is key-based)
	if err := json.Unmarshal(c.Dimensions, &gotDims); err != nil || gotDims != (api.Dimensions{W: 180, D: 180, H: 240}) {
		t.Errorf("dimensions jsonb = %s (decoded %+v, err %v)", c.Dimensions, gotDims, err)
	}
	if string(c.Images) != `["https://x/1.jpg"]` {
		t.Errorf("images jsonb = %s", c.Images)
	}

	base := func() api.ProductInput {
		return api.ProductInput{Slug: "ok", Name: "ok", CategoryId: uuid.New(), BasePrice: 1,
			Dimensions: api.Dimensions{W: 1, D: 1, H: 1}, Material: "PLA", Status: api.ProductStatus("draft")}
	}
	bad := map[string]struct {
		mut   func(*api.ProductInput)
		field string
	}{
		"empty name":       {func(p *api.ProductInput) { p.Name = "  " }, "name"},
		"slug with spaces": {func(p *api.ProductInput) { p.Slug = "den de ban" }, "slug"},
		"slug uppercase":   {func(p *api.ProductInput) { p.Slug = "Den" }, "slug"},
		"unknown material": {func(p *api.ProductInput) { p.Material = "ABS" }, "material"},
		"negative price":   {func(p *api.ProductInput) { p.BasePrice = -1 }, "basePrice"},
		"zero dimension":   {func(p *api.ProductInput) { p.Dimensions.H = 0 }, "dimensions"},
		"nil category":     {func(p *api.ProductInput) { p.CategoryId = uuid.Nil }, "categoryId"},
		"bad status":       {func(p *api.ProductInput) { p.Status = api.ProductStatus("sold") }, "status"},
	}
	for name, tc := range bad {
		t.Run(name, func(t *testing.T) {
			in := base()
			tc.mut(&in)
			_, f, err := cleanProductInput(in)
			if err != nil {
				t.Fatalf("unexpected marshal error: %v", err)
			}
			if _, ok := f[tc.field]; !ok {
				t.Fatalf("%s: expected %q field error, got %v", name, tc.field, f)
			}
		})
	}
}

// cleanColorInput must reject a non-#hex swatch — the hex is rendered into an inline style, so an
// unvalidated value is a CSS-injection vector, not just a cosmetic slip.
func TestCleanColorInput(t *testing.T) {
	pd := int64(20_000)
	name, hex, priceDelta, fields := cleanColorInput(api.ColorInput{Name: " Kem sữa ", Hex: " #C9A24B ", Available: true, PriceDelta: &pd})
	if len(fields) != 0 || name != "Kem sữa" || hex != "#C9A24B" || priceDelta != 20_000 {
		t.Fatalf("valid color: name=%q hex=%q pd=%d fields=%v", name, hex, priceDelta, fields)
	}
	bad := map[string]struct {
		in    api.ColorInput
		field string
	}{
		"empty name":        {api.ColorInput{Name: " ", Hex: "#fff"}, "name"},
		"no-hash hex":       {api.ColorInput{Name: "x", Hex: "C9A24B"}, "hex"},
		"wrong-length hex":  {api.ColorInput{Name: "x", Hex: "#CCCC"}, "hex"},
		"css-injection hex": {api.ColorInput{Name: "x", Hex: "#fff;background:url(x)"}, "hex"},
	}
	for name, tc := range bad {
		t.Run(name, func(t *testing.T) {
			if _, _, _, f := cleanColorInput(tc.in); f[tc.field] == "" {
				t.Fatalf("%s: expected %q field error, got %v", name, tc.field, f)
			}
		})
	}
	// negative priceDelta is a field error.
	neg := int64(-1)
	if _, _, _, f := cleanColorInput(api.ColorInput{Name: "x", Hex: "#fff", PriceDelta: &neg}); f["priceDelta"] == "" {
		t.Fatalf("negative priceDelta should be a field error, got %v", f)
	}
}

// cleanOptionInput validates type ∈ {text, choice}, priceDelta ≥ 0, and maxChars > 0 when present.
func TestCleanOptionInput(t *testing.T) {
	mc := 20
	label, desc, typ, pd, maxChars, fields := cleanOptionInput(api.OptionInput{
		Label: " Khắc tên ", Type: api.OptionType("text"), MaxChars: &mc,
	})
	if len(fields) != 0 || label != "Khắc tên" || typ != "text" || pd != 0 || desc != "" || maxChars == nil || *maxChars != 20 {
		t.Fatalf("valid option: label=%q typ=%q pd=%d maxChars=%v fields=%v", label, typ, pd, maxChars, fields)
	}
	zero := 0
	bad := map[string]struct {
		in    api.OptionInput
		field string
	}{
		"empty label":   {api.OptionInput{Label: " ", Type: api.OptionType("text")}, "label"},
		"bad type":      {api.OptionInput{Label: "x", Type: api.OptionType("radio")}, "type"},
		"zero maxChars": {api.OptionInput{Label: "x", Type: api.OptionType("text"), MaxChars: &zero}, "maxChars"},
	}
	for name, tc := range bad {
		t.Run(name, func(t *testing.T) {
			if _, _, _, _, _, f := cleanOptionInput(tc.in); f[tc.field] == "" {
				t.Fatalf("%s: expected %q field error, got %v", name, tc.field, f)
			}
		})
	}
}

// parseProductStatusFilter: nil → all (ok, nil filter); a known status → that filter; junk → not ok (400).
func TestParseProductStatusFilter(t *testing.T) {
	if f, ok := parseProductStatusFilter(nil); !ok || f != nil {
		t.Fatalf("nil param: f=%v ok=%v, want nil/true", f, ok)
	}
	active := api.ProductStatus("active")
	if f, ok := parseProductStatusFilter(&active); !ok || f == nil || string(*f) != "active" {
		t.Fatalf("active: f=%v ok=%v", f, ok)
	}
	junk := api.ProductStatus("sold")
	if _, ok := parseProductStatusFilter(&junk); ok {
		t.Fatal("junk status must be rejected (400), not treated as all")
	}
}

// A 400 field error never carries a human message (only the machine key), consistent with the envelope
// contract (ADR-032).
func TestFieldEnvelopeCarriesOnlyKeys(t *testing.T) {
	env := fieldEnvelope(map[string]string{"slug": msgKey(codeValidation)})
	if env.Code != codeValidation || env.Fields == nil || (*env.Fields)["slug"] != "errors.VALIDATION" {
		t.Fatalf("envelope wrong: %+v", env)
	}
	if strings.Contains(env.MessageKey, " ") {
		t.Fatalf("messageKey must be a key, not prose: %q", env.MessageKey)
	}
}
