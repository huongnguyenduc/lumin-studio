package httpapi

import (
	"context"
	"errors"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
)

// admin_configurator.go — the ADR-037 configurator WRITE surface: named parts (each grouping a subset of a
// product's colours, so the customer picks one colour per part) and enumerated option choices (a `choice`
// option offering S/M/L…). Every write is owner-only (classify→authOwnerOnly AND re-asserted with
// assertOwner, the same defense-in-depth as the rest of the catalog). Additive to P3-j: colours join a part
// via ColorInput.partId (validated ∈ the same product here — the catalog-write half of the ADR-037
// "colour ∈ part ∈ product" guard; pricing re-checks at order time). Money crosses the wire raw int-VND.

const (
	maxPartNameChars    = 200
	maxChoiceLabelChars = 200
	maxChoiceDescChars  = 2000
)

// resolveColorPart validates a colour's optional partId against its product and returns the pgtype.UUID for
// the colors.part_id column. nil partId → SQL NULL (a flat, product-level colour). A partId set but not a
// part of THIS product → a `partId` field error (400), so a colour can never be grouped under another
// product's part. A non-NotFound error propagates (→ 500).
//
// ponytail: a partId supplied against a NON-existent product also returns 400 partId (not the 404 the same
// product would give with partId==nil) — a partId matching no part IS invalid, it leaks nothing, and a
// product-existence pre-read on every call isn't worth the strict-404. Upgrade path: fetch the product
// first if the product-404 must ever win over the field error.
func resolveColorPart(ctx context.Context, repo *db.Catalog, productID uuid.UUID, partID *uuid.UUID) (pgtype.UUID, map[string]string, error) {
	if partID == nil {
		return pgtype.UUID{Valid: false}, nil, nil
	}
	if _, err := repo.PartByProduct(ctx, sqlc.GetPartByProductParams{ID: *partID, ProductID: productID}); err != nil {
		if errors.Is(err, db.ErrNotFound) {
			return pgtype.UUID{}, map[string]string{"partId": msgKey(codeValidation)}, nil
		}
		return pgtype.UUID{}, nil, err
	}
	return pgtype.UUID{Bytes: *partID, Valid: true}, nil, nil
}

// CreateProductPart handles POST /admin/products/{id}/parts (owner-only). An unknown product id → 404.
func (s *Server) CreateProductPart(ctx context.Context, request api.CreateProductPartRequestObject) (api.CreateProductPartResponseObject, error) {
	if err := assertOwner(ctx); err != nil {
		return nil, err
	}
	if request.Body == nil {
		return api.CreateProductPart400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(envelope(codeValidation))}, nil
	}
	name, order, fields := cleanPartInput(*request.Body)
	if len(fields) > 0 {
		return api.CreateProductPart400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(fieldEnvelope(fields))}, nil
	}
	part, err := db.NewCatalog(s.pool).CreatePart(ctx, sqlc.InsertPartParams{
		ID:           uuid.New(),
		ProductID:    request.Id,
		Name:         name,
		DisplayOrder: order,
	})
	if pgCode(err) == pgForeignKeyViolation {
		return nil, db.ErrNotFound // unknown product → 404
	}
	if err != nil {
		return nil, err
	}
	return api.CreateProductPart201JSONResponse(partDTO(part)), nil
}

// UpdateProductPart handles PATCH /admin/products/{id}/parts/{partId} (owner-only). Scoped by (product,
// part); a partId under another product → 404.
func (s *Server) UpdateProductPart(ctx context.Context, request api.UpdateProductPartRequestObject) (api.UpdateProductPartResponseObject, error) {
	if err := assertOwner(ctx); err != nil {
		return nil, err
	}
	if request.Body == nil {
		return api.UpdateProductPart400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(envelope(codeValidation))}, nil
	}
	name, order, fields := cleanPartInput(*request.Body)
	if len(fields) > 0 {
		return api.UpdateProductPart400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(fieldEnvelope(fields))}, nil
	}
	part, err := db.NewCatalog(s.pool).UpdatePart(ctx, sqlc.UpdatePartParams{
		ID:           request.PartId,
		ProductID:    request.Id,
		Name:         name,
		DisplayOrder: order,
	})
	if err != nil {
		return nil, err // db.ErrNotFound → 404
	}
	return api.UpdateProductPart200JSONResponse(partDTO(part)), nil
}

// DeleteProductPart handles DELETE /admin/products/{id}/parts/{partId} (owner-only). Deleting a part
// CASCADEs its colours; a colour already pinned by an order raises a foreign_key_violation → 409
// PRODUCT_IN_USE (archive instead). Scoped by (product, part); unknown → 404.
func (s *Server) DeleteProductPart(ctx context.Context, request api.DeleteProductPartRequestObject) (api.DeleteProductPartResponseObject, error) {
	if err := assertOwner(ctx); err != nil {
		return nil, err
	}
	err := db.NewCatalog(s.pool).DeletePart(ctx, sqlc.DeletePartParams{
		ID:        request.PartId,
		ProductID: request.Id,
	})
	if pgCode(err) == pgForeignKeyViolation {
		return nil, errProductInUse // an ordered colour blocks the cascade → 409 (mapError)
	}
	if err != nil {
		return nil, err // db.ErrNotFound → 404
	}
	return api.DeleteProductPart204Response{}, nil
}

// CreateOptionChoice handles POST /admin/products/{id}/options/{optionId}/choices (owner-only). The
// {optionId} must belong to {id} (else 404) so a choice can never attach to another product's option.
func (s *Server) CreateOptionChoice(ctx context.Context, request api.CreateOptionChoiceRequestObject) (api.CreateOptionChoiceResponseObject, error) {
	if err := assertOwner(ctx); err != nil {
		return nil, err
	}
	if request.Body == nil {
		return api.CreateOptionChoice400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(envelope(codeValidation))}, nil
	}
	repo := db.NewCatalog(s.pool)
	if _, err := repo.OptionByProduct(ctx, sqlc.GetOptionByProductParams{ID: request.OptionId, ProductID: request.Id}); err != nil {
		return nil, err // db.ErrNotFound → 404 (unknown product or option-under-wrong-product)
	}
	label, desc, priceDelta, order, fields := cleanOptionChoiceInput(*request.Body)
	if len(fields) > 0 {
		return api.CreateOptionChoice400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(fieldEnvelope(fields))}, nil
	}
	ch, err := repo.CreateOptionChoice(ctx, sqlc.InsertOptionChoiceParams{
		ID:           uuid.New(),
		OptionID:     request.OptionId,
		Label:        label,
		Description:  desc,
		PriceDelta:   priceDelta,
		DisplayOrder: order,
	})
	if err != nil {
		return nil, err
	}
	return api.CreateOptionChoice201JSONResponse(optionChoiceDTO(ch)), nil
}

// UpdateOptionChoice handles PATCH /admin/products/{id}/options/{optionId}/choices/{choiceId} (owner-only).
// Scoped by option ∈ product then (choice, option); a mismatched id → 404.
func (s *Server) UpdateOptionChoice(ctx context.Context, request api.UpdateOptionChoiceRequestObject) (api.UpdateOptionChoiceResponseObject, error) {
	if err := assertOwner(ctx); err != nil {
		return nil, err
	}
	if request.Body == nil {
		return api.UpdateOptionChoice400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(envelope(codeValidation))}, nil
	}
	repo := db.NewCatalog(s.pool)
	if _, err := repo.OptionByProduct(ctx, sqlc.GetOptionByProductParams{ID: request.OptionId, ProductID: request.Id}); err != nil {
		return nil, err // db.ErrNotFound → 404
	}
	label, desc, priceDelta, order, fields := cleanOptionChoiceInput(*request.Body)
	if len(fields) > 0 {
		return api.UpdateOptionChoice400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(fieldEnvelope(fields))}, nil
	}
	ch, err := repo.UpdateOptionChoice(ctx, sqlc.UpdateOptionChoiceParams{
		ID:           request.ChoiceId,
		OptionID:     request.OptionId,
		Label:        label,
		Description:  desc,
		PriceDelta:   priceDelta,
		DisplayOrder: order,
	})
	if err != nil {
		return nil, err // db.ErrNotFound → 404
	}
	return api.UpdateOptionChoice200JSONResponse(optionChoiceDTO(ch)), nil
}

// DeleteOptionChoice handles DELETE /admin/products/{id}/options/{optionId}/choices/{choiceId} (owner-only).
// Scoped by option ∈ product then (choice, option); unknown → 404.
func (s *Server) DeleteOptionChoice(ctx context.Context, request api.DeleteOptionChoiceRequestObject) (api.DeleteOptionChoiceResponseObject, error) {
	if err := assertOwner(ctx); err != nil {
		return nil, err
	}
	repo := db.NewCatalog(s.pool)
	if _, err := repo.OptionByProduct(ctx, sqlc.GetOptionByProductParams{ID: request.OptionId, ProductID: request.Id}); err != nil {
		return nil, err // db.ErrNotFound → 404
	}
	if err := repo.DeleteOptionChoice(ctx, sqlc.DeleteOptionChoiceParams{ID: request.ChoiceId, OptionID: request.OptionId}); err != nil {
		return nil, err // db.ErrNotFound → 404
	}
	return api.DeleteOptionChoice204Response{}, nil
}

// cleanPartInput trims + validates a part create/replace body. displayOrder defaults to 0.
func cleanPartInput(in api.PartInput) (name string, displayOrder int32, fields map[string]string) {
	name = strings.TrimSpace(in.Name)
	fields = map[string]string{}
	if name == "" || utf8.RuneCountInString(name) > maxPartNameChars {
		fields["name"] = msgKey(codeValidation)
	}
	if in.DisplayOrder != nil {
		displayOrder = int32(*in.DisplayOrder)
	}
	if len(fields) > 0 {
		return "", 0, fields
	}
	return name, displayOrder, nil
}

// cleanOptionChoiceInput trims + validates an option-choice create/replace body. priceDelta defaults to 0
// (≥ 0); displayOrder defaults to 0.
func cleanOptionChoiceInput(in api.OptionChoiceInput) (label, description string, priceDelta int64, displayOrder int32, fields map[string]string) {
	label = strings.TrimSpace(in.Label)
	fields = map[string]string{}
	if label == "" || utf8.RuneCountInString(label) > maxChoiceLabelChars {
		fields["label"] = msgKey(codeValidation)
	}
	if in.Description != nil {
		description = strings.TrimSpace(*in.Description)
		if utf8.RuneCountInString(description) > maxChoiceDescChars {
			fields["description"] = msgKey(codeValidation)
		}
	}
	if in.PriceDelta != nil {
		priceDelta = *in.PriceDelta
	}
	if priceDelta < 0 {
		fields["priceDelta"] = msgKey(codeValidation)
	}
	if in.DisplayOrder != nil {
		displayOrder = int32(*in.DisplayOrder)
	}
	if len(fields) > 0 {
		return "", "", 0, 0, fields
	}
	return label, description, priceDelta, displayOrder, nil
}
