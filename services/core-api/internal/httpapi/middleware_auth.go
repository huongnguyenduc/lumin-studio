package httpapi

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/google/uuid"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/auth"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/order"
)

// errUnauthenticated / errForbidden are the two auth-boundary sentinels. mapError renders
// them as a 401 UNAUTHORIZED / 403 FORBIDDEN ErrorEnvelope (ADR-032) — no message leaks which
// check failed. errUnauthenticated = no/invalid credential; errForbidden = valid credential,
// insufficient role.
var (
	errUnauthenticated = errors.New("httpapi: unauthenticated")
	errForbidden       = errors.New("httpapi: forbidden")
)

// authClass is how a single operation is gated at the boundary. The default (authRequired)
// is fail-closed: an operation added later with no explicit entry in classify below requires
// a valid actor rather than silently becoming public.
type authClass int

const (
	// authRequired needs a valid session actor; absent/invalid → 401. The DEFAULT.
	authRequired authClass = iota
	// authPublic needs no credential (login/logout — issuing or clearing a cookie can't
	// itself require one).
	authPublic
	// authOptional resolves the actor iff a cookie is present but never rejects when it is
	// absent — the public web POST /orders path, where §3g still gates channel=inbox on a
	// resolved staff/owner actor.
	authOptional
	// authOwnerOnly needs a valid actor whose role is owner (PATCH /admin/settings/bank-account,
	// the STK write — owner-only per conventions §Bảo mật / ADR-012). This is the requireOwner
	// boundary; transition RBAC (reconcile→PAID, →REFUNDED) stays in the domain guard.
	authOwnerOnly
)

// classify maps a generated operationID to its gate. Unlisted operations fall through to
// authRequired (fail-closed) — the security-critical default. Only endpoints deliberately
// public or optional are enumerated here; a reviewer adding an admin endpoint gets auth for
// free, and one adding a public endpoint must state it explicitly.
func classify(operationID string) authClass {
	switch operationID {
	case "LoginUser", "LogoutUser":
		return authPublic
	case "CreateOrder":
		return authOptional
	case "UpdateBankAccount":
		return authOwnerOnly
	default:
		// GetDashboard, ListReplyTemplates, GetSettings, TransitionOrder, + any new operation.
		return authRequired
	}
}

// authMiddleware is the StrictMiddlewareFunc wired into the strict-server handler (router.go).
// It runs for every operation, branches on classify(operationID), resolves the actor from the
// session cookie, and injects it into the context the downstream handler receives. It NEVER
// re-implements RBAC math: it authenticates + resolves the role and (for owner-only edges)
// checks it, then hands the actor to the handler, which passes it into the domain guard
// (order.RoleAllowed/Transition) — the domain stays the source of truth (defense in depth).
func (s *Server) authMiddleware(next api.StrictHandlerFunc, operationID string) api.StrictHandlerFunc {
	return func(ctx context.Context, w http.ResponseWriter, r *http.Request, request interface{}) (interface{}, error) {
		class := classify(operationID)
		if class == authPublic {
			return next(ctx, w, r, request)
		}

		actor, ok, err := s.resolveActor(ctx, r)
		if err != nil {
			// A cookie was present but unusable (bad signature/expired/unknown or deactivated
			// user), or a genuine DB fault. resolveActor already distinguished them: an auth
			// failure is errUnauthenticated (→401), a DB fault is the raw error (→500).
			return nil, err
		}
		if !ok {
			// No credential at all.
			if class == authOptional {
				return next(ctx, w, r, request)
			}
			return nil, errUnauthenticated
		}
		if class == authOwnerOnly && actor.Role != order.RoleOwner {
			return nil, errForbidden
		}
		return next(withActor(ctx, actor), w, r, request)
	}
}

// resolveActor reads the session cookie and turns it into an authoritative Actor. It returns
// (_, false, nil) when no cookie is present (anonymous — the optional path continues); an
// errUnauthenticated when a cookie is present but the token is invalid, its subject is not a
// user id, or the user is gone/deactivated; and a raw (non-sentinel) error only on a genuine
// DB fault (mapped to 500). The role comes from the users row, not the token claim, so a token
// minted before a role change or deactivation cannot outrank the current record.
func (s *Server) resolveActor(ctx context.Context, r *http.Request) (Actor, bool, error) {
	cookie, err := r.Cookie(auth.SessionCookieName)
	if err != nil || cookie.Value == "" {
		return Actor{}, false, nil
	}
	claims, err := s.auth.Verify(cookie.Value)
	if err != nil {
		return Actor{}, false, errUnauthenticated
	}
	id, err := uuid.Parse(claims.Subject)
	if err != nil {
		return Actor{}, false, errUnauthenticated
	}
	user, err := s.users.UserByID(ctx, id)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			return Actor{}, false, errUnauthenticated
		}
		return Actor{}, false, err
	}
	if !user.Active {
		return Actor{}, false, errUnauthenticated
	}
	role, err := actorRole(user.Role)
	if err != nil {
		// A user_role the domain layer doesn't accept should be impossible (PG enum is
		// owner|staff); fail closed rather than fabricate an actor.
		return Actor{}, false, errUnauthenticated
	}
	return Actor{ByUser: user.ID.String(), Role: role, At: time.Now().UTC()}, true, nil
}

// actorRole maps the stored user_role to a domain order.Role. It is explicit (not a raw cast)
// so the mapping can NEVER yield order.RoleSystem — `system` is a server-internal transition
// actor, never a login identity a session may carry.
func actorRole(r sqlc.UserRole) (order.Role, error) {
	switch r {
	case sqlc.UserRoleOwner:
		return order.RoleOwner, nil
	case sqlc.UserRoleStaff:
		return order.RoleStaff, nil
	default:
		return "", errUnauthenticated
	}
}
