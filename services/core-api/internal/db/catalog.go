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

// AdminProducts lists the whole catalog for the admin (every status), newest first. A nil status = all
// statuses (the "Tất cả" tab); a non-nil status narrows to one. No pagination — the catalog is small and
// admin-curated, so the FE holds the full set and searches client-side (see ListAdminProducts).
func (c *Catalog) AdminProducts(ctx context.Context, status *sqlc.ProductStatus) ([]sqlc.Product, error) {
	var filter sqlc.NullProductStatus
	if status != nil {
		filter = sqlc.NullProductStatus{ProductStatus: *status, Valid: true}
	}
	return c.q.ListAdminProducts(ctx, filter)
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

// ColorSwatchesByProducts returns {productID → hex list, name-ordered} for the given page of product
// ids in ONE query (the card list stays N+1-free; hi-fi 02 colour dots). A product with no colours is
// simply absent from the map. Order inside each list mirrors ListColorsByProduct (ORDER BY name), so
// the card dots and the detail swatches always agree.
func (c *Catalog) ColorSwatchesByProducts(ctx context.Context, ids []uuid.UUID) (map[uuid.UUID][]string, error) {
	if len(ids) == 0 {
		return map[uuid.UUID][]string{}, nil
	}
	rows, err := c.q.ListColorSwatchesByProducts(ctx, ids)
	if err != nil {
		return nil, err
	}
	out := make(map[uuid.UUID][]string, len(ids))
	for _, r := range rows {
		out[r.ProductID] = append(out[r.ProductID], r.Hex)
	}
	return out, nil
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

// AdminReviews lists EVERY review across all products (P3-m) — both published and hidden — as the admin
// moderation projection (with product + reviewer names), optionally filtered to one status. nil status =
// all (the "Tất cả" case). One autocommit read, no pagination. Mirrors AdminProducts.
func (c *Catalog) AdminReviews(ctx context.Context, status *sqlc.ReviewStatus) ([]sqlc.ListAllReviewsRow, error) {
	var filter sqlc.NullReviewStatus
	if status != nil {
		filter = sqlc.NullReviewStatus{ReviewStatus: *status, Valid: true}
	}
	return c.q.ListAllReviews(ctx, filter)
}

// ModerateReview applies a review moderation change (P3-m): an optional status flip and/or a reply write,
// returning ErrNotFound for an unknown id. reply is touched only when arg.SetReply is true. No outbox —
// moderation is an internal content decision, not a domain event.
func (c *Catalog) ModerateReview(ctx context.Context, arg sqlc.UpdateReviewModerationParams) error {
	_, err := c.q.UpdateReviewModeration(ctx, arg)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	return err
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

// AdminCategories lists EVERY category with its product count across all statuses (P3-o), name A→Z. Unlike
// Categories() (the active-only browsable taxonomy) this is the internal admin projection — one autocommit
// read, no pagination (a small, admin-curated set). No category yields a non-nil empty slice, never an error.
func (c *Catalog) AdminCategories(ctx context.Context) ([]sqlc.ListAllCategoriesRow, error) {
	return c.q.ListAllCategories(ctx)
}

// UpdateCategory saves a category's editable fields (slug, name, description, image_url, visible; NOT
// display_order — that moves via ReorderCategories), returning the persisted row or ErrNotFound if the id
// is unknown. A slug collision surfaces as the raw UNIQUE-violation error (pgx code 23505) for the handler
// to map to a 400 field error, mirroring UpdateProduct.
func (c *Catalog) UpdateCategory(ctx context.Context, arg sqlc.UpdateCategoryParams) (sqlc.Category, error) {
	cat, err := c.q.UpdateCategory(ctx, arg)
	if errors.Is(err, pgx.ErrNoRows) {
		return sqlc.Category{}, ErrNotFound
	}
	return cat, err
}

// ReorderCategories sets each category's display_order to its position in ids (0-based), in one atomic
// statement (P3-o slice o-2). Ids not present keep their order; an unknown id is a harmless no-op — the
// caller (owner-only handler) sends the full ordered list after a drag, so there is no partial-set concern.
func (c *Catalog) ReorderCategories(ctx context.Context, ids []uuid.UUID) error {
	return c.q.ReorderCategories(ctx, ids)
}

// DeleteCategory hard-deletes a category, or returns ErrNotFound for an unknown id. A category still
// referenced by a product raises a foreign_key_violation (pgx code 23503) — passed through RAW (not
// swallowed) so the handler can map it to a 409 steering the owner to reassign/archive the products first,
// mirroring DeleteProduct.
func (c *Catalog) DeleteCategory(ctx context.Context, id uuid.UUID) error {
	_, err := c.q.DeleteCategory(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	return err
}

// CreateProduct inserts a product and returns the persisted row.
func (c *Catalog) CreateProduct(ctx context.Context, arg sqlc.InsertProductParams) (sqlc.Product, error) {
	return c.q.InsertProduct(ctx, arg)
}

// UpdateProduct saves the editable fields of a product (never model3d_url — the asset pipeline owns it),
// returning the persisted row or ErrNotFound if the id is unknown. A slug collision surfaces as the raw
// UNIQUE-violation error (pgx code 23505) for the handler to map to a 400 field error.
func (c *Catalog) UpdateProduct(ctx context.Context, arg sqlc.UpdateProductParams) (sqlc.Product, error) {
	p, err := c.q.UpdateProduct(ctx, arg)
	if errors.Is(err, pgx.ErrNoRows) {
		return sqlc.Product{}, ErrNotFound
	}
	return p, err
}

// DeleteProduct hard-deletes a product, or returns ErrNotFound for an unknown id. A product with orders or
// render history raises a foreign_key_violation (pgx code 23503) — passed through RAW (not swallowed) so the
// handler can map it to a 409 steering the owner to archive instead.
func (c *Catalog) DeleteProduct(ctx context.Context, id uuid.UUID) error {
	_, err := c.q.DeleteProduct(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	return err
}

// UpdateProductModelView persists a product's saved default 3D-viewer camera pose (ADR-038), or returns
// ErrNotFound for an unknown id. The query is :execrows, so an unknown id updates 0 rows (never ErrNoRows) —
// a 0 count is the 404 signal. view is the marshalled + range-validated jsonb pose.
func (c *Catalog) UpdateProductModelView(ctx context.Context, id uuid.UUID, view []byte) error {
	rows, err := c.q.UpdateProductModelView(ctx, sqlc.UpdateProductModelViewParams{ID: id, Model3dView: view})
	if err != nil {
		return err
	}
	if rows == 0 {
		return ErrNotFound
	}
	return nil
}

// UpdateProductEngraveAnchor persists the owner-picked engrave anchor (position + normal on the model
// surface where engraving text is projected), or ErrNotFound for an unknown id — same :execrows contract
// as UpdateProductModelView. anchor is the marshalled + range-validated jsonb blob.
func (c *Catalog) UpdateProductEngraveAnchor(ctx context.Context, id uuid.UUID, anchor []byte) error {
	rows, err := c.q.UpdateProductEngraveAnchor(ctx, sqlc.UpdateProductEngraveAnchorParams{ID: id, EngraveAnchor: anchor})
	if err != nil {
		return err
	}
	if rows == 0 {
		return ErrNotFound
	}
	return nil
}

// SetProductModel3dURL writes the LOD glb URL onto a product — the asset pipeline's ONE write of the
// column UpdateProduct never touches (ADR-045). Called only from the render callback when a model_ingest
// job reaches `ready`; the URL is host-pinned at the HTTP boundary. :execrows, so an unknown id (0 rows)
// returns ErrNotFound — though asset_jobs.product_id is RESTRICT, so a live job always has its product.
func (c *Catalog) SetProductModel3dURL(ctx context.Context, id uuid.UUID, url string) error {
	rows, err := c.q.SetProductModel3dUrl(ctx, sqlc.SetProductModel3dUrlParams{ID: id, Model3dUrl: url})
	if err != nil {
		return err
	}
	if rows == 0 {
		return ErrNotFound
	}
	return nil
}

// SetProductModel3dStructuredURL writes the structured glb URL onto a product (f-4) — the model_ingest analogue
// of SetProductModel3dURL for the named-objects derivative the live viewer recolors by. Written only from the
// render callback on a ready model_ingest (OPTIONAL — a nameless source yields none). :execrows, so an unknown
// id (0 rows) returns ErrNotFound.
func (c *Catalog) SetProductModel3dStructuredURL(ctx context.Context, id uuid.UUID, url string) error {
	rows, err := c.q.SetProductModel3dStructuredUrl(ctx, sqlc.SetProductModel3dStructuredUrlParams{ID: id, Model3dStructuredUrl: url})
	if err != nil {
		return err
	}
	if rows == 0 {
		return ErrNotFound
	}
	return nil
}

// SetProductSpriteSheetURL writes the 360° sprite-sheet URL onto a product (ADR-049) — the sprite_render
// analogue of SetProductModel3dURL, and the ONE write of a column UpdateProduct never touches. Called only
// from the render callback when a sprite_render job reaches `ready`; the URL is host-pinned (.webp) at the
// HTTP boundary. :execrows, so an unknown id (0 rows) returns ErrNotFound.
func (c *Catalog) SetProductSpriteSheetURL(ctx context.Context, id uuid.UUID, url string) error {
	rows, err := c.q.SetProductSpriteSheetUrl(ctx, sqlc.SetProductSpriteSheetUrlParams{ID: id, SpriteSheetUrl: url})
	if err != nil {
		return err
	}
	if rows == 0 {
		return ErrNotFound
	}
	return nil
}

// SetProductModelObjectNames writes the model's object-name list onto a product (f-2) — the model_ingest
// analogue of SetProductModel3dURL, and the ONE write of a column UpdateProduct never touches. Called only
// from the render callback when a model_ingest job reaches `ready`; the names are trimmed + capped at the
// HTTP boundary. :execrows, so an unknown id (0 rows) returns ErrNotFound.
func (c *Catalog) SetProductModelObjectNames(ctx context.Context, id uuid.UUID, names []string) error {
	rows, err := c.q.SetProductModelObjectNames(ctx, sqlc.SetProductModelObjectNamesParams{ID: id, ModelObjectNames: names})
	if err != nil {
		return err
	}
	if rows == 0 {
		return ErrNotFound
	}
	return nil
}

// CreateColor inserts a color and returns the persisted row.
func (c *Catalog) CreateColor(ctx context.Context, arg sqlc.InsertColorParams) (sqlc.Color, error) {
	return c.q.InsertColor(ctx, arg)
}

// UpdateColor saves a color scoped by (id, product_id); a colorId under the wrong product → ErrNotFound.
func (c *Catalog) UpdateColor(ctx context.Context, arg sqlc.UpdateColorParams) (sqlc.Color, error) {
	col, err := c.q.UpdateColor(ctx, arg)
	if errors.Is(err, pgx.ErrNoRows) {
		return sqlc.Color{}, ErrNotFound
	}
	return col, err
}

// DeleteColor removes a color scoped by (id, product_id), or ErrNotFound. colors have no inbound FK, so no
// RESTRICT case — a delete always succeeds when the row exists.
func (c *Catalog) DeleteColor(ctx context.Context, arg sqlc.DeleteColorParams) error {
	_, err := c.q.DeleteColor(ctx, arg)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	return err
}

// CreateOption inserts an option and returns the persisted row.
func (c *Catalog) CreateOption(ctx context.Context, arg sqlc.InsertOptionParams) (sqlc.Option, error) {
	return c.q.InsertOption(ctx, arg)
}

// UpdateOption saves an option scoped by (id, product_id); an optionId under the wrong product → ErrNotFound.
func (c *Catalog) UpdateOption(ctx context.Context, arg sqlc.UpdateOptionParams) (sqlc.Option, error) {
	opt, err := c.q.UpdateOption(ctx, arg)
	if errors.Is(err, pgx.ErrNoRows) {
		return sqlc.Option{}, ErrNotFound
	}
	return opt, err
}

// DeleteOption removes an option scoped by (id, product_id), or ErrNotFound.
func (c *Catalog) DeleteOption(ctx context.Context, arg sqlc.DeleteOptionParams) error {
	_, err := c.q.DeleteOption(ctx, arg)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	return err
}

// --- ADR-037 configurator: parts + option choices ---

// CreatePart inserts a part and returns the persisted row.
func (c *Catalog) CreatePart(ctx context.Context, arg sqlc.InsertPartParams) (sqlc.Part, error) {
	return c.q.InsertPart(ctx, arg)
}

// PartsByProduct lists a product's named parts (display order).
func (c *Catalog) PartsByProduct(ctx context.Context, productID uuid.UUID) ([]sqlc.Part, error) {
	return c.q.ListPartsByProduct(ctx, productID)
}

// PartByProduct fetches a part scoped by (id, product_id); a partId under the wrong product → ErrNotFound.
// The color handlers call it to validate a color's claimed partId belongs to the same product (ADR-037).
func (c *Catalog) PartByProduct(ctx context.Context, arg sqlc.GetPartByProductParams) (sqlc.Part, error) {
	part, err := c.q.GetPartByProduct(ctx, arg)
	if errors.Is(err, pgx.ErrNoRows) {
		return sqlc.Part{}, ErrNotFound
	}
	return part, err
}

// UpdatePart saves a part scoped by (id, product_id); a partId under the wrong product → ErrNotFound.
func (c *Catalog) UpdatePart(ctx context.Context, arg sqlc.UpdatePartParams) (sqlc.Part, error) {
	part, err := c.q.UpdatePart(ctx, arg)
	if errors.Is(err, pgx.ErrNoRows) {
		return sqlc.Part{}, ErrNotFound
	}
	return part, err
}

// DeletePart removes a part scoped by (id, product_id), or ErrNotFound. Deleting a part CASCADEs its colors;
// a color already pinned by an order raises a foreign_key_violation (23503) passed through RAW so the handler
// maps it to a 409 (archive instead), mirroring DeleteProduct.
func (c *Catalog) DeletePart(ctx context.Context, arg sqlc.DeletePartParams) error {
	_, err := c.q.DeletePart(ctx, arg)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	return err
}

// OptionByProduct fetches an option scoped by (id, product_id); an optionId under the wrong product →
// ErrNotFound. The choice handlers call it to validate the {optionId} path segment belongs to the product.
func (c *Catalog) OptionByProduct(ctx context.Context, arg sqlc.GetOptionByProductParams) (sqlc.Option, error) {
	opt, err := c.q.GetOptionByProduct(ctx, arg)
	if errors.Is(err, pgx.ErrNoRows) {
		return sqlc.Option{}, ErrNotFound
	}
	return opt, err
}

// ChoicesByProduct lists every option_choice for a product's options (for the editor's detail assembly).
func (c *Catalog) ChoicesByProduct(ctx context.Context, productID uuid.UUID) ([]sqlc.OptionChoice, error) {
	return c.q.ListChoicesByProduct(ctx, productID)
}

// CreateOptionChoice inserts a choice and returns the persisted row.
func (c *Catalog) CreateOptionChoice(ctx context.Context, arg sqlc.InsertOptionChoiceParams) (sqlc.OptionChoice, error) {
	return c.q.InsertOptionChoice(ctx, arg)
}

// UpdateOptionChoice saves a choice scoped by (id, option_id); a choiceId under the wrong option → ErrNotFound.
func (c *Catalog) UpdateOptionChoice(ctx context.Context, arg sqlc.UpdateOptionChoiceParams) (sqlc.OptionChoice, error) {
	ch, err := c.q.UpdateOptionChoice(ctx, arg)
	if errors.Is(err, pgx.ErrNoRows) {
		return sqlc.OptionChoice{}, ErrNotFound
	}
	return ch, err
}

// DeleteOptionChoice removes a choice scoped by (id, option_id), or ErrNotFound.
func (c *Catalog) DeleteOptionChoice(ctx context.Context, arg sqlc.DeleteOptionChoiceParams) error {
	_, err := c.q.DeleteOptionChoice(ctx, arg)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	return err
}

// CreateReview inserts a review and returns the persisted row.
func (c *Catalog) CreateReview(ctx context.Context, arg sqlc.InsertReviewParams) (sqlc.Review, error) {
	return c.q.InsertReview(ctx, arg)
}
