package httpapi

import (
	"context"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
)

// admin_filament.go — Vật tư inventory (ADR-039 slice 4a): the filament palette + its import lots. Reads
// (list/get) are admin-gated (owner+staff, default authRequired); writes (create/edit/import) are
// OWNER-only — enforced at the auth boundary (classify → authOwnerOnly) AND re-asserted here
// (defense-in-depth: costs are money-adjacent config, like the STK/catalog). Stock + weighted-average cost
// are DERIVED in SQL (never stored). This slice is INVENTORY only; deduct-on-print + the cost snapshot land
// in slice 4b (ADR-039).

// filament material/unit allowed sets — mirror the DB CHECK in migration 000018 (ADR-028: TEXT+CHECK, not a
// native enum). Handler validation gives a 400 field-map; the CHECK is the last-line guard.
var filamentMaterialTypes = map[string]bool{"PLA": true, "PETG": true, "recycled-PLA": true, "Resin": true}
var filamentUnits = map[string]bool{"gram": true, "ml": true}

const (
	// Import bounds double as overflow guards + fat-finger limits: spoolCount × qtyPerSpool and spoolCount ×
	// pricePerSpool stay far below int64 max (10k × 100k = 1e9 qty; 10k × 1e8 = 1e12 ₫).
	maxSpoolCount    = 10_000
	maxQtyPerSpool   = 100_000     // unit qty (grams/ml) per spool — a 100kg spool is already absurd
	maxPricePerSpool = 100_000_000 // ₫ per spool
)

// cleanedFilament is the validated filament-material write body.
type cleanedFilament struct {
	Name, Material, Unit string
	Hex                  *string
	LowStockThreshold    int64
	Archived             bool
}

// cleanFilamentMaterialInput trims + validates a material create/replace body → 400 field-map. hex (if
// present) must be a #hex string (CSS-injection guard, same as colours); material/unit ∈ the allowed sets;
// lowStockThreshold ≥ 0. Cost/stock are never in the body — they come from imports.
func cleanFilamentMaterialInput(in api.FilamentMaterialInput) (cleanedFilament, map[string]string) {
	fields := map[string]string{}
	name := strings.TrimSpace(in.Name)
	if name == "" || utf8.RuneCountInString(name) > maxColorNameChars {
		fields["name"] = msgKey(codeValidation)
	}
	if !filamentMaterialTypes[in.Material] {
		fields["material"] = msgKey(codeValidation)
	}
	if !filamentUnits[in.Unit] {
		fields["unit"] = msgKey(codeValidation)
	}
	var hex *string
	if in.Hex != nil && strings.TrimSpace(*in.Hex) != "" {
		h := strings.TrimSpace(*in.Hex)
		if !hexRe.MatchString(h) {
			fields["hex"] = msgKey(codeValidation)
		} else {
			hex = &h
		}
	}
	if in.LowStockThreshold < 0 {
		fields["lowStockThreshold"] = msgKey(codeValidation)
	}
	if len(fields) > 0 {
		return cleanedFilament{}, fields
	}
	archived := false
	if in.Archived != nil {
		archived = *in.Archived
	}
	return cleanedFilament{Name: name, Material: in.Material, Unit: in.Unit, Hex: hex, LowStockThreshold: in.LowStockThreshold, Archived: archived}, nil
}

// cleanFilamentImportInput validates a "nhập cuộn" body and derives the lot totals: qtyOriginal =
// spoolCount × qtyPerSpool, totalCostVnd = spoolCount × pricePerSpool. Bounds keep both products overflow-safe.
func cleanFilamentImportInput(in api.FilamentImportInput) (qtyOriginal, totalCostVnd int64, fields map[string]string) {
	fields = map[string]string{}
	if in.SpoolCount < 1 || in.SpoolCount > maxSpoolCount {
		fields["spoolCount"] = msgKey(codeValidation)
	}
	if in.QtyPerSpool < 1 || in.QtyPerSpool > maxQtyPerSpool {
		fields["qtyPerSpool"] = msgKey(codeValidation)
	}
	if in.PricePerSpoolVnd < 0 || in.PricePerSpoolVnd > maxPricePerSpool {
		fields["pricePerSpoolVnd"] = msgKey(codeValidation)
	}
	if len(fields) > 0 {
		return 0, 0, fields
	}
	return in.SpoolCount * in.QtyPerSpool, in.SpoolCount * in.PricePerSpoolVnd, nil
}

// filamentMaterialDTO builds the API material from its columns + DERIVED stock/avg. avgCostPerUnit is a
// display RATE (₫/unit, may be fractional), NOT stored money — frozen to int only at the print-time
// snapshot (slice 4b).
func filamentMaterialDTO(id uuid.UUID, name, material, unit string, hex *string, threshold int64, archived bool, stock int64, avg float64, created, updated time.Time) api.FilamentMaterial {
	return api.FilamentMaterial{
		Id:                id,
		Name:              name,
		Material:          material,
		Unit:              unit,
		Hex:               hex,
		LowStockThreshold: threshold,
		Archived:          archived,
		StockQty:          stock,
		AvgCostPerUnit:    avg,
		CreatedAt:         created,
		UpdatedAt:         updated,
	}
}

func filamentListDTO(r sqlc.ListFilamentMaterialsRow) api.FilamentMaterial {
	return filamentMaterialDTO(r.ID, r.Name, r.Material, r.Unit, r.Hex, r.LowStockThreshold, r.Archived, r.StockQty, r.AvgCostPerUnit, r.CreatedAt.Time, r.UpdatedAt.Time)
}

func filamentGetDTO(r sqlc.GetFilamentMaterialRow) api.FilamentMaterial {
	return filamentMaterialDTO(r.ID, r.Name, r.Material, r.Unit, r.Hex, r.LowStockThreshold, r.Archived, r.StockQty, r.AvgCostPerUnit, r.CreatedAt.Time, r.UpdatedAt.Time)
}

func filamentBatchDTO(b sqlc.FilamentBatch) api.FilamentBatch {
	return api.FilamentBatch{
		Id:           b.ID,
		MaterialId:   b.MaterialID,
		ImportedAt:   b.ImportedAt.Time,
		QtyOriginal:  b.QtyOriginal,
		QtyRemaining: b.QtyRemaining,
		TotalCostVnd: b.TotalCostVnd,
	}
}

func filamentDetailDTO(m api.FilamentMaterial, batches []sqlc.FilamentBatch) api.FilamentMaterialDetail {
	out := make([]api.FilamentBatch, len(batches))
	for i, b := range batches {
		out[i] = filamentBatchDTO(b)
	}
	return api.FilamentMaterialDetail{Material: m, Batches: out}
}

// ListFilamentMaterials handles GET /admin/filament-materials (admin-gated: owner+staff read). The palette
// with derived stock + weighted-average cost; includeArchived NULL/false → active only.
func (s *Server) ListFilamentMaterials(ctx context.Context, request api.ListFilamentMaterialsRequestObject) (api.ListFilamentMaterialsResponseObject, error) {
	rows, err := db.NewFilament(s.pool).ListMaterials(ctx, request.Params.IncludeArchived)
	if err != nil {
		return nil, err
	}
	out := make([]api.FilamentMaterial, len(rows))
	for i, r := range rows {
		out[i] = filamentListDTO(r)
	}
	return api.ListFilamentMaterials200JSONResponse(out), nil
}

// CreateFilamentMaterial handles POST /admin/filament-materials (owner-only). A fresh material has no
// batches → stock 0, avg 0.
func (s *Server) CreateFilamentMaterial(ctx context.Context, request api.CreateFilamentMaterialRequestObject) (api.CreateFilamentMaterialResponseObject, error) {
	if err := assertOwner(ctx); err != nil {
		return nil, err
	}
	if request.Body == nil {
		return api.CreateFilamentMaterial400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(envelope(codeValidation))}, nil
	}
	c, fields := cleanFilamentMaterialInput(*request.Body)
	if len(fields) > 0 {
		return api.CreateFilamentMaterial400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(fieldEnvelope(fields))}, nil
	}
	m, err := db.NewFilament(s.pool).InsertMaterial(ctx, sqlc.InsertFilamentMaterialParams{
		ID:                uuid.New(),
		Name:              c.Name,
		Material:          c.Material,
		Unit:              c.Unit,
		Hex:               c.Hex,
		LowStockThreshold: c.LowStockThreshold,
	})
	if err != nil {
		return nil, err
	}
	return api.CreateFilamentMaterial201JSONResponse(filamentMaterialDTO(m.ID, m.Name, m.Material, m.Unit, m.Hex, m.LowStockThreshold, m.Archived, 0, 0, m.CreatedAt.Time, m.UpdatedAt.Time)), nil
}

// GetFilamentMaterial handles GET /admin/filament-materials/{id} (admin-gated read): the material with its
// import-lot breakdown (the weighted-average panel).
func (s *Server) GetFilamentMaterial(ctx context.Context, request api.GetFilamentMaterialRequestObject) (api.GetFilamentMaterialResponseObject, error) {
	repo := db.NewFilament(s.pool)
	row, err := repo.GetMaterial(ctx, request.Id)
	if err != nil {
		return nil, err // ErrNotFound → 404
	}
	batches, err := repo.ListBatches(ctx, request.Id)
	if err != nil {
		return nil, err
	}
	return api.GetFilamentMaterial200JSONResponse(filamentDetailDTO(filamentGetDTO(row), batches)), nil
}

// UpdateFilamentMaterial handles PATCH /admin/filament-materials/{id} (owner-only). Edits the palette
// fields (set archived true to soft-delete); re-reads for the derived stock/avg since a plain UPDATE can't
// aggregate the batches.
func (s *Server) UpdateFilamentMaterial(ctx context.Context, request api.UpdateFilamentMaterialRequestObject) (api.UpdateFilamentMaterialResponseObject, error) {
	if err := assertOwner(ctx); err != nil {
		return nil, err
	}
	if request.Body == nil {
		return api.UpdateFilamentMaterial400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(envelope(codeValidation))}, nil
	}
	c, fields := cleanFilamentMaterialInput(*request.Body)
	if len(fields) > 0 {
		return api.UpdateFilamentMaterial400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(fieldEnvelope(fields))}, nil
	}
	repo := db.NewFilament(s.pool)
	if _, err := repo.UpdateMaterial(ctx, sqlc.UpdateFilamentMaterialParams{
		ID:                request.Id,
		Name:              c.Name,
		Material:          c.Material,
		Unit:              c.Unit,
		Hex:               c.Hex,
		LowStockThreshold: c.LowStockThreshold,
		Archived:          c.Archived,
	}); err != nil {
		return nil, err // ErrNotFound → 404
	}
	row, err := repo.GetMaterial(ctx, request.Id)
	if err != nil {
		return nil, err
	}
	return api.UpdateFilamentMaterial200JSONResponse(filamentGetDTO(row)), nil
}

// ImportFilament handles POST /admin/filament-materials/{id}/import (owner-only): record one import lot,
// which moves the weighted average. A bad material id trips the FK → 404. Returns the material with the new
// batch + updated stock/avg.
func (s *Server) ImportFilament(ctx context.Context, request api.ImportFilamentRequestObject) (api.ImportFilamentResponseObject, error) {
	if err := assertOwner(ctx); err != nil {
		return nil, err
	}
	if request.Body == nil {
		return api.ImportFilament400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(envelope(codeValidation))}, nil
	}
	qtyOriginal, totalCostVnd, fields := cleanFilamentImportInput(*request.Body)
	if len(fields) > 0 {
		return api.ImportFilament400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(fieldEnvelope(fields))}, nil
	}
	repo := db.NewFilament(s.pool)
	_, err := repo.InsertBatch(ctx, sqlc.InsertFilamentBatchParams{
		ID:           uuid.New(),
		MaterialID:   request.Id,
		QtyOriginal:  qtyOriginal,
		TotalCostVnd: totalCostVnd,
	})
	if pgCode(err) == pgForeignKeyViolation {
		return nil, db.ErrNotFound // unknown material → 404
	}
	if err != nil {
		return nil, err
	}
	row, err := repo.GetMaterial(ctx, request.Id)
	if err != nil {
		return nil, err
	}
	batches, err := repo.ListBatches(ctx, request.Id)
	if err != nil {
		return nil, err
	}
	return api.ImportFilament200JSONResponse(filamentDetailDTO(filamentGetDTO(row), batches)), nil
}
