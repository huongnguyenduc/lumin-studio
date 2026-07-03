package httpapi

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
)

// Integration tests for GetProductBySlug against real Postgres (testcontainers: skip local without
// Docker, run in CI — ADR-020; startPostgres + seedCheckoutCatalog live in the sibling integration
// files). They drive the FULL public router (no cookie) to prove the route is mounted, classified
// authPublic, and returns the assembled product+colors+options — plus that every miss (unknown /
// draft / archived) is the SAME 404 NOT_FOUND, so the public surface can't probe hidden catalog rows.

func TestGetProductBySlugEndToEnd(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()
	fx := seedCheckoutCatalog(t, ctx, pool)

	// A draft product proves non-active covers BOTH draft and archived (identical 404 to unknown).
	draft, err := db.NewCatalog(pool).CreateProduct(ctx, sqlc.InsertProductParams{
		ID: uuid.New(), Slug: "den-nhap", Name: "Đèn nháp", Description: "", CategoryID: fx.product.CategoryID,
		BasePrice: 100_000, Dimensions: []byte(`{"w":1,"d":1,"h":1}`), Material: "PLA", Images: []byte(`[]`),
		Status: sqlc.ProductStatusDraft,
	})
	if err != nil {
		t.Fatalf("seed draft product: %v", err)
	}

	srv := NewServer(slog.New(slog.NewTextHandler(io.Discard, nil)), pool, nil, nil)
	router := testAuthedRouter(srv)

	// 200: the active product, through the full public router with NO cookie — proves the mount, the
	// authPublic gate, and the assembled wire shape.
	t.Run("active product 200 via public router", func(t *testing.T) {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/products/"+fx.product.Slug, nil)
		router.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("GET /products/%s = %d, want 200 (body=%s)", fx.product.Slug, rec.Code, rec.Body.String())
		}
		var got api.Product
		if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
			t.Fatalf("decode product: %v", err)
		}
		if got.Slug != fx.product.Slug || got.BasePrice != 390_000 || got.Status != "active" {
			t.Fatalf("product = slug %q base %d status %q, want %q/390000/active", got.Slug, got.BasePrice, got.Status, fx.product.Slug)
		}
		if got.Dimensions.W != 180 || got.Dimensions.D != 180 || got.Dimensions.H != 240 {
			t.Errorf("dimensions = %+v, want w180 d180 h240", got.Dimensions)
		}
		if len(got.Images) != 1 || got.Images[0] != "https://x/1.jpg" {
			t.Errorf("images = %v, want one cover url", got.Images)
		}
		// Colors: mint (available, +20k) AND sold (unavailable, +10k) are BOTH reported — availability
		// is a field, never a filter (the UI greys out sold-out swatches; it doesn't hide them).
		if len(got.Colors) != 2 {
			t.Fatalf("colors len = %d, want 2 (available + unavailable both reported)", len(got.Colors))
		}
		if mint := findColorByID(got.Colors, fx.colorMint.ID); mint == nil || !mint.Available || mint.PriceDelta != 20_000 {
			t.Errorf("mint color = %+v, want present available +20000", mint)
		}
		if sold := findColorByID(got.Colors, fx.colorSold.ID); sold == nil || sold.Available {
			t.Errorf("sold color = %+v, want present + unavailable", sold)
		}
		// Options: engrave (text, +50k, maxChars 20) AND dimmer (choice, +90k, no limit).
		if len(got.Options) != 2 {
			t.Fatalf("options len = %d, want 2", len(got.Options))
		}
		if eng := findOptionByID(got.Options, fx.optEngrave.ID); eng == nil || eng.Type != "text" ||
			eng.PriceDelta != 50_000 || eng.MaxChars == nil || *eng.MaxChars != 20 {
			t.Errorf("engrave option = %+v, want text +50000 maxChars 20", eng)
		}
		if dim := findOptionByID(got.Options, fx.optDimmer.ID); dim == nil || dim.Type != "choice" ||
			dim.PriceDelta != 90_000 || dim.MaxChars != nil {
			t.Errorf("dimmer option = %+v, want choice +90000 no maxChars", dim)
		}
	})

	// Every miss — unknown slug, draft, archived — returns the SAME 404 NOT_FOUND envelope.
	for _, tc := range []struct{ name, slug string }{
		{"unknown", "khong-ton-tai"},
		{"draft", draft.Slug},
		{"archived", fx.archived.Slug},
	} {
		t.Run(tc.name+" is 404 NOT_FOUND", func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodGet, "/products/"+tc.slug, nil)
			router.ServeHTTP(rec, req)
			if rec.Code != http.StatusNotFound {
				t.Fatalf("GET /products/%s = %d, want 404 (no catalog-existence leak; body=%s)", tc.slug, rec.Code, rec.Body.String())
			}
			var env api.ErrorEnvelope
			if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
				t.Fatalf("decode envelope: %v", err)
			}
			if env.Code != codeNotFound {
				t.Errorf("code = %q, want %s (uniform not-found across unknown/draft/archived)", env.Code, codeNotFound)
			}
		})
	}
}

func findColorByID(cs []api.Color, id uuid.UUID) *api.Color {
	for i := range cs {
		if cs[i].Id == id {
			return &cs[i]
		}
	}
	return nil
}

func findOptionByID(opts []api.Option, id uuid.UUID) *api.Option {
	for i := range opts {
		if opts[i].Id == id {
			return &opts[i]
		}
	}
	return nil
}
