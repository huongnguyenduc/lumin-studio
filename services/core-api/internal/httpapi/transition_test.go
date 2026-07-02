package httpapi

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/order"
)

// Docker-free unit tests for the TransitionOrder handler's BOUNDARY logic — the branches that
// return before touching the pool (owner-only reconcile gate, tracking-code requirement, missing
// actor, nil body). The DB-touching dispatch paths (footgun + atomic tracking persist) are covered
// by the integration tests (transition_integration_test.go, skip-local/run-CI).

// testServer builds a Server with a nil pool — safe for the pre-tx boundary branches only.
func testServer() *Server {
	return NewServer(slog.New(slog.NewTextHandler(io.Discard, nil)), nil, nil, nil)
}

// ctxWithActor injects a resolved actor as the auth middleware would.
func ctxWithActor(role order.Role) context.Context {
	return withActor(context.Background(), Actor{ByUser: uuid.NewString(), Role: role, At: time.Now().UTC()})
}

func transitionReq(to api.OrderStatus, tracking *string) api.TransitionOrderRequestObject {
	return api.TransitionOrderRequestObject{
		Id:   uuid.New(),
		Body: &api.TransitionRequest{To: to, TrackingCode: tracking},
	}
}

// A staff caller may NOT reconcile money-in (PENDING_CONFIRM→PAID): ConfirmPaymentTx fixes the
// role to owner and would not self-reject, so the owner check MUST fire at the boundary → 403.
func TestTransitionStaffReconcileForbidden(t *testing.T) {
	srv := testServer()
	_, err := srv.TransitionOrder(ctxWithActor(order.RoleStaff), transitionReq("PAID", nil))
	if !errors.Is(err, errForbidden) {
		t.Fatalf("staff reconcile err = %v, want errForbidden", err)
	}
	// Sanity: the ADR-032 mapping renders it as 403 FORBIDDEN.
	if status, env := mapError(err); status != 403 || env.Code != codeForbidden {
		t.Fatalf("mapError = %d/%s, want 403/%s", status, env.Code, codeForbidden)
	}
}

// SHIPPING with no tracking code is rejected at the boundary (spec §04) before any tx, as 422
// TRACKING_CODE_REQUIRED — whether the field is omitted or blank/whitespace.
func TestTransitionShippingRequiresTrackingCode(t *testing.T) {
	srv := testServer()
	blank := "   "
	for name, body := range map[string]*string{"omitted": nil, "blank": &blank} {
		t.Run(name, func(t *testing.T) {
			_, err := srv.TransitionOrder(ctxWithActor(order.RoleStaff), transitionReq("SHIPPING", body))
			if !errors.Is(err, errTrackingCodeRequired) {
				t.Fatalf("shipping without tracking err = %v, want errTrackingCodeRequired", err)
			}
			if status, env := mapError(err); status != 422 || env.Code != codeTrackingReqd {
				t.Fatalf("mapError = %d/%s, want 422/%s", status, env.Code, codeTrackingReqd)
			}
		})
	}
}

// An anonymous context (no actor) fails closed — the handler never trusts an unauthenticated
// request even though classify() should have gated it.
func TestTransitionMissingActorUnauthenticated(t *testing.T) {
	srv := testServer()
	_, err := srv.TransitionOrder(context.Background(), transitionReq("PRINTING", nil))
	if !errors.Is(err, errUnauthenticated) {
		t.Fatalf("no-actor err = %v, want errUnauthenticated", err)
	}
}

// A nil body reaching the handler returns a 400 VALIDATION envelope, not a panic.
func TestTransitionNilBodyReturns400(t *testing.T) {
	srv := testServer()
	resp, err := srv.TransitionOrder(ctxWithActor(order.RoleOwner), api.TransitionOrderRequestObject{Id: uuid.New()})
	if err != nil {
		t.Fatalf("nil body err = %v, want nil (typed 400 response)", err)
	}
	if _, ok := resp.(api.TransitionOrder400JSONResponse); !ok {
		t.Fatalf("nil body resp = %T, want TransitionOrder400JSONResponse", resp)
	}
}
