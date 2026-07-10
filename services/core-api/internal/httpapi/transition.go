package httpapi

import (
	"context"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/order"
)

// TransitionOrder handles POST /orders/{id}/transitions (PR-3h): one RBAC-gated status change on
// an existing order. The endpoint is authRequired (classify) so the auth middleware guarantees a
// resolved Actor in context; the handler NEVER reads role/byUser/at from the body — they come from
// the authenticated actor + the server clock (always-must #1). It routes each edge to the correct
// db seam and maps every domain error via the ADR-032 table (handleResponseError).
//
// DISPATCH FOOTGUN (locked decision #9): the money-in reconcile PENDING_CONFIRM→PAID goes through
// db.ConfirmPaymentTx — the ONLY seam that emits `order.paid`. Every other edge goes through
// db.AdvanceStatusTx (which emits no event). Routing a →PAID through AdvanceStatusTx would flip the
// state but never tell the relay/consumers payment landed; routing a non-money edge through
// ConfirmPaymentTx would emit a spurious order.paid. The `to` value picks the seam, once, here.
//
// OWNER-ONLY RECONCILE (money-in boundary): ConfirmPaymentTx fixes the transition role to owner
// internally, so the domain guard cannot reject a staff caller on that edge — the owner check MUST
// happen at this boundary. The money-OUT edges (→REFUNDED) instead flow through AdvanceStatusTx
// with the actor's real role, so order.RoleAllowed rejects a staff caller there (defense stays in
// the domain guard). Both money paths are thus owner-gated, just at different layers.
func (s *Server) TransitionOrder(ctx context.Context, req api.TransitionOrderRequestObject) (api.TransitionOrderResponseObject, error) {
	if req.Body == nil {
		// A decode failure is already caught by the strict RequestErrorHandlerFunc; this covers a
		// nil body reaching the handler (mirrors auth.go).
		return api.TransitionOrder400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(envelope(codeValidation))}, nil
	}
	actor, ok := actorFrom(ctx)
	if !ok {
		// authRequired should guarantee an actor; fail closed if the wiring ever regresses.
		return nil, errUnauthenticated
	}

	to := order.Status(req.Body.To)
	tctx := order.TransitionContext{
		Role:           actor.Role,
		ByUser:         actor.ByUser,
		At:             actor.At.UTC().Format(time.RFC3339Nano),
		Reason:         deref(req.Body.Reason),
		RefundProofURL: deref(req.Body.RefundProofUrl),
	}

	// SHIPPING requires BOTH a non-empty tracking code AND a QC packing photo (spec §04, D-P3-6).
	// Validate at the boundary before the tx — these are HTTP-edge shipping artifacts, not state
	// semantics, so they live here (as the trackingCode half always has), mirroring how the domain
	// guard enforces reason/refundProofUrl for the close states. The QC URL gets the SAME http/https
	// shape check the domain guard applies to refundProofUrl (order.IsHTTPURL — covers empty AND
	// malformed): both persist as admin-rendered links, so a non-http (e.g. javascript:) value must
	// never land. The tracking code is a free carrier string, so it stays a plain non-empty check.
	trackingCode := strings.TrimSpace(deref(req.Body.TrackingCode))
	qcPhotoURL := strings.TrimSpace(deref(req.Body.QcPhotoUrl))
	if to == order.Shipping {
		if trackingCode == "" {
			return nil, errTrackingCodeRequired
		}
		if !order.IsHTTPURL(qcPhotoURL) {
			return nil, errQcPhotoRequired
		}
	}

	// Money-in is owner-only and ConfirmPaymentTx won't self-reject a staff caller — gate it here.
	if to == order.Paid && actor.Role != order.RoleOwner {
		return nil, errForbidden
	}

	var row sqlc.Order
	err := withTx(ctx, s.pool, func(tx pgx.Tx) error {
		var e error
		switch to {
		case order.Paid:
			// Money-in reconcile → the only order.paid emitter.
			row, e = db.ConfirmPaymentTx(ctx, tx, db.ConfirmPaymentInput{
				OrderID: req.Id, ByUser: actor.ByUser, At: tctx.At,
			})
		case order.Shipping:
			// Flip PRINTING→SHIPPING through the guard, then persist the tracking code + QC photo in
			// the SAME tx so the status and its mandatory artifacts commit atomically (§6 D12, D-P3-6).
			if row, e = db.AdvanceStatusTx(ctx, tx, req.Id, to, tctx); e != nil {
				return e
			}
			row, e = db.SetShippingArtifactsTx(ctx, tx, req.Id, trackingCode, qcPhotoURL)
		default:
			row, e = db.AdvanceStatusTx(ctx, tx, req.Id, to, tctx)
		}
		return e
	})
	if err != nil {
		return nil, err // domain/db error → mapError (handleResponseError)
	}

	dto, err := assembleOrderDTO(ctx, s.pool, row)
	if err != nil {
		return nil, err
	}
	return api.TransitionOrder200JSONResponse(dto), nil
}

// deref returns the pointed-to string, or "" for a nil pointer (an omitted optional field).
func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
