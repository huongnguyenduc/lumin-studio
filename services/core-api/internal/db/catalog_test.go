package db

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
)

// seedProduct inserts a category + an active product and returns the product.
func seedProduct(t *testing.T, ctx context.Context, cat *Catalog, slug string, basePrice int64) sqlc.Product {
	t.Helper()
	category, err := cat.CreateCategory(ctx, sqlc.InsertCategoryParams{
		ID: uuid.New(), Slug: "cat-" + slug, Name: "Đèn bàn",
	})
	if err != nil {
		t.Fatalf("create category: %v", err)
	}
	p, err := cat.CreateProduct(ctx, sqlc.InsertProductParams{
		ID:          uuid.New(),
		Slug:        slug,
		Name:        "Đèn nấm",
		Description: "ấm áp, mộc",
		CategoryID:  category.ID,
		BasePrice:   basePrice,
		Dimensions:  []byte(`{"w":180,"d":180,"h":240}`),
		Material:    "PLA",
		Model3dUrl:  "https://x/m.glb",
		Images:      []byte(`["https://x/1.jpg"]`),
		Status:      sqlc.ProductStatusActive,
	})
	if err != nil {
		t.Fatalf("create product: %v", err)
	}
	return p
}

func TestCatalogRoundTrip(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()
	cat := NewCatalog(pool)

	p := seedProduct(t, ctx, cat, "den-nam", 390000)
	mustCreateColor(t, ctx, cat, p.ID, "Kem sữa", 0)
	mustCreateColor(t, ctx, cat, p.ID, "Xanh rêu", 20000)
	maxChars := int32(20)
	if _, err := cat.CreateOption(ctx, sqlc.InsertOptionParams{
		ID: uuid.New(), ProductID: p.ID, Label: "Khắc tên", Description: "tối đa 20 ký tự",
		Type: sqlc.OptionTypeText, PriceDelta: 15000, MaxChars: &maxChars,
	}); err != nil {
		t.Fatalf("create option: %v", err)
	}

	got, err := cat.ProductBySlug(ctx, "den-nam")
	if err != nil {
		t.Fatalf("get by slug: %v", err)
	}
	if got.ID != p.ID {
		t.Fatalf("product id mismatch: %v != %v", got.ID, p.ID)
	}
	if got.BasePrice != 390000 {
		t.Fatalf("base_price = %d, want 390000 (int VND, exact)", got.BasePrice)
	}
	if got.Status != sqlc.ProductStatusActive {
		t.Fatalf("status = %q, want active", got.Status)
	}
	var dims struct{ W, D, H int }
	if err := json.Unmarshal(got.Dimensions, &dims); err != nil {
		t.Fatalf("dimensions unmarshal: %v", err)
	}
	if dims.W != 180 || dims.D != 180 || dims.H != 240 {
		t.Fatalf("dimensions round-trip wrong: %+v", dims)
	}

	colors, err := cat.ColorsByProduct(ctx, p.ID)
	if err != nil {
		t.Fatalf("colors: %v", err)
	}
	if len(colors) != 2 {
		t.Fatalf("colors = %d, want 2", len(colors))
	}

	options, err := cat.OptionsByProduct(ctx, p.ID)
	if err != nil {
		t.Fatalf("options: %v", err)
	}
	if len(options) != 1 || options[0].MaxChars == nil || *options[0].MaxChars != 20 {
		t.Fatalf("option maxChars round-trip wrong: %+v", options)
	}
}

func mustCreateColor(t *testing.T, ctx context.Context, cat *Catalog, productID uuid.UUID, name string, delta int64) {
	t.Helper()
	if _, err := cat.CreateColor(ctx, sqlc.InsertColorParams{
		ID: uuid.New(), ProductID: productID, Name: name, Hex: "#000000", Available: true, PriceDelta: delta,
	}); err != nil {
		t.Fatalf("create color %q: %v", name, err)
	}
}

func TestProductBySlugNotFound(t *testing.T) {
	pool := startPostgres(t)
	cat := NewCatalog(pool)
	if _, err := cat.ProductBySlug(context.Background(), "nope"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("err = %v, want ErrNotFound", err)
	}
}

func TestCatalogRejectsNegativeMoney(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()
	cat := NewCatalog(pool)
	category, err := cat.CreateCategory(ctx, sqlc.InsertCategoryParams{ID: uuid.New(), Slug: "c-neg", Name: "c"})
	if err != nil {
		t.Fatalf("category: %v", err)
	}
	_, err = cat.CreateProduct(ctx, sqlc.InsertProductParams{
		ID: uuid.New(), Slug: "neg", Name: "x", CategoryID: category.ID,
		BasePrice: -1, Dimensions: []byte(`{}`), Material: "PLA", Images: []byte(`[]`), Status: sqlc.ProductStatusDraft,
	})
	if err == nil {
		t.Fatal("base_price = -1 must violate CHECK (base_price >= 0)")
	}
}

func TestReviewRatingCheckAndNullCustomer(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()
	cat := NewCatalog(pool)
	p := seedProduct(t, ctx, cat, "rev", 100000)

	// rating 6 is out of [1,5]
	if _, err := cat.CreateReview(ctx, sqlc.InsertReviewParams{
		ID: uuid.New(), ProductID: p.ID, CustomerID: pgtype.UUID{Valid: false},
		Rating: 6, Body: "x", Images: []byte(`[]`), Reply: nil, Status: sqlc.ReviewStatusPublished,
	}); err == nil {
		t.Fatal("rating 6 must violate CHECK (rating BETWEEN 1 AND 5)")
	}

	// rating 5 with a NULL customer_id (customers land in 000004) is valid
	r, err := cat.CreateReview(ctx, sqlc.InsertReviewParams{
		ID: uuid.New(), ProductID: p.ID, CustomerID: pgtype.UUID{Valid: false},
		Rating: 5, Body: "tuyệt", Images: []byte(`[]`), Reply: nil, Status: sqlc.ReviewStatusPublished,
	})
	if err != nil {
		t.Fatalf("valid review rejected: %v", err)
	}
	if r.Rating != 5 {
		t.Fatalf("rating = %d, want 5", r.Rating)
	}
	if r.CustomerID.Valid {
		t.Fatal("customer_id should be NULL (no customer linked yet)")
	}
}
