package httpapi

import (
	"context"
	"time"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/order"
)

// Actor is the authenticated principal resolved at the auth boundary (PR-3e-2) and injected
// into the request context. Domain handlers (3g/3h/3k) read it to build the domain
// TransitionContext instead of trusting anything in the request body.
//
// ByUser standardizes on the users.id string form — this is the value written into
// statusHistory.byUser, resolving the documented string-vs-uuid inconsistency between
// statusHistory.byUser (string) and setting_bank_audit.changed_by (uuid). Role is the
// authoritative role read from the users row (owner|staff — never system, which is a
// server-internal transition actor, not a login identity). At is the server clock captured
// once at the boundary so every db seam in the request stamps the same instant.
type Actor struct {
	ByUser string
	Role   order.Role
	At     time.Time
}

// actorCtxKey is the unexported context key for the resolved Actor. Unexported so only this
// package can set/read it — a handler can't be tricked into reading an actor some other layer
// planted under a guessable key.
type actorCtxKey struct{}

// withActor returns a child context carrying the resolved actor.
func withActor(ctx context.Context, a Actor) context.Context {
	return context.WithValue(ctx, actorCtxKey{}, a)
}

// actorFrom returns the actor injected by the auth middleware, or ok=false when the request
// is anonymous (the optional-auth path on public POST /orders leaves no actor). Handlers that
// require an actor must treat ok=false as unauthenticated.
func actorFrom(ctx context.Context) (Actor, bool) {
	a, ok := ctx.Value(actorCtxKey{}).(Actor)
	return a, ok
}
