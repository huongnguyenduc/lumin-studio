package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
)

// admin_products.go — the admin catalog WRITE surface (P3-j): create/update/delete products and their
// colors/options, plus the admin reads (list every status, detail by id). Reads are admin-gated
// (owner+staff, classify default); every WRITE is owner-only (spec §08 — catalog is an owner power,
// enforced at the boundary via classify→authOwnerOnly AND re-asserted here with assertOwner, the same
// defense-in-depth as settings). Model upload + asset-jobs are a separate PR (P3-j-b); this PR never
// touches model3d_url. Money crosses the wire raw int-VND (always-must #2); status/type are enums the
// client maps to i18n labels (always-must #3).

// Sanity caps + shape guards on the owner's catalog edits (belt against a pathological blob; the UI keeps
// well under these). Measured in runes — Vietnamese is multibyte.
const (
	maxProductNameChars = 200
	maxSlugChars        = 200
	maxDescriptionChars = 10000
	maxColorNameChars   = 100
	maxOptionLabelChars = 200
	maxOptionDescChars  = 2000
)

// slugRe accepts a URL-safe slug: lowercase alphanumerics in dash-separated groups (e.g. "den-de-ban").
// The DB only enforces UNIQUE(slug), not a shape, so this keeps a junk slug out of the storefront URL.
var slugRe = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)

// hexRe accepts a 3- or 6-digit #hex colour. It is a real guard, not cosmetic: the swatch hex is rendered
// into the storefront's inline style, so an unvalidated value would be a CSS-injection vector.
var hexRe = regexp.MustCompile(`^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$`)

// validMaterials mirrors the products.material CHECK (migration 000003, ADR-028). Validated here so a bad
// material is a 400 field error, not a 23514 check-violation surfacing as 500.
var validMaterials = map[string]struct{}{"PLA": {}, "PETG": {}, "recycled-PLA": {}}

// GetAdminProducts handles GET /admin/products (admin-gated read; owner+staff). It returns the whole
// catalog across ALL statuses as the admin summary projection, optionally filtered to one status. Not
// paginated (the catalog is small; the FE searches client-side).
func (s *Server) GetAdminProducts(ctx context.Context, request api.GetAdminProductsRequestObject) (api.GetAdminProductsResponseObject, error) {
	status, ok := parseProductStatusFilter(request.Params.Status)
	if !ok {
		// A status value outside the enum (only reachable if the generated binding is bypassed). Reject
		// rather than silently list all.
		return api.GetAdminProducts400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(envelope(codeValidation))}, nil
	}
	rows, err := db.NewCatalog(s.pool).AdminProducts(ctx, status)
	if err != nil {
		return nil, err
	}
	return api.GetAdminProducts200JSONResponse(adminProductSummaries(rows)), nil
}

// GetAdminProduct handles GET /admin/products/{id} (admin-gated read; owner+staff). It returns the full
// Product (any status) with its colors and options for the editor to populate. Unknown id → 404.
func (s *Server) GetAdminProduct(ctx context.Context, request api.GetAdminProductRequestObject) (api.GetAdminProductResponseObject, error) {
	repo := db.NewCatalog(s.pool)
	p, err := repo.ProductByID(ctx, request.Id)
	if err != nil {
		return nil, err // db.ErrNotFound → 404
	}
	colors, err := repo.ColorsByProduct(ctx, p.ID)
	if err != nil {
		return nil, err
	}
	options, err := repo.OptionsByProduct(ctx, p.ID)
	if err != nil {
		return nil, err
	}
	parts, err := repo.PartsByProduct(ctx, p.ID)
	if err != nil {
		return nil, err
	}
	choices, err := repo.ChoicesByProduct(ctx, p.ID)
	if err != nil {
		return nil, err
	}
	dto, err := productDTO(p, colors, options, parts, choices)
	if err != nil {
		return nil, err
	}
	return api.GetAdminProduct200JSONResponse(dto), nil
}

// CreateAdminProduct handles POST /admin/products (owner-only). A product is born with no model and no
// colors/options (added via their own endpoints), so the response Product has empty colors/options. A
// duplicate slug → 400 (slug); an unknown categoryId → 400 (categoryId).
func (s *Server) CreateAdminProduct(ctx context.Context, request api.CreateAdminProductRequestObject) (api.CreateAdminProductResponseObject, error) {
	if err := assertOwner(ctx); err != nil {
		return nil, err
	}
	if request.Body == nil {
		return api.CreateAdminProduct400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(envelope(codeValidation))}, nil
	}
	c, fields, err := cleanProductInput(*request.Body)
	if err != nil {
		return nil, err
	}
	if len(fields) > 0 {
		return api.CreateAdminProduct400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(fieldEnvelope(fields))}, nil
	}
	p, err := db.NewCatalog(s.pool).CreateProduct(ctx, sqlc.InsertProductParams{
		ID:             uuid.New(),
		Slug:           c.Slug,
		Name:           c.Name,
		Description:    c.Description,
		CategoryID:     c.CategoryID,
		BasePrice:      c.BasePrice,
		Dimensions:     c.Dimensions,
		Material:       c.Material,
		Model3dUrl:     "", // owned by the asset pipeline (P3-j-b), never set from the editor form
		Images:         c.Images,
		Status:         c.Status,
		EstFilamentQty: c.EstFilamentQty, // ADR-039 flat-product deduct-on-print standard
	})
	if fields, ok := productWriteConflict(err); ok {
		return api.CreateAdminProduct400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(fieldEnvelope(fields))}, nil
	}
	if err != nil {
		return nil, err
	}
	dto, err := productDTO(p, nil, nil, nil, nil)
	if err != nil {
		return nil, err
	}
	return api.CreateAdminProduct201JSONResponse(dto), nil
}

// UpdateAdminProduct handles PATCH /admin/products/{id} (owner-only). It saves the editable fields (never
// model3d_url). Unknown id → 404; a slug now taken → 400 (slug); an unknown categoryId → 400 (categoryId).
// Returns the updated product with its colors and options.
func (s *Server) UpdateAdminProduct(ctx context.Context, request api.UpdateAdminProductRequestObject) (api.UpdateAdminProductResponseObject, error) {
	if err := assertOwner(ctx); err != nil {
		return nil, err
	}
	if request.Body == nil {
		return api.UpdateAdminProduct400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(envelope(codeValidation))}, nil
	}
	c, fields, err := cleanProductInput(*request.Body)
	if err != nil {
		return nil, err
	}
	if len(fields) > 0 {
		return api.UpdateAdminProduct400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(fieldEnvelope(fields))}, nil
	}
	repo := db.NewCatalog(s.pool)
	p, err := repo.UpdateProduct(ctx, sqlc.UpdateProductParams{
		ID:             request.Id,
		Slug:           c.Slug,
		Name:           c.Name,
		Description:    c.Description,
		CategoryID:     c.CategoryID,
		BasePrice:      c.BasePrice,
		Dimensions:     c.Dimensions,
		Material:       c.Material,
		Images:         c.Images,
		Status:         c.Status,
		EstFilamentQty: c.EstFilamentQty, // ADR-039 flat-product deduct-on-print standard
	})
	if fields, ok := productWriteConflict(err); ok {
		return api.UpdateAdminProduct400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(fieldEnvelope(fields))}, nil
	}
	if err != nil {
		return nil, err // db.ErrNotFound → 404
	}
	colors, err := repo.ColorsByProduct(ctx, p.ID)
	if err != nil {
		return nil, err
	}
	options, err := repo.OptionsByProduct(ctx, p.ID)
	if err != nil {
		return nil, err
	}
	parts, err := repo.PartsByProduct(ctx, p.ID)
	if err != nil {
		return nil, err
	}
	choices, err := repo.ChoicesByProduct(ctx, p.ID)
	if err != nil {
		return nil, err
	}
	dto, err := productDTO(p, colors, options, parts, choices)
	if err != nil {
		return nil, err
	}
	return api.UpdateAdminProduct200JSONResponse(dto), nil
}

// DeleteAdminProduct handles DELETE /admin/products/{id} (owner-only). Hard delete; a product referenced by
// an order or asset job raises a foreign_key_violation → 409 PRODUCT_IN_USE (archive instead). Unknown id →
// 404.
func (s *Server) DeleteAdminProduct(ctx context.Context, request api.DeleteAdminProductRequestObject) (api.DeleteAdminProductResponseObject, error) {
	if err := assertOwner(ctx); err != nil {
		return nil, err
	}
	err := db.NewCatalog(s.pool).DeleteProduct(ctx, request.Id)
	if pgCode(err) == pgForeignKeyViolation {
		return nil, errProductInUse // → 409 (mapError)
	}
	if err != nil {
		return nil, err // db.ErrNotFound → 404
	}
	return api.DeleteAdminProduct204Response{}, nil
}

// UpdateProductModelView handles PATCH /admin/products/{id}/model-view (owner-only, ADR-038). It persists the
// owner's saved default camera pose for the 3D viewer — a separate write from the core-fields PATCH (the
// design's "Lưu góc mặc định" is its own button). Display metadata only: it never touches pricing. Out-of-
// range values → 400 field-map; unknown id → 404; success → 204 (the editor keeps the pose it just sent).
func (s *Server) UpdateProductModelView(ctx context.Context, request api.UpdateProductModelViewRequestObject) (api.UpdateProductModelViewResponseObject, error) {
	if err := assertOwner(ctx); err != nil {
		return nil, err
	}
	if request.Body == nil {
		return api.UpdateProductModelView400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(envelope(codeValidation))}, nil
	}
	if fields := cleanModelView(*request.Body); len(fields) > 0 {
		return api.UpdateProductModelView400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(fieldEnvelope(fields))}, nil
	}
	raw, err := json.Marshal(*request.Body)
	if err != nil {
		return nil, fmt.Errorf("model3d_view: marshal: %w", err)
	}
	if err := db.NewCatalog(s.pool).UpdateProductModelView(ctx, request.Id, raw); err != nil {
		return nil, err // db.ErrNotFound → 404
	}
	return api.UpdateProductModelView204Response{}, nil
}

// cleanModelView validates a saved camera pose (ADR-038): returns a per-field error map (empty = ok). Ranges
// mirror the openapi doc + model-viewer's grammar (radius must be positive); every field must be finite — a
// NaN/Inf can't arrive as valid JSON, but the guard keeps a non-finite value from ever reaching the DB. This
// is display metadata, not money — plain floats, so the int-VND rule does not apply.
func cleanModelView(v api.Model3dView) map[string]string {
	fields := map[string]string{}
	check := func(name string, val, lo, hi float64, loInclusive bool) {
		if math.IsNaN(val) || math.IsInf(val, 0) || val > hi || val < lo || (!loInclusive && val == lo) {
			fields[name] = msgKey(codeValidation)
		}
	}
	check("orbitTheta", v.OrbitTheta, -360, 360, true)
	check("orbitPhi", v.OrbitPhi, 0, 180, true)
	check("orbitRadius", v.OrbitRadius, 0, 1000, false) // (0, 1000] — a camera radius must be positive
	check("targetX", v.TargetX, -100, 100, true)
	check("targetY", v.TargetY, -100, 100, true)
	check("targetZ", v.TargetZ, -100, 100, true)
	return fields
}

// CreateProductColor handles POST /admin/products/{id}/colors (owner-only). An unknown product id raises a
// foreign_key_violation → 404 (the color's only inbound reference is the product).
func (s *Server) CreateProductColor(ctx context.Context, request api.CreateProductColorRequestObject) (api.CreateProductColorResponseObject, error) {
	if err := assertOwner(ctx); err != nil {
		return nil, err
	}
	if request.Body == nil {
		return api.CreateProductColor400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(envelope(codeValidation))}, nil
	}
	name, hex, priceDelta, fields := cleanColorInput(*request.Body)
	if len(fields) > 0 {
		return api.CreateProductColor400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(fieldEnvelope(fields))}, nil
	}
	repo := db.NewCatalog(s.pool)
	partID, partFields, err := resolveColorPart(ctx, repo, request.Id, request.Body.PartId)
	if err != nil {
		return nil, err
	}
	if len(partFields) > 0 {
		return api.CreateProductColor400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(fieldEnvelope(partFields))}, nil
	}
	col, err := repo.CreateColor(ctx, sqlc.InsertColorParams{
		ID:                 uuid.New(),
		ProductID:          request.Id,
		Name:               name,
		Hex:                hex,
		Available:          request.Body.Available,
		PriceDelta:         priceDelta,
		PartID:             partID,
		FilamentMaterialID: pgUUIDPtr(request.Body.FilamentMaterialId), // ADR-039: null = unlinked
	})
	if pgCode(err) == pgForeignKeyViolation {
		if pgConstraint(err) == fkColorFilamentMaterial {
			// A filamentMaterialId matching no filament → a field error, not the unknown-product 404.
			return api.CreateProductColor400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(fieldEnvelope(map[string]string{"filamentMaterialId": msgKey(codeValidation)}))}, nil
		}
		return nil, db.ErrNotFound // unknown product → 404
	}
	if err != nil {
		return nil, err
	}
	return api.CreateProductColor201JSONResponse(colorDTO(col)), nil
}

// UpdateProductColor handles PATCH /admin/products/{id}/colors/{colorId} (owner-only). Scoped by
// (product, colour); a colourId under another product → 404.
func (s *Server) UpdateProductColor(ctx context.Context, request api.UpdateProductColorRequestObject) (api.UpdateProductColorResponseObject, error) {
	if err := assertOwner(ctx); err != nil {
		return nil, err
	}
	if request.Body == nil {
		return api.UpdateProductColor400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(envelope(codeValidation))}, nil
	}
	name, hex, priceDelta, fields := cleanColorInput(*request.Body)
	if len(fields) > 0 {
		return api.UpdateProductColor400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(fieldEnvelope(fields))}, nil
	}
	repo := db.NewCatalog(s.pool)
	partID, partFields, err := resolveColorPart(ctx, repo, request.Id, request.Body.PartId)
	if err != nil {
		return nil, err
	}
	if len(partFields) > 0 {
		return api.UpdateProductColor400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(fieldEnvelope(partFields))}, nil
	}
	col, err := repo.UpdateColor(ctx, sqlc.UpdateColorParams{
		ID:                 request.ColorId,
		ProductID:          request.Id,
		Name:               name,
		Hex:                hex,
		Available:          request.Body.Available,
		PriceDelta:         priceDelta,
		PartID:             partID,
		FilamentMaterialID: pgUUIDPtr(request.Body.FilamentMaterialId), // ADR-039: null = unlinked
	})
	if pgCode(err) == pgForeignKeyViolation && pgConstraint(err) == fkColorFilamentMaterial {
		// A filamentMaterialId matching no filament → a field error (an update trips no product FK).
		return api.UpdateProductColor400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(fieldEnvelope(map[string]string{"filamentMaterialId": msgKey(codeValidation)}))}, nil
	}
	if err != nil {
		return nil, err // db.ErrNotFound → 404
	}
	return api.UpdateProductColor200JSONResponse(colorDTO(col)), nil
}

// DeleteProductColor handles DELETE /admin/products/{id}/colors/{colorId} (owner-only). Scoped by
// (product, colour); unknown → 404.
func (s *Server) DeleteProductColor(ctx context.Context, request api.DeleteProductColorRequestObject) (api.DeleteProductColorResponseObject, error) {
	if err := assertOwner(ctx); err != nil {
		return nil, err
	}
	if err := db.NewCatalog(s.pool).DeleteColor(ctx, sqlc.DeleteColorParams{
		ID:        request.ColorId,
		ProductID: request.Id,
	}); err != nil {
		return nil, err // db.ErrNotFound → 404
	}
	return api.DeleteProductColor204Response{}, nil
}

// CreateProductOption handles POST /admin/products/{id}/options (owner-only). An unknown product id → 404.
func (s *Server) CreateProductOption(ctx context.Context, request api.CreateProductOptionRequestObject) (api.CreateProductOptionResponseObject, error) {
	if err := assertOwner(ctx); err != nil {
		return nil, err
	}
	if request.Body == nil {
		return api.CreateProductOption400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(envelope(codeValidation))}, nil
	}
	label, desc, optType, priceDelta, maxChars, fields := cleanOptionInput(*request.Body)
	if len(fields) > 0 {
		return api.CreateProductOption400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(fieldEnvelope(fields))}, nil
	}
	opt, err := db.NewCatalog(s.pool).CreateOption(ctx, sqlc.InsertOptionParams{
		ID:          uuid.New(),
		ProductID:   request.Id,
		Label:       label,
		Description: desc,
		Type:        optType,
		PriceDelta:  priceDelta,
		MaxChars:    maxChars,
	})
	if pgCode(err) == pgForeignKeyViolation {
		return nil, db.ErrNotFound // unknown product → 404
	}
	if err != nil {
		return nil, err
	}
	return api.CreateProductOption201JSONResponse(optionDTO(opt)), nil
}

// UpdateProductOption handles PATCH /admin/products/{id}/options/{optionId} (owner-only). Scoped by
// (product, option); an optionId under another product → 404.
func (s *Server) UpdateProductOption(ctx context.Context, request api.UpdateProductOptionRequestObject) (api.UpdateProductOptionResponseObject, error) {
	if err := assertOwner(ctx); err != nil {
		return nil, err
	}
	if request.Body == nil {
		return api.UpdateProductOption400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(envelope(codeValidation))}, nil
	}
	label, desc, optType, priceDelta, maxChars, fields := cleanOptionInput(*request.Body)
	if len(fields) > 0 {
		return api.UpdateProductOption400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(fieldEnvelope(fields))}, nil
	}
	opt, err := db.NewCatalog(s.pool).UpdateOption(ctx, sqlc.UpdateOptionParams{
		ID:          request.OptionId,
		ProductID:   request.Id,
		Label:       label,
		Description: desc,
		Type:        optType,
		PriceDelta:  priceDelta,
		MaxChars:    maxChars,
	})
	if err != nil {
		return nil, err // db.ErrNotFound → 404
	}
	return api.UpdateProductOption200JSONResponse(optionDTO(opt)), nil
}

// DeleteProductOption handles DELETE /admin/products/{id}/options/{optionId} (owner-only). Scoped by
// (product, option); unknown → 404.
func (s *Server) DeleteProductOption(ctx context.Context, request api.DeleteProductOptionRequestObject) (api.DeleteProductOptionResponseObject, error) {
	if err := assertOwner(ctx); err != nil {
		return nil, err
	}
	if err := db.NewCatalog(s.pool).DeleteOption(ctx, sqlc.DeleteOptionParams{
		ID:        request.OptionId,
		ProductID: request.Id,
	}); err != nil {
		return nil, err // db.ErrNotFound → 404
	}
	return api.DeleteProductOption204Response{}, nil
}

// cleanedProduct is the validated, persist-ready product input (jsonb columns already marshaled).
type cleanedProduct struct {
	Slug           string
	Name           string
	Description    string
	CategoryID     uuid.UUID
	BasePrice      int64
	Dimensions     []byte
	Material       string
	Images         []byte
	Status         sqlc.ProductStatus
	EstFilamentQty int64 // ADR-039: est filament per unit for a FLAT product (0 = no estimate)
}

// cleanProductInput trims + validates a product create/replace body and marshals its jsonb columns
// (dimensions, images). It returns the cleaned fields and a per-field error map (empty ⇒ valid). The
// error return is a server fault (jsonb marshal), never a client error. Money (basePrice) is validated
// ≥ 0 here so a negative price is a 400 field error, not a 23514 check-violation 500.
func cleanProductInput(in api.ProductInput) (cleanedProduct, map[string]string, error) {
	fields := map[string]string{}
	c := cleanedProduct{
		Slug:       strings.TrimSpace(in.Slug),
		Name:       strings.TrimSpace(in.Name),
		CategoryID: in.CategoryId,
		BasePrice:  in.BasePrice,
		Material:   strings.TrimSpace(in.Material),
		Status:     sqlc.ProductStatus(in.Status),
	}
	if in.Description != nil {
		c.Description = strings.TrimSpace(*in.Description)
	}
	if in.EstFilamentQty != nil {
		c.EstFilamentQty = *in.EstFilamentQty // ADR-039 flat-product standard; nil → 0 (no estimate)
	}

	if c.Name == "" || utf8.RuneCountInString(c.Name) > maxProductNameChars {
		fields["name"] = msgKey(codeValidation)
	}
	if !slugRe.MatchString(c.Slug) || utf8.RuneCountInString(c.Slug) > maxSlugChars {
		fields["slug"] = msgKey(codeValidation)
	}
	if utf8.RuneCountInString(c.Description) > maxDescriptionChars {
		fields["description"] = msgKey(codeValidation)
	}
	if c.CategoryID == uuid.Nil {
		fields["categoryId"] = msgKey(codeValidation)
	}
	if c.BasePrice < 0 {
		fields["basePrice"] = msgKey(codeValidation)
	}
	if c.EstFilamentQty < 0 {
		fields["estFilamentQty"] = msgKey(codeValidation)
	}
	if _, ok := validMaterials[c.Material]; !ok {
		fields["material"] = msgKey(codeValidation)
	}
	if !isValidProductStatus(c.Status) {
		fields["status"] = msgKey(codeValidation)
	}
	if in.Dimensions.W <= 0 || in.Dimensions.D <= 0 || in.Dimensions.H <= 0 {
		fields["dimensions"] = msgKey(codeValidation)
	}

	if len(fields) > 0 {
		return cleanedProduct{}, fields, nil
	}

	dimsJSON, err := json.Marshal(in.Dimensions)
	if err != nil {
		return cleanedProduct{}, nil, fmt.Errorf("product: marshal dimensions: %w", err)
	}
	c.Dimensions = dimsJSON
	images := []string{}
	if in.Images != nil {
		images = *in.Images
	}
	imagesJSON, err := json.Marshal(images)
	if err != nil {
		return cleanedProduct{}, nil, fmt.Errorf("product: marshal images: %w", err)
	}
	c.Images = imagesJSON
	return c, nil, nil
}

// cleanColorInput trims + validates a colour create/replace body. hex must be a #hex string (CSS-injection
// guard); priceDelta defaults to 0 and must be ≥ 0.
func cleanColorInput(in api.ColorInput) (name, hex string, priceDelta int64, fields map[string]string) {
	name = strings.TrimSpace(in.Name)
	hex = strings.TrimSpace(in.Hex)
	fields = map[string]string{}
	if name == "" || utf8.RuneCountInString(name) > maxColorNameChars {
		fields["name"] = msgKey(codeValidation)
	}
	if !hexRe.MatchString(hex) {
		fields["hex"] = msgKey(codeValidation)
	}
	if in.PriceDelta != nil {
		priceDelta = *in.PriceDelta
	}
	if priceDelta < 0 {
		fields["priceDelta"] = msgKey(codeValidation)
	}
	if len(fields) > 0 {
		return "", "", 0, fields
	}
	return name, hex, priceDelta, nil
}

// cleanOptionInput trims + validates an option create/replace body. type must be a valid OptionType;
// priceDelta defaults to 0 (≥ 0); maxChars, if present, must be > 0.
func cleanOptionInput(in api.OptionInput) (label, description string, optType sqlc.OptionType, priceDelta int64, maxChars *int32, fields map[string]string) {
	label = strings.TrimSpace(in.Label)
	optType = sqlc.OptionType(in.Type)
	fields = map[string]string{}
	if label == "" || utf8.RuneCountInString(label) > maxOptionLabelChars {
		fields["label"] = msgKey(codeValidation)
	}
	if in.Description != nil {
		description = strings.TrimSpace(*in.Description)
		if utf8.RuneCountInString(description) > maxOptionDescChars {
			fields["description"] = msgKey(codeValidation)
		}
	}
	if optType != sqlc.OptionTypeText && optType != sqlc.OptionTypeChoice {
		fields["type"] = msgKey(codeValidation)
	}
	if in.PriceDelta != nil {
		priceDelta = *in.PriceDelta
	}
	if priceDelta < 0 {
		fields["priceDelta"] = msgKey(codeValidation)
	}
	if in.MaxChars != nil {
		if *in.MaxChars <= 0 {
			fields["maxChars"] = msgKey(codeValidation)
		} else {
			n := int32(*in.MaxChars)
			maxChars = &n
		}
	}
	if len(fields) > 0 {
		return "", "", "", 0, nil, fields
	}
	return label, description, optType, priceDelta, maxChars, nil
}

// fieldEnvelope builds a VALIDATION error envelope carrying a per-field error map.
func fieldEnvelope(fields map[string]string) api.ErrorEnvelope {
	env := envelope(codeValidation)
	env.Fields = &fields
	return env
}

// parseProductStatusFilter maps the optional ?status= query param to a *sqlc.ProductStatus (nil = all
// statuses). A value outside the enum → ok=false (400), so the filter is always a whitelisted value.
func parseProductStatusFilter(p *api.ProductStatus) (*sqlc.ProductStatus, bool) {
	if p == nil {
		return nil, true
	}
	st := sqlc.ProductStatus(*p)
	if !isValidProductStatus(st) {
		return nil, false
	}
	return &st, true
}

// isValidProductStatus reports whether s is one of the three known product statuses.
func isValidProductStatus(s sqlc.ProductStatus) bool {
	switch s {
	case sqlc.ProductStatusActive, sqlc.ProductStatusDraft, sqlc.ProductStatusArchived:
		return true
	default:
		return false
	}
}

// productWriteConflict maps a product insert/update DB error to a per-field 400: a UNIQUE(slug) violation
// → slug, a foreign_key_violation (bad category_id) → categoryId. Returns ok=false for any other error so
// the caller falls through to its normal error path (ErrNotFound→404, else 500).
func productWriteConflict(err error) (map[string]string, bool) {
	switch pgCode(err) {
	case pgUniqueViolation:
		return map[string]string{"slug": msgKey(codeValidation)}, true
	case pgForeignKeyViolation:
		return map[string]string{"categoryId": msgKey(codeValidation)}, true
	default:
		return nil, false
	}
}

// Postgres SQLSTATE codes we translate at the HTTP boundary (pgconn.PgError.Code).
const (
	pgUniqueViolation     = "23505"
	pgForeignKeyViolation = "23503"
)

// fkColorFilamentMaterial is the auto-named FK on colors.filament_material_id (ADR-039). A colour write can
// now trip 23503 on EITHER the product_id FK (unknown product → 404) or this one (bad filamentMaterialId →
// 400 field); the constraint name disambiguates. ponytail: Postgres's default name is <table>_<column>_fkey;
// if 000019's constraint is ever named explicitly, update this string.
const fkColorFilamentMaterial = "colors_filament_material_id_fkey"

// pgCode extracts the SQLSTATE from a pgconn error, or "" if err is nil / not a pg error.
func pgCode(err error) string {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code
	}
	return ""
}

// pgConstraint extracts the violated constraint name from a pg error, or "" if err is nil / not a pg error.
func pgConstraint(err error) string {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.ConstraintName
	}
	return ""
}

// colorDTO maps one colour row to the wire shape (drops the internal productId). Money stays raw int-VND.
func colorDTO(c sqlc.Color) api.Color {
	return api.Color{
		Id:                 c.ID,
		Name:               c.Name,
		Hex:                c.Hex,
		Available:          c.Available,
		PriceDelta:         c.PriceDelta,
		PartId:             uuidPtrFromPg(c.PartID),             // ADR-037: null = flat product-level colour
		FilamentMaterialId: uuidPtrFromPg(c.FilamentMaterialID), // ADR-039: null = colour not linked to a filament
	}
}

// optionDTO maps one option row to the wire shape (drops productId, widens nullable max_chars).
func optionDTO(o sqlc.Option) api.Option {
	return api.Option{
		Id:          o.ID,
		Label:       o.Label,
		Description: o.Description,
		Type:        api.OptionType(o.Type),
		PriceDelta:  o.PriceDelta,
		MaxChars:    maxCharsPtr(o.MaxChars),
	}
}

// adminProductSummaries maps product rows to the admin list projection (no colors/options → no N+1).
// images decodes the jsonb; a corrupt blob hard-fails the row's page (consistent with the storefront
// list) rather than silently dropping a cover. Money stays raw int-VND.
func adminProductSummaries(rows []sqlc.Product) []api.AdminProductSummary {
	out := make([]api.AdminProductSummary, len(rows))
	for i, p := range rows {
		images := []string{}
		if len(p.Images) > 0 {
			// A corrupt images jsonb can't happen on the validated write paths; decode-fail leaves [].
			_ = json.Unmarshal(p.Images, &images)
		}
		out[i] = api.AdminProductSummary{
			Id:          p.ID,
			Slug:        p.Slug,
			Name:        p.Name,
			BasePrice:   p.BasePrice,
			CategoryId:  p.CategoryID,
			Status:      api.ProductStatus(p.Status),
			Images:      images,
			RatingAvg:   p.RatingAvg,
			ReviewCount: int(p.ReviewCount),
			CreatedAt:   p.CreatedAt.Time,
		}
	}
	return out
}
