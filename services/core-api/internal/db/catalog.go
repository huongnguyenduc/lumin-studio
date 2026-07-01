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

// ColorsByProduct lists a product's named print colors.
func (c *Catalog) ColorsByProduct(ctx context.Context, productID uuid.UUID) ([]sqlc.Color, error) {
	return c.q.ListColorsByProduct(ctx, productID)
}

// OptionsByProduct lists a product's customization options.
func (c *Catalog) OptionsByProduct(ctx context.Context, productID uuid.UUID) ([]sqlc.Option, error) {
	return c.q.ListOptionsByProduct(ctx, productID)
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
