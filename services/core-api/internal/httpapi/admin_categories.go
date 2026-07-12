package httpapi

import (
	"context"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
)

// admin_categories.go — the admin category taxonomy WRITE surface (P3-o): list every category with its
// product count (admin-gated read), plus create/rename/delete (owner-only). Categories are the taxonomy a
// product belongs to; managing them is a catalog power, so every WRITE is owner-only (spec §08 — enforced at
// the boundary via classify→authOwnerOnly AND re-asserted here with assertOwner, the same defense-in-depth as
// products/settings). slug shape + name length are validated here so a bad value is a 400 field error, never
// a DB check/constraint surfacing as 500. Reuses slugRe/maxSlugChars/pgCode/fieldEnvelope from admin_products.

// maxCategoryNameChars caps the category display name (belt against a pathological blob; the UI keeps well
// under it). Measured in runes — Vietnamese is multibyte.
const maxCategoryNameChars = 200

// GetAdminCategories handles GET /admin/categories (admin-gated read; owner+staff). It returns EVERY category
// with its product count (across all statuses), name A→Z — the internal admin taxonomy, unlike the public
// active-only GetCategories. Not paginated (the set is small and admin-curated).
func (s *Server) GetAdminCategories(ctx context.Context, _ api.GetAdminCategoriesRequestObject) (api.GetAdminCategoriesResponseObject, error) {
	rows, err := db.NewCatalog(s.pool).AdminCategories(ctx)
	if err != nil {
		return nil, err
	}
	return api.GetAdminCategories200JSONResponse(adminCategorySummaries(rows)), nil
}

// CreateAdminCategory handles POST /admin/categories (owner-only). A duplicate slug → 400 (slug). The response
// is the created Category (its productCount is definitionally 0, so the list shape is not needed here).
func (s *Server) CreateAdminCategory(ctx context.Context, request api.CreateAdminCategoryRequestObject) (api.CreateAdminCategoryResponseObject, error) {
	if err := assertOwner(ctx); err != nil {
		return nil, err
	}
	if request.Body == nil {
		return api.CreateAdminCategory400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(envelope(codeValidation))}, nil
	}
	slug, name, fields := cleanCategoryInput(*request.Body)
	if len(fields) > 0 {
		return api.CreateAdminCategory400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(fieldEnvelope(fields))}, nil
	}
	cat, err := db.NewCatalog(s.pool).CreateCategory(ctx, sqlc.InsertCategoryParams{ID: uuid.New(), Slug: slug, Name: name})
	if pgCode(err) == pgUniqueViolation {
		return api.CreateAdminCategory400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(fieldEnvelope(map[string]string{"slug": msgKey(codeValidation)}))}, nil
	}
	if err != nil {
		return nil, err
	}
	return api.CreateAdminCategory201JSONResponse(categoryDTO(cat)), nil
}

// UpdateAdminCategory handles PATCH /admin/categories/{id} (owner-only). Unknown id → 404; a slug now taken by
// another category → 400 (slug). The response is the updated Category (productCount is unchanged by a rename).
func (s *Server) UpdateAdminCategory(ctx context.Context, request api.UpdateAdminCategoryRequestObject) (api.UpdateAdminCategoryResponseObject, error) {
	if err := assertOwner(ctx); err != nil {
		return nil, err
	}
	if request.Body == nil {
		return api.UpdateAdminCategory400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(envelope(codeValidation))}, nil
	}
	slug, name, fields := cleanCategoryInput(*request.Body)
	if len(fields) > 0 {
		return api.UpdateAdminCategory400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(fieldEnvelope(fields))}, nil
	}
	cat, err := db.NewCatalog(s.pool).UpdateCategory(ctx, sqlc.UpdateCategoryParams{ID: request.Id, Slug: slug, Name: name})
	if pgCode(err) == pgUniqueViolation {
		return api.UpdateAdminCategory400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(fieldEnvelope(map[string]string{"slug": msgKey(codeValidation)}))}, nil
	}
	if err != nil {
		return nil, err // db.ErrNotFound → 404
	}
	return api.UpdateAdminCategory200JSONResponse(categoryDTO(cat)), nil
}

// DeleteAdminCategory handles DELETE /admin/categories/{id} (owner-only). Hard delete; a category still
// referenced by a product raises a foreign_key_violation → 409 CATEGORY_IN_USE (reassign/archive first).
// Unknown id → 404.
func (s *Server) DeleteAdminCategory(ctx context.Context, request api.DeleteAdminCategoryRequestObject) (api.DeleteAdminCategoryResponseObject, error) {
	if err := assertOwner(ctx); err != nil {
		return nil, err
	}
	err := db.NewCatalog(s.pool).DeleteCategory(ctx, request.Id)
	if pgCode(err) == pgForeignKeyViolation {
		return nil, errCategoryInUse // → 409 (mapError)
	}
	if err != nil {
		return nil, err // db.ErrNotFound → 404
	}
	return api.DeleteAdminCategory204Response{}, nil
}

// cleanCategoryInput trims + validates a category create/rename body: returns the cleaned slug + name and a
// per-field error map (empty ⇒ valid). slug must match the URL-safe shape (so a junk slug never reaches the
// storefront /products?category= URL); name must be non-empty and within the length cap.
func cleanCategoryInput(in api.CategoryInput) (slug, name string, fields map[string]string) {
	slug = strings.TrimSpace(in.Slug)
	name = strings.TrimSpace(in.Name)
	fields = map[string]string{}
	if !slugRe.MatchString(slug) || utf8.RuneCountInString(slug) > maxSlugChars {
		fields["slug"] = msgKey(codeValidation)
	}
	if name == "" || utf8.RuneCountInString(name) > maxCategoryNameChars {
		fields["name"] = msgKey(codeValidation)
	}
	if len(fields) > 0 {
		return "", "", fields
	}
	return slug, name, nil
}

// adminCategorySummaries maps category+count rows to the admin list projection.
func adminCategorySummaries(rows []sqlc.ListAllCategoriesRow) []api.AdminCategory {
	out := make([]api.AdminCategory, len(rows))
	for i, c := range rows {
		out[i] = api.AdminCategory{Id: c.ID, Slug: c.Slug, Name: c.Name, ProductCount: c.ProductCount}
	}
	return out
}

// categoryDTO maps one persisted category row to the plain wire shape (create/rename responses).
func categoryDTO(c sqlc.Category) api.Category {
	return api.Category{Id: c.ID, Slug: c.Slug, Name: c.Name}
}
