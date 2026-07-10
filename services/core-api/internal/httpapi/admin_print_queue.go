package httpapi

import (
	"context"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
)

// printStages is the set of valid print_stage values — the runtime membership check for the stage PATCH.
// oapi-codegen binds the PrintStage Go type but does NOT verify that a decoded value is a real enum
// member (the same gap the orders list's status filter guards), so a bad token must be rejected here,
// before the DB write where the ::print_stage cast would otherwise surface as a 500. Sourced from the
// sqlc constants so it cannot drift from the Postgres enum.
var printStages = map[sqlc.PrintStage]bool{
	sqlc.PrintStageNEEDPRINT: true,
	sqlc.PrintStagePRINTING:  true,
	sqlc.PrintStagePACKING:   true,
	sqlc.PrintStageSHIPPED:   true,
}

// GetPrintQueue handles GET /admin/print-queue (P3-f): the whole print board. It is authRequired (classify
// default — owner AND staff; the print queue is fulfillment work, not a money-out edge), so the auth
// middleware guarantees a resolved actor in context; the read itself is actor-independent. It returns every
// print job across all four stages as an enriched card (order code + product name + quantity + optional
// color/printer/eta), ordered by stage then age; the client groups the flat list into the kanban columns
// and derives per-column counts. r.Context() propagates into the read so a client disconnect cancels it.
func (s *Server) GetPrintQueue(ctx context.Context, _ api.GetPrintQueueRequestObject) (api.GetPrintQueueResponseObject, error) {
	rows, err := db.NewJobs(s.pool).PrintQueue(ctx)
	if err != nil {
		return nil, err // db error → mapError → 500, no leak
	}
	return api.GetPrintQueue200JSONResponse(printQueueDTO(rows)), nil
}

// AdvancePrintJobStage handles PATCH /admin/print-jobs/{id} (P3-f): the staff drag-drop between kanban
// columns. It is authRequired (owner AND staff). It moves ONLY the print stage — it does NOT transition the
// customer's OrderStatus. The print queue is STORED, staff-driven and finer-grained than order status,
// advanced INDEPENDENTLY of it (D6); an OrderStatus change goes through POST /orders/{id}/transitions,
// which enforces the RBAC + statusHistory + →SHIPPING QC-photo/tracking gate (P3-e) that a board drag must
// never bypass. A missing body or a stage outside the enum → 400 (before the write); an unknown job id →
// 404. On success it re-reads the enriched card so the mutate response carries the same shape as the list.
func (s *Server) AdvancePrintJobStage(ctx context.Context, request api.AdvancePrintJobStageRequestObject) (api.AdvancePrintJobStageResponseObject, error) {
	badRequest := api.AdvancePrintJobStage400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(envelope(codeValidation))}
	if request.Body == nil {
		return badRequest, nil
	}
	stage := sqlc.PrintStage(request.Body.Stage)
	if !printStages[stage] {
		// A stage value outside the print_stage enum — reject with 400 rather than pass it to the UPDATE
		// (the ::print_stage cast would then 500). Mirrors the orders list's status-filter validation.
		return badRequest, nil
	}

	jobs := db.NewJobs(s.pool)
	if _, err := jobs.AdvancePrintStage(ctx, request.Id, stage); err != nil {
		return nil, err // ErrNotFound → 404; any other db fault → 500 (mapError, no leak)
	}
	// Re-read the enriched card so the mutate response matches the board list shape. The job exists
	// (AdvancePrintStage just updated it); a not-found here would be a concurrent delete → an honest 404.
	row, err := jobs.PrintQueueEntry(ctx, request.Id)
	if err != nil {
		return nil, err
	}
	card := printQueueEntryDTO(row)
	// Push the advanced card to every open board (P3-g SSE). Post-commit — AdvancePrintStage's UPDATE
	// is committed and PrintQueueEntry read it back — so this is publish-on-commit (ADR-006 spirit); it
	// is non-blocking and best-effort (a missed frame self-heals via the client's re-read/poll), so it
	// never affects the PATCH's own 200 response.
	s.printHub.broadcast(card)
	return api.AdvancePrintJobStage200JSONResponse(card), nil
}

// printQueueDTO maps the enriched board rows to wire cards. Split from the I/O (pure) so the row→DTO slot
// wiring is pinned by a Docker-free unit test. Money is not involved (a print card carries no amount). A
// nil/empty result yields a non-nil empty slice so the JSON renders `[]`, not `null` (spec §03 zero-state).
func printQueueDTO(rows []sqlc.ListPrintQueueRow) []api.PrintQueueJob {
	out := make([]api.PrintQueueJob, len(rows))
	for i, r := range rows {
		dto := api.PrintQueueJob{
			Id:          r.ID,
			Stage:       api.PrintStage(r.Stage),
			OrderCode:   r.OrderCode,
			ProductName: r.ProductName,
			Quantity:    int(r.Quantity),
			ColorName:   r.ColorName, // *string, omitempty when the line has no color
			Printer:     r.Printer,   // *string, omitempty when no printer assigned
		}
		if r.Eta.Valid {
			t := r.Eta.Time
			dto.Eta = &t
		}
		out[i] = dto
	}
	return out
}

// printQueueEntryDTO maps the single re-read card (GetPrintQueueEntry — a distinct sqlc row type with the
// SAME fields as the list row) to the identical wire card printQueueDTO produces per board row.
func printQueueEntryDTO(r sqlc.GetPrintQueueEntryRow) api.PrintQueueJob {
	dto := api.PrintQueueJob{
		Id:          r.ID,
		Stage:       api.PrintStage(r.Stage),
		OrderCode:   r.OrderCode,
		ProductName: r.ProductName,
		Quantity:    int(r.Quantity),
		ColorName:   r.ColorName,
		Printer:     r.Printer,
	}
	if r.Eta.Valid {
		t := r.Eta.Time
		dto.Eta = &t
	}
	return dto
}
