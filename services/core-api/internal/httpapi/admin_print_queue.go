package httpapi

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/order"
)

// printStages is the set of valid print_stage values — the runtime membership check for the stage PATCH.
// oapi-codegen binds the PrintStage Go type but does NOT verify that a decoded value is a real enum
// member (the same gap the orders list's status filter guards), so a bad token must be rejected here,
// before the DB write where the ::print_stage cast would otherwise surface as a 500. Sourced from the
// sqlc constants so it cannot drift from the Postgres enum.
var printStages = map[sqlc.PrintStage]bool{
	sqlc.PrintStageNEEDPRINT: true,
	sqlc.PrintStagePRINTING:  true,
	sqlc.PrintStageNFCENCODE: true, // "Ghi chip NFC" (P3-t t-2) — routed only to nfc_tag cards by the board
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
	cards, err := printQueueDTO(rows)
	if err != nil {
		return nil, err // malformed part_colors jsonb (never written by the capture seam) → 500, logged
	}
	return api.GetPrintQueue200JSONResponse(cards), nil
}

// AdvancePrintJobStage handles PATCH /admin/print-jobs/{id} (P3-f): the staff drag-drop between kanban
// columns. It is authRequired (owner AND staff). It moves the print stage — the print queue stays STORED,
// staff-driven and finer-grained than order status (D6) — and, as of ADR-057, ALSO auto-advances the
// order PAID→PRINTING once every line has left NEED_PRINT (see the in-tx block below). Every other
// OrderStatus edge is UNCHANGED by D6: →SHIPPING (QC-photo/tracking gate), →CANCELLED, →REFUNDED still only
// happen through POST /orders/{id}/transitions, which a board drag must never bypass. A missing body or a
// stage outside the enum → 400 (before the write); an unknown job id → 404.
//
// A move to PRINTING also DRAWS FILAMENT (ADR-039 deduct-on-print): an atomic claim (ClaimPrintForPrinting)
// stamps filament_deducted_at so only the FIRST →PRINTING draws — a re-drag or concurrent second mover just
// re-lands the stage. The claim + draw run in ONE tx (withTx), so they commit atomically; a costing/DB fault
// rolls the whole move back (retryable), while a stock shortfall clamps + logs and never blocks the board.
// On success it re-reads the enriched card (in-tx) so the response matches the board list shape, then pushes
// it to open boards post-commit.
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

	var card api.PrintQueueJob
	var snapshotItemID *uuid.UUID // set when THIS call drew filament → its COGS is rolled up post-commit (4c-2)
	err := withTx(ctx, s.pool, func(tx pgx.Tx) error {
		jobs := db.NewJobs(tx)
		if stage == sqlc.PrintStagePRINTING {
			// Atomic deduct-on-print claim: only the FIRST →PRINTING draws filament (ADR-039 pt 4).
			job, claimedNow, err := jobs.ClaimPrintForPrinting(ctx, request.Id)
			if err != nil {
				return err // ErrNotFound → 404
			}
			if claimedNow {
				if err := s.deductFilamentForPrint(ctx, tx, job.OrderItemID); err != nil {
					return err // rolls back the claim too → retryable, no half-draw
				}
				itemID := job.OrderItemID
				snapshotItemID = &itemID // freeze the full COGS post-commit (filament is now frozen in-tx)
			}
		} else if _, err := jobs.AdvancePrintStage(ctx, request.Id, stage); err != nil {
			return err // ErrNotFound → 404
		}
		// Re-read the enriched card WITHIN the tx so the mutate response matches the board list shape.
		row, err := jobs.PrintQueueEntry(ctx, request.Id)
		if err != nil {
			return err
		}
		card, err = printQueueEntryDTO(row)
		if err != nil {
			return err // malformed part_colors jsonb (never written by the capture seam) → 500, logged
		}
		// Auto-advance PAID→PRINTING (ADR-057): once every line of the order has left NEED_PRINT, the
		// order no longer needs a SEPARATE manual click on the orders page — this is the ONE edge D6's
		// "print stage and order status move independently" narrows, because a solo shop moving cards on
		// the board is the actual source of the drift ("moved every item to Đang in, order still says Đã
		// thanh toán"), not a reason to keep two clicks. Every other edge (→SHIPPING's QC-photo/tracking
		// gate, →CANCELLED, →REFUNDED) still goes through POST /orders/{id}/transitions untouched.
		// Idempotent: if the order is already past PAID (or not PAID at all — e.g. cancelled), the guard
		// rejects the edge and that's a silent no-op, not a failure of the print-stage move itself.
		remaining, err := jobs.CountNeedPrintForOrder(ctx, row.OrderID)
		if err != nil {
			return err
		}
		if remaining == 0 {
			actor, ok := actorFrom(ctx)
			if ok {
				tctx := order.TransitionContext{
					Role:   actor.Role,
					ByUser: actor.ByUser,
					At:     actor.At.UTC().Format(time.RFC3339Nano),
					Reason: "auto_print_stage",
				}
				if _, aerr := db.AdvanceStatusTx(ctx, tx, row.OrderID, order.Printing, tctx); aerr != nil {
					var terr *order.TransitionError
					if !errors.As(aerr, &terr) || terr.Code != order.ErrInvalidEdge {
						return aerr // a real DB fault — roll back with the rest of the move
					}
					// InvalidEdge means the order simply isn't PAID right now (already PRINTING+, or
					// cancelled) — expected and not an error for the print-stage move itself.
				}
			}
		}
		return nil
	})
	if err != nil {
		return nil, err // ErrNotFound → 404; any other db fault → 500 (mapError, no leak)
	}
	// Push the advanced card to every open board (P3-g SSE). Post-commit — the tx is committed — so this is
	// publish-on-commit (ADR-006 spirit); non-blocking and best-effort (a missed frame self-heals via the
	// client's re-read/poll), so it never affects the PATCH's own 200 response.
	s.printHub.broadcast(card)
	// COGS snapshot rollup (ADR-039 pt 5, 4c-2): only when THIS call drew filament (first →PRINTING). Runs
	// BEST-EFFORT post-commit off the committed filament cost — a fault just leaves cost_snapshot NULL
	// ("chưa chốt", backfillable), never failing the move or blocking the board (costing NEVER cascades onto
	// a paid order). Same spirit as the broadcast above.
	if snapshotItemID != nil {
		if err := db.NewCosting(s.pool).SnapshotOrderItem(ctx, *snapshotItemID); err != nil {
			s.logger.Warn("cost snapshot rollup failed (cost_snapshot left NULL, backfillable)",
				"orderItem", *snapshotItemID, "err", err)
		}
	}
	return api.AdvancePrintJobStage200JSONResponse(card), nil
}

// printQueueDTO maps the enriched board rows to wire cards. Split from the I/O (pure) so the row→DTO slot
// wiring is pinned by a Docker-free unit test. Money is not involved (a print card carries no amount). A
// nil/empty result yields a non-nil empty slice so the JSON renders `[]`, not `null` (spec §03 zero-state).
// Returns an error only if a row's part_colors jsonb is malformed (never written by the capture seam).
func printQueueDTO(rows []sqlc.ListPrintQueueRow) ([]api.PrintQueueJob, error) {
	out := make([]api.PrintQueueJob, len(rows))
	for i, r := range rows {
		labels, err := printQueuePartLabels(r.PartColors)
		if err != nil {
			return nil, fmt.Errorf("print job %s: part_colors: %w", r.ID, err)
		}
		choiceLabels, err := printQueueOptionChoiceLabels(r.OptionChoices)
		if err != nil {
			return nil, fmt.Errorf("print job %s: option_choices: %w", r.ID, err)
		}
		dto := api.PrintQueueJob{
			Id:                 r.ID,
			Stage:              api.PrintStage(r.Stage),
			ProductType:        api.ProductType(r.ProductType), // routes nfc_tag cards through NFC_ENCODE (t-2)
			OrderCode:          r.OrderCode,
			ProductName:        r.ProductName,
			Quantity:           int(r.Quantity),
			ColorName:          r.ColorName, // *string, omitempty when the line has no color
			PartColorLabels:    labels,      // *[]string, omitempty for a flat line (ADR-037)
			Printer:            r.Printer,   // *string, omitempty when no printer assigned
			OptionChoiceLabels: choiceLabels,
			OrderNote:          r.OrderNote,
		}
		if r.Personalization != nil {
			dto.Personalization = &api.Personalization{Text: r.Personalization.Text, ZoneId: r.Personalization.ZoneID}
		}
		if r.Eta.Valid {
			t := r.Eta.Time
			dto.Eta = &t
		}
		out[i] = dto
	}
	return out, nil
}

// printQueueEntryDTO maps the single re-read card (GetPrintQueueEntry — a distinct sqlc row type with the
// SAME fields as the list row) to the identical wire card printQueueDTO produces per board row.
func printQueueEntryDTO(r sqlc.GetPrintQueueEntryRow) (api.PrintQueueJob, error) {
	labels, err := printQueuePartLabels(r.PartColors)
	if err != nil {
		return api.PrintQueueJob{}, fmt.Errorf("print job %s: part_colors: %w", r.ID, err)
	}
	choiceLabels, err := printQueueOptionChoiceLabels(r.OptionChoices)
	if err != nil {
		return api.PrintQueueJob{}, fmt.Errorf("print job %s: option_choices: %w", r.ID, err)
	}
	dto := api.PrintQueueJob{
		Id:                 r.ID,
		Stage:              api.PrintStage(r.Stage),
		ProductType:        api.ProductType(r.ProductType),
		OrderCode:          r.OrderCode,
		ProductName:        r.ProductName,
		Quantity:           int(r.Quantity),
		ColorName:          r.ColorName,
		PartColorLabels:    labels,
		Printer:            r.Printer,
		OptionChoiceLabels: choiceLabels,
		OrderNote:          r.OrderNote,
	}
	if r.Personalization != nil {
		dto.Personalization = &api.Personalization{Text: r.Personalization.Text, ZoneId: r.Personalization.ZoneID}
	}
	if r.Eta.Valid {
		t := r.Eta.Time
		dto.Eta = &t
	}
	return dto, nil
}

// printQueuePartLabels parses the joined oi.part_colors jsonb into the per-part colour labels a card shows
// for a parts product (ADR-037: "Chao: Đỏ") — nil (field omitted) for a flat line. Reuses the order-detail
// parse/format (partColorSnapshots / partColorLabel) so a print card and the order detail can never render
// the same order's colours differently.
func printQueuePartLabels(raw []byte) (*[]string, error) {
	snap, err := partColorSnapshots(raw)
	if err != nil {
		return nil, err
	}
	if len(snap) == 0 {
		return nil, nil
	}
	labels := make([]string, len(snap))
	for i, s := range snap {
		labels[i] = partColorLabel(s)
	}
	return &labels, nil
}

// printQueueOptionChoiceLabels parses the joined oi.option_choices jsonb into display labels ("Kích
// thước: Lớn") — nil (field omitted) when the line has none. Reuses the same parse/format the order
// detail uses (optionChoiceSnapshots / optionChoiceLabel) so a print card never drifts from the detail.
func printQueueOptionChoiceLabels(raw []byte) (*[]string, error) {
	snap, err := optionChoiceSnapshots(raw)
	if err != nil {
		return nil, err
	}
	if len(snap) == 0 {
		return nil, nil
	}
	labels := make([]string, len(snap))
	for i, s := range snap {
		labels[i] = optionChoiceLabel(s)
	}
	return &labels, nil
}
