package db

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
)

// Catalog is the read/write repository for the catalog axis (categories, products, colors,
// options, reviews). It wraps the sqlc-generated Querier so httpapi handlers stay thin and
// pgx.ErrNoRows surfaces as the domain ErrNotFound. Construct it over the *pgxpool.Pool for
// autocommit reads/writes, or over a pgx.Tx to enlist in a transaction.
type Catalog struct {
	q *sqlc.Queries
}

// NewCatalog builds a Catalog over any sqlc.DBTX (the pool or a pgx.Tx).
func NewCatalog(db sqlc.DBTX) *Catalog {
	return &Catalog{q: sqlc.New(db)}
}

// ProductBySlug returns the product with the given slug, or ErrNotFound.
func (c *Catalog) ProductBySlug(ctx context.Context, slug string) (sqlc.Product, error) {
	p, err := c.q.GetProductBySlug(ctx, slug)
	if errors.Is(err, pgx.ErrNoRows) {
		return sqlc.Product{}, ErrNotFound
	}
	return p, err
}

// ProductByID returns the product with the given id, or ErrNotFound. This is the intake read the
// checkout handler uses to derive a server-authoritative price (base_price); ProductBySlug serves
// the storefront.
func (c *Catalog) ProductByID(ctx context.Context, id uuid.UUID) (sqlc.Product, error) {
	p, err := c.q.GetProductByID(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return sqlc.Product{}, ErrNotFound
	}
	return p, err
}

// ProductsByStatus lists products in a status, newest first.
func (c *Catalog) ProductsByStatus(ctx context.Context, status sqlc.ProductStatus) ([]sqlc.Product, error) {
	return c.q.ListProductsByStatus(ctx, status)
}

// ProductCardFilter narrows the storefront catalog list. CategorySlug nil = all categories; Search nil =
// no full-text filter (PR-P1-e — a length-bounded, ""→nil-normalized term the SQL matches accent-folded via
// plainto_tsquery, never interpolated); Sort is a whitelisted token already validated at the HTTP edge
// (never raw client text — the SQL maps it through a CASE); Limit/Offset are the already-bounded page window
// (the handler caps pageSize and the offset).
type ProductCardFilter struct {
	CategorySlug *string
	Search       *string
	Sort         string
	Limit        int32
	Offset       int32
}

// ListActiveProductCards returns one page of ACTIVE product cards plus the total matching the filter.
// The list and the count are two autocommit reads (not one snapshot transaction): a concurrent catalog
// write between them can skew total by one — cosmetic on a made-to-order shop whose catalog rarely
// changes, and never a money value (it is a display count that self-heals next request). The list query
// makes NO per-product reads (no colors/options) so there is no N+1.
func (c *Catalog) ListActiveProductCards(ctx context.Context, f ProductCardFilter) ([]sqlc.ListActiveProductsRow, int64, error) {
	rows, err := c.q.ListActiveProducts(ctx, sqlc.ListActiveProductsParams{
		CategorySlug: f.CategorySlug,
		Search:       f.Search,
		Sort:         f.Sort,
		PageLimit:    f.Limit,
		PageOffset:   f.Offset,
	})
	if err != nil {
		return nil, 0, err
	}
	// The count applies the SAME category + search filter as the list (sqlc.CountActiveProductsParams), so
	// the envelope total reflects the searched/filtered set — never the whole catalog.
	total, err := c.q.CountActiveProducts(ctx, sqlc.CountActiveProductsParams{
		CategorySlug: f.CategorySlug,
		Search:       f.Search,
	})
	if err != nil {
		return nil, 0, err
	}
	return rows, total, nil
}

// ReviewFilter narrows the public product-review list (PR-P1-l). ProductID scopes to one product;
// Limit/Offset are the already-bounded page window (the handler caps pageSize and the offset). There is
// no visibility knob here on purpose — the published-only filter lives in the SQL, never a caller-supplied
// flag, so a handler can never widen the list to hidden reviews.
type ReviewFilter struct {
	ProductID uuid.UUID
	Limit     int32
	Offset    int32
}

// ListPublishedReviews returns one page of PUBLISHED reviews for a product (newest first) plus the total.
// Like ListActiveProductCards it is TWO autocommit reads (list + count), so a concurrent review write
// between them can skew total by one — cosmetic (a display count that self-heals next request) and never a
// money value, so we accept it rather than pay for a snapshot transaction. The published-only filter and
// the customer_id-omitting projection live in the SQL (ListReviewsByProduct), so a hidden review can never
// leak and no reviewer PII leaves the DB for this public endpoint.
func (c *Catalog) ListPublishedReviews(ctx context.Context, f ReviewFilter) ([]sqlc.ListReviewsByProductRow, int64, error) {
	rows, err := c.q.ListReviewsByProduct(ctx, sqlc.ListReviewsByProductParams{
		ProductID:  f.ProductID,
		PageLimit:  f.Limit,
		PageOffset: f.Offset,
	})
	if err != nil {
		return nil, 0, err
	}
	total, err := c.q.CountPublishedReviewsByProduct(ctx, f.ProductID)
	if err != nil {
		return nil, 0, err
	}
	return rows, total, nil
}

// ColorsByProduct lists a product's named print colors.
func (c *Catalog) ColorsByProduct(ctx context.Context, productID uuid.UUID) ([]sqlc.Color, error) {
	return c.q.ListColorsByProduct(ctx, productID)
}

// OptionsByProduct lists a product's customization options.
func (c *Catalog) OptionsByProduct(ctx context.Context, productID uuid.UUID) ([]sqlc.Option, error) {
	return c.q.ListOptionsByProduct(ctx, productID)
}

// Categories lists the BROWSABLE category taxonomy (name A→Z, slug tiebreak) for the storefront chips —
// only categories that contain at least one ACTIVE product (ListCategories scopes with an EXISTS subquery,
// the same non-leak discipline as the active-only product reads: a category whose only products are hidden
// never surfaces as a public chip). The set is small and admin-curated, so it is one autocommit read with no
// filter/pagination. No browsable category yields a non-nil empty slice, never an error — the handler renders
// `[]`, not a 404.
func (c *Catalog) Categories(ctx context.Context) ([]sqlc.Category, error) {
	return c.q.ListCategories(ctx)
}

// CreateCategory inserts a category and returns the persisted row.
func (c *Catalog) CreateCategory(ctx context.Context, arg sqlc.InsertCategoryParams) (sqlc.Category, error) {
	return c.q.InsertCategory(ctx, arg)
}

// CreateProduct inserts a product and returns the persisted row.
func (c *Catalog) CreateProduct(ctx context.Context, arg sqlc.InsertProductParams) (sqlc.Product, error) {
	return c.q.InsertProduct(ctx, arg)
}

// CreateColor inserts a color and returns the persisted row.
func (c *Catalog) CreateColor(ctx context.Context, arg sqlc.InsertColorParams) (sqlc.Color, error) {
	return c.q.InsertColor(ctx, arg)
}

// CreateOption inserts an option and returns the persisted row.
func (c *Catalog) CreateOption(ctx context.Context, arg sqlc.InsertOptionParams) (sqlc.Option, error) {
	return c.q.InsertOption(ctx, arg)
}

// CreateReview inserts a review and returns the persisted row.
func (c *Catalog) CreateReview(ctx context.Context, arg sqlc.InsertReviewParams) (sqlc.Review, error) {
	return c.q.InsertReview(ctx, arg)
}
