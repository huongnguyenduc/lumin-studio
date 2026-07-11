package httpapi

import (
	"context"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
)

// admin_costing.go — the Vật tư cost-input WRITE/READ surface (ADR-039 slice 4c-1): machines (depreciation)
// + aux_costs (overhead) CRUD, and the scrap-log endpoint (hao-hụt). Every mutation is owner-only
// (classify→authOwnerOnly AND re-asserted with assertOwner, the same defense-in-depth as the rest of Vật tư);
// the list reads are admin-gated (owner+staff, classify default — the /vat-tu tabs). Money crosses the wire
// raw int-VND (always-must #2); the ₫/hour rate + the per-order allocation are DERIVED (never stored, ADR-039
// pt 8) — machineDTO computes ₫/hour, the 4c-2 rollup derives the aux allocation. Scrap reuses the
// deduct-on-print draw helper (Filament.Decrement, kind='scrap') so it flows through the SAME FIFO ledger.

// Sanity caps on the owner's cost inputs (belt against a pathological blob; the UI keeps well under these).
const (
	maxMachineNameChars   = 200
	maxAuxLabelChars      = 200
	maxScrapReasonChars   = 500
	maxScrapNoteChars     = 2000
	maxMachinePriceVnd    = 100_000_000_000 // 100 tỷ — a 3D printer is far under this
	maxDepreciationMonths = 1200            // 100 years
	maxHoursPerMonth      = 744             // 24 × 31
	maxScrapQty           = 1_000_000
)

// auxCostKinds mirrors the aux_costs.kind CHECK (migration 000020). Validated here so a bad kind is a 400
// field error, not a 23514 check-violation 500 (ADR-028, same stance as filament material/unit).
var auxCostKinds = map[string]struct{}{"per_order": {}, "per_month": {}}

// ── Machines ──────────────────────────────────────────────────────────────────────────────────────────

// ListMachines handles GET /admin/machines (admin-gated: owner+staff). Machines with derived ₫/hour.
func (s *Server) ListMachines(ctx context.Context, _ api.ListMachinesRequestObject) (api.ListMachinesResponseObject, error) {
	rows, err := db.NewCosting(s.pool).ListMachines(ctx)
	if err != nil {
		return nil, err
	}
	return api.ListMachines200JSONResponse(machinesDTO(rows)), nil
}

// CreateMachine handles POST /admin/machines (owner-only).
func (s *Server) CreateMachine(ctx context.Context, request api.CreateMachineRequestObject) (api.CreateMachineResponseObject, error) {
	if err := assertOwner(ctx); err != nil {
		return nil, err
	}
	if request.Body == nil {
		return api.CreateMachine400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(envelope(codeValidation))}, nil
	}
	c, fields := cleanMachineInput(*request.Body)
	if len(fields) > 0 {
		return api.CreateMachine400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(fieldEnvelope(fields))}, nil
	}
	m, err := db.NewCosting(s.pool).InsertMachine(ctx, sqlc.InsertMachineParams{
		ID:                    uuid.New(),
		Name:                  c.Name,
		PurchasePriceVnd:      c.PurchasePriceVnd,
		DepreciationMonths:    c.DepreciationMonths,
		ExpectedHoursPerMonth: c.ExpectedHoursPerMonth,
		IsPrimary:             c.IsPrimary,
		Active:                c.Active,
	})
	if err != nil {
		return nil, err
	}
	return api.CreateMachine201JSONResponse(machineDTO(m)), nil
}

// UpdateMachine handles PATCH /admin/machines/{id} (owner-only). Unknown id → 404.
func (s *Server) UpdateMachine(ctx context.Context, request api.UpdateMachineRequestObject) (api.UpdateMachineResponseObject, error) {
	if err := assertOwner(ctx); err != nil {
		return nil, err
	}
	if request.Body == nil {
		return api.UpdateMachine400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(envelope(codeValidation))}, nil
	}
	c, fields := cleanMachineInput(*request.Body)
	if len(fields) > 0 {
		return api.UpdateMachine400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(fieldEnvelope(fields))}, nil
	}
	m, err := db.NewCosting(s.pool).UpdateMachine(ctx, sqlc.UpdateMachineParams{
		ID:                    request.Id,
		Name:                  c.Name,
		PurchasePriceVnd:      c.PurchasePriceVnd,
		DepreciationMonths:    c.DepreciationMonths,
		ExpectedHoursPerMonth: c.ExpectedHoursPerMonth,
		IsPrimary:             c.IsPrimary,
		Active:                c.Active,
	})
	if err != nil {
		return nil, err // db.ErrNotFound → 404
	}
	return api.UpdateMachine200JSONResponse(machineDTO(m)), nil
}

// DeleteMachine handles DELETE /admin/machines/{id} (owner-only). Unknown id → 404. Hard delete: a machine
// has no FK dependents (the snapshot freezes a machineVnd number, never a machine reference).
func (s *Server) DeleteMachine(ctx context.Context, request api.DeleteMachineRequestObject) (api.DeleteMachineResponseObject, error) {
	if err := assertOwner(ctx); err != nil {
		return nil, err
	}
	if err := db.NewCosting(s.pool).DeleteMachine(ctx, request.Id); err != nil {
		return nil, err // db.ErrNotFound → 404
	}
	return api.DeleteMachine204Response{}, nil
}

// ── Aux costs ─────────────────────────────────────────────────────────────────────────────────────────

// ListAuxCosts handles GET /admin/aux-costs (admin-gated: owner+staff).
func (s *Server) ListAuxCosts(ctx context.Context, _ api.ListAuxCostsRequestObject) (api.ListAuxCostsResponseObject, error) {
	rows, err := db.NewCosting(s.pool).ListAuxCosts(ctx)
	if err != nil {
		return nil, err
	}
	return api.ListAuxCosts200JSONResponse(auxCostsDTO(rows)), nil
}

// CreateAuxCost handles POST /admin/aux-costs (owner-only).
func (s *Server) CreateAuxCost(ctx context.Context, request api.CreateAuxCostRequestObject) (api.CreateAuxCostResponseObject, error) {
	if err := assertOwner(ctx); err != nil {
		return nil, err
	}
	if request.Body == nil {
		return api.CreateAuxCost400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(envelope(codeValidation))}, nil
	}
	c, fields := cleanAuxCostInput(*request.Body)
	if len(fields) > 0 {
		return api.CreateAuxCost400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(fieldEnvelope(fields))}, nil
	}
	a, err := db.NewCosting(s.pool).InsertAuxCost(ctx, sqlc.InsertAuxCostParams{
		ID: uuid.New(), Label: c.Label, Kind: c.Kind, AmountVnd: c.AmountVnd,
	})
	if err != nil {
		return nil, err
	}
	return api.CreateAuxCost201JSONResponse(auxCostDTO(a)), nil
}

// UpdateAuxCost handles PATCH /admin/aux-costs/{id} (owner-only). Unknown id → 404.
func (s *Server) UpdateAuxCost(ctx context.Context, request api.UpdateAuxCostRequestObject) (api.UpdateAuxCostResponseObject, error) {
	if err := assertOwner(ctx); err != nil {
		return nil, err
	}
	if request.Body == nil {
		return api.UpdateAuxCost400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(envelope(codeValidation))}, nil
	}
	c, fields := cleanAuxCostInput(*request.Body)
	if len(fields) > 0 {
		return api.UpdateAuxCost400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(fieldEnvelope(fields))}, nil
	}
	a, err := db.NewCosting(s.pool).UpdateAuxCost(ctx, sqlc.UpdateAuxCostParams{
		ID: request.Id, Label: c.Label, Kind: c.Kind, AmountVnd: c.AmountVnd,
	})
	if err != nil {
		return nil, err // db.ErrNotFound → 404
	}
	return api.UpdateAuxCost200JSONResponse(auxCostDTO(a)), nil
}

// DeleteAuxCost handles DELETE /admin/aux-costs/{id} (owner-only). Unknown id → 404.
func (s *Server) DeleteAuxCost(ctx context.Context, request api.DeleteAuxCostRequestObject) (api.DeleteAuxCostResponseObject, error) {
	if err := assertOwner(ctx); err != nil {
		return nil, err
	}
	if err := db.NewCosting(s.pool).DeleteAuxCost(ctx, request.Id); err != nil {
		return nil, err // db.ErrNotFound → 404
	}
	return api.DeleteAuxCost204Response{}, nil
}

// ── Scrap ─────────────────────────────────────────────────────────────────────────────────────────────

// ScrapFilament handles POST /admin/filament-materials/{id}/scrap (owner-only, ADR-039 hao-hụt tab). It draws
// qty of the material FIFO via the SAME deduct helper as print (Filament.Decrement, kind='scrap') so scrap
// moves stock and writes the shared filament_consumption ledger the 30-day waste factor reads (4c-2). The draw
// runs in a tx (Decrement's FOR UPDATE lock must hold across its multi-statement decrement). An unknown
// material → 404 (checked before the draw, since a draw against no lots would silently no-op). A shortfall
// clamps (never errors). Returns the material with updated stock + its lots.
func (s *Server) ScrapFilament(ctx context.Context, request api.ScrapFilamentRequestObject) (api.ScrapFilamentResponseObject, error) {
	if err := assertOwner(ctx); err != nil {
		return nil, err
	}
	if request.Body == nil {
		return api.ScrapFilament400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(envelope(codeValidation))}, nil
	}
	qty, reason, note, fields := cleanScrapInput(*request.Body)
	if len(fields) > 0 {
		return api.ScrapFilament400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(fieldEnvelope(fields))}, nil
	}
	var detail api.FilamentMaterialDetail
	err := withTx(ctx, s.pool, func(tx pgx.Tx) error {
		fil := db.NewFilament(tx)
		if _, err := fil.GetMaterial(ctx, request.Id); err != nil {
			return err // db.ErrNotFound → 404 (a draw against an unknown material would otherwise no-op silently)
		}
		if _, err := fil.Decrement(ctx, db.DecrementInput{
			MaterialID: request.Id, Qty: qty, Kind: db.FilamentKindScrap, Reason: reason, Note: note,
		}); err != nil {
			return err
		}
		m, err := fil.GetMaterial(ctx, request.Id)
		if err != nil {
			return err
		}
		batches, err := fil.ListBatches(ctx, request.Id)
		if err != nil {
			return err
		}
		detail = filamentDetailDTO(filamentGetDTO(m), batches)
		return nil
	})
	if err != nil {
		return nil, err // db.ErrNotFound → 404; any other fault → 500
	}
	return api.ScrapFilament200JSONResponse(detail), nil
}

// ── clean + DTO ───────────────────────────────────────────────────────────────────────────────────────

type cleanedMachine struct {
	Name                  string
	PurchasePriceVnd      int64
	DepreciationMonths    int32
	ExpectedHoursPerMonth int32
	IsPrimary             bool
	Active                bool
}

// cleanMachineInput trims + validates a machine body: name non-empty within cap; purchasePriceVnd ≥ 0;
// depreciationMonths / expectedHoursPerMonth > 0 (also the ₫/hour divisor — the bounds double as overflow
// guards); isPrimary defaults false, active defaults true.
func cleanMachineInput(in api.MachineInput) (cleanedMachine, map[string]string) {
	fields := map[string]string{}
	name := strings.TrimSpace(in.Name)
	if name == "" || utf8.RuneCountInString(name) > maxMachineNameChars {
		fields["name"] = msgKey(codeValidation)
	}
	if in.PurchasePriceVnd < 0 || in.PurchasePriceVnd > maxMachinePriceVnd {
		fields["purchasePriceVnd"] = msgKey(codeValidation)
	}
	if in.DepreciationMonths <= 0 || in.DepreciationMonths > maxDepreciationMonths {
		fields["depreciationMonths"] = msgKey(codeValidation)
	}
	if in.ExpectedHoursPerMonth <= 0 || in.ExpectedHoursPerMonth > maxHoursPerMonth {
		fields["expectedHoursPerMonth"] = msgKey(codeValidation)
	}
	if len(fields) > 0 {
		return cleanedMachine{}, fields
	}
	isPrimary := false
	if in.IsPrimary != nil {
		isPrimary = *in.IsPrimary
	}
	active := true
	if in.Active != nil {
		active = *in.Active
	}
	return cleanedMachine{
		Name:                  name,
		PurchasePriceVnd:      in.PurchasePriceVnd,
		DepreciationMonths:    int32(in.DepreciationMonths),
		ExpectedHoursPerMonth: int32(in.ExpectedHoursPerMonth),
		IsPrimary:             isPrimary,
		Active:                active,
	}, nil
}

type cleanedAux struct {
	Label     string
	Kind      string
	AmountVnd int64
}

// cleanAuxCostInput trims + validates an aux-cost body: label non-empty within cap; kind ∈ {per_order,
// per_month}; amountVnd ≥ 0.
func cleanAuxCostInput(in api.AuxCostInput) (cleanedAux, map[string]string) {
	fields := map[string]string{}
	label := strings.TrimSpace(in.Label)
	if label == "" || utf8.RuneCountInString(label) > maxAuxLabelChars {
		fields["label"] = msgKey(codeValidation)
	}
	if _, ok := auxCostKinds[in.Kind]; !ok {
		fields["kind"] = msgKey(codeValidation)
	}
	if in.AmountVnd < 0 {
		fields["amountVnd"] = msgKey(codeValidation)
	}
	if len(fields) > 0 {
		return cleanedAux{}, fields
	}
	return cleanedAux{Label: label, Kind: in.Kind, AmountVnd: in.AmountVnd}, nil
}

// cleanScrapInput validates a scrap body: qty in (0, maxScrapQty]; reason/note within caps (optional).
func cleanScrapInput(in api.FilamentScrapInput) (qty int64, reason, note string, fields map[string]string) {
	fields = map[string]string{}
	qty = in.Qty
	if qty <= 0 || qty > maxScrapQty {
		fields["qty"] = msgKey(codeValidation)
	}
	if in.Reason != nil {
		reason = strings.TrimSpace(*in.Reason)
		if utf8.RuneCountInString(reason) > maxScrapReasonChars {
			fields["reason"] = msgKey(codeValidation)
		}
	}
	if in.Note != nil {
		note = strings.TrimSpace(*in.Note)
		if utf8.RuneCountInString(note) > maxScrapNoteChars {
			fields["note"] = msgKey(codeValidation)
		}
	}
	if len(fields) > 0 {
		return 0, "", "", fields
	}
	return qty, reason, note, nil
}

// machineDTO maps a machine row to the wire shape, deriving ₫/hour = purchasePriceVnd /
// (depreciationMonths × expectedHoursPerMonth). The CHECKs (both > 0) make the divisor safe; the multiply is
// in int64 so it can't overflow. costPerHour is a display RATE (float), never stored money (ADR-039 pt 8).
func machineDTO(m sqlc.Machine) api.Machine {
	return api.Machine{
		Id:                    m.ID,
		Name:                  m.Name,
		PurchasePriceVnd:      m.PurchasePriceVnd,
		DepreciationMonths:    int(m.DepreciationMonths),
		ExpectedHoursPerMonth: int(m.ExpectedHoursPerMonth),
		IsPrimary:             m.IsPrimary,
		Active:                m.Active,
		CostPerHour:           float64(m.PurchasePriceVnd) / float64(int64(m.DepreciationMonths)*int64(m.ExpectedHoursPerMonth)),
	}
}

func machinesDTO(rows []sqlc.Machine) []api.Machine {
	out := make([]api.Machine, len(rows))
	for i, m := range rows {
		out[i] = machineDTO(m)
	}
	return out
}

func auxCostDTO(a sqlc.AuxCost) api.AuxCost {
	return api.AuxCost{Id: a.ID, Label: a.Label, Kind: a.Kind, AmountVnd: a.AmountVnd}
}

func auxCostsDTO(rows []sqlc.AuxCost) []api.AuxCost {
	out := make([]api.AuxCost, len(rows))
	for i, a := range rows {
		out[i] = auxCostDTO(a)
	}
	return out
}
