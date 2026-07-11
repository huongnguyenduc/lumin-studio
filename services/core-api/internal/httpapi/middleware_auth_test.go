package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/auth"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/order"
)

// recordingNext is a strict handler that records the context it was called with, so a test can
// assert what actor (if any) the middleware injected. It returns a sentinel response.
type recordingNext struct {
	called bool
	actor  Actor
	hasAct bool
}

func (n *recordingNext) fn(ctx context.Context, _ http.ResponseWriter, _ *http.Request, _ interface{}) (interface{}, error) {
	n.called = true
	n.actor, n.hasAct = actorFrom(ctx)
	return "ok", nil
}

// authTestUser makes a user row with a fresh id and the given role/active flag.
func authTestUser(role sqlc.UserRole, active bool) sqlc.User {
	return sqlc.User{ID: uuid.New(), Name: "u", Email: "u@lumin.vn", Role: role, Active: active}
}

// callAuthMW drives srv.authMiddleware for operationID with an optional session cookie, and
// returns the recorder, the middleware result, the error, and the recording next.
func callAuthMW(srv *Server, operationID string, cookie *http.Cookie) (*recordingNext, interface{}, error) {
	next := &recordingNext{}
	mw := srv.authMiddleware(next.fn, operationID)
	req := httptest.NewRequest(http.MethodGet, "/admin/dashboard", nil)
	if cookie != nil {
		req.AddCookie(cookie)
	}
	rec := httptest.NewRecorder()
	resp, err := mw(context.Background(), rec, req, nil)
	return next, resp, err
}

// issueCookie mints a real session cookie for u via the server's own issuer.
func issueCookie(t *testing.T, srv *Server, u sqlc.User) *http.Cookie {
	t.Helper()
	c, err := srv.auth.Issue(u.ID.String(), string(u.Role), time.Now().UTC())
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	return c
}

// testAuthedRouter mounts srv exactly as NewRouter does — auth middleware plus both oapi error
// seams — so a test can drive a real authenticated request end to end.
func testAuthedRouter(srv *Server) http.Handler {
	strict := api.NewStrictHandlerWithOptions(srv, []api.StrictMiddlewareFunc{srv.authMiddleware}, api.StrictHTTPServerOptions{
		RequestErrorHandlerFunc:  srv.handleRequestError,
		ResponseErrorHandlerFunc: srv.handleResponseError,
	})
	return api.HandlerWithOptions(strict, api.ChiServerOptions{
		BaseRouter:       chi.NewRouter(),
		ErrorHandlerFunc: srv.handleRequestError,
	})
}

func serverWithUsers(users userReader) *Server {
	return &Server{
		logger:   slog.New(slog.NewTextHandler(io.Discard, nil)),
		users:    users,
		auth:     auth.NewIssuer("test-secret", time.Hour, true, auth.SessionCookieName),
		printHub: newPrintStreamHub(),
	}
}

func TestAuthMiddlewareRequiredRejectsMissingCookie(t *testing.T) {
	srv := serverWithUsers(fakeUsers{})
	next, _, err := callAuthMW(srv, "GetDashboard", nil)
	if !errors.Is(err, errUnauthenticated) {
		t.Fatalf("want errUnauthenticated, got %v", err)
	}
	if next.called {
		t.Fatal("handler must not run for an unauthenticated required route")
	}
}

func TestAuthMiddlewareRequiredInjectsActorFromValidCookie(t *testing.T) {
	u := authTestUser(sqlc.UserRoleOwner, true)
	srv := serverWithUsers(fakeUsers{byID: map[uuid.UUID]sqlc.User{u.ID: u}})
	next, _, err := callAuthMW(srv, "GetDashboard", issueCookie(t, srv, u))
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if !next.called || !next.hasAct {
		t.Fatalf("handler must run with an injected actor (called=%v hasAct=%v)", next.called, next.hasAct)
	}
	if next.actor.ByUser != u.ID.String() {
		t.Errorf("ByUser = %q, want %q", next.actor.ByUser, u.ID.String())
	}
	if next.actor.Role != order.RoleOwner {
		t.Errorf("Role = %q, want owner", next.actor.Role)
	}
	if next.actor.At.IsZero() {
		t.Error("actor.At must be stamped with the server clock")
	}
}

func TestAuthMiddlewareRejectsTamperedToken(t *testing.T) {
	u := authTestUser(sqlc.UserRoleOwner, true)
	srv := serverWithUsers(fakeUsers{byID: map[uuid.UUID]sqlc.User{u.ID: u}})
	c := issueCookie(t, srv, u)
	c.Value += "x" // break the signature
	next, _, err := callAuthMW(srv, "GetDashboard", c)
	if !errors.Is(err, errUnauthenticated) {
		t.Fatalf("want errUnauthenticated for tampered token, got %v", err)
	}
	if next.called {
		t.Fatal("handler must not run for a tampered token")
	}
}

func TestAuthMiddlewareRejectsTokenForUnknownUser(t *testing.T) {
	u := authTestUser(sqlc.UserRoleOwner, true)
	// Issue a valid token, but the user is absent from the store (deleted since mint).
	srv := serverWithUsers(fakeUsers{byID: map[uuid.UUID]sqlc.User{}})
	next, _, err := callAuthMW(srv, "GetDashboard", issueCookie(t, srv, u))
	if !errors.Is(err, errUnauthenticated) {
		t.Fatalf("want errUnauthenticated for unknown user, got %v", err)
	}
	if next.called {
		t.Fatal("handler must not run for a token whose user is gone")
	}
}

func TestAuthMiddlewareRejectsInactiveUser(t *testing.T) {
	u := authTestUser(sqlc.UserRoleOwner, false) // deactivated
	srv := serverWithUsers(fakeUsers{byID: map[uuid.UUID]sqlc.User{u.ID: u}})
	next, _, err := callAuthMW(srv, "GetDashboard", issueCookie(t, srv, u))
	if !errors.Is(err, errUnauthenticated) {
		t.Fatalf("want errUnauthenticated for inactive user, got %v", err)
	}
	if next.called {
		t.Fatal("handler must not run for a deactivated user")
	}
}

func TestAuthMiddlewareDBFaultPropagatesAs500(t *testing.T) {
	u := authTestUser(sqlc.UserRoleOwner, true)
	// byID nil → UserByID falls back to err (a genuine DB fault, NOT a not-found sentinel).
	srv := serverWithUsers(fakeUsers{err: errors.New("connection reset by peer")})
	next, _, err := callAuthMW(srv, "GetDashboard", issueCookie(t, srv, u))
	if err == nil || errors.Is(err, errUnauthenticated) {
		t.Fatalf("a DB fault must propagate as a raw (non-auth) error, got %v", err)
	}
	if status, _ := mapError(err); status != http.StatusInternalServerError {
		t.Errorf("DB fault status = %d, want 500", status)
	}
	if next.called {
		t.Fatal("handler must not run when actor resolution faults")
	}
}

func TestAuthMiddlewarePublicSkipsAuth(t *testing.T) {
	srv := serverWithUsers(fakeUsers{})
	for _, op := range []string{"LoginUser", "LogoutUser"} {
		next, _, err := callAuthMW(srv, op, nil)
		if err != nil {
			t.Fatalf("%s: public route must not require auth, got %v", op, err)
		}
		if !next.called {
			t.Fatalf("%s: public route must reach the handler", op)
		}
		if next.hasAct {
			t.Errorf("%s: public route with no cookie must inject no actor", op)
		}
	}
}

func TestAuthMiddlewareOptionalProceedsWithoutCookie(t *testing.T) {
	srv := serverWithUsers(fakeUsers{})
	next, _, err := callAuthMW(srv, "CreateOrder", nil)
	if err != nil {
		t.Fatalf("optional-auth must not reject an anonymous request, got %v", err)
	}
	if !next.called {
		t.Fatal("optional-auth must reach the handler when no cookie is present")
	}
	if next.hasAct {
		t.Error("optional-auth with no cookie must leave no actor in context")
	}
}

func TestAuthMiddlewareOptionalInjectsActorWhenPresent(t *testing.T) {
	u := authTestUser(sqlc.UserRoleStaff, true)
	srv := serverWithUsers(fakeUsers{byID: map[uuid.UUID]sqlc.User{u.ID: u}})
	next, _, err := callAuthMW(srv, "CreateOrder", issueCookie(t, srv, u))
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if !next.hasAct || next.actor.Role != order.RoleStaff {
		t.Fatalf("optional-auth must resolve the staff actor when the cookie is present (hasAct=%v role=%q)", next.hasAct, next.actor.Role)
	}
}

func TestAuthMiddlewareOptionalRejectsInvalidCookie(t *testing.T) {
	// A present-but-broken cookie on the optional path is still rejected — "present" means it
	// must be valid; only "absent" is allowed to pass.
	u := authTestUser(sqlc.UserRoleStaff, true)
	srv := serverWithUsers(fakeUsers{byID: map[uuid.UUID]sqlc.User{u.ID: u}})
	c := issueCookie(t, srv, u)
	c.Value += "x"
	next, _, err := callAuthMW(srv, "CreateOrder", c)
	if !errors.Is(err, errUnauthenticated) {
		t.Fatalf("want errUnauthenticated for an invalid cookie on the optional path, got %v", err)
	}
	if next.called {
		t.Fatal("handler must not run for an invalid cookie")
	}
}

func TestAuthMiddlewareOwnerOnlyRejectsStaff(t *testing.T) {
	u := authTestUser(sqlc.UserRoleStaff, true)
	srv := serverWithUsers(fakeUsers{byID: map[uuid.UUID]sqlc.User{u.ID: u}})
	next, _, err := callAuthMW(srv, "UpdateBankAccount", issueCookie(t, srv, u))
	if !errors.Is(err, errForbidden) {
		t.Fatalf("staff on an owner-only edge must be errForbidden, got %v", err)
	}
	if next.called {
		t.Fatal("handler must not run for a forbidden role")
	}
}

func TestAuthMiddlewareOwnerOnlyAllowsOwner(t *testing.T) {
	u := authTestUser(sqlc.UserRoleOwner, true)
	srv := serverWithUsers(fakeUsers{byID: map[uuid.UUID]sqlc.User{u.ID: u}})
	next, _, err := callAuthMW(srv, "UpdateBankAccount", issueCookie(t, srv, u))
	if err != nil {
		t.Fatalf("owner on an owner-only edge must pass, got %v", err)
	}
	if !next.called || next.actor.Role != order.RoleOwner {
		t.Fatal("owner-only edge must reach the handler with the owner actor")
	}
}

func TestClassifyFailsClosed(t *testing.T) {
	if got := classify("SomeBrandNewAdminOp"); got != authRequired {
		t.Errorf("unlisted op must default to authRequired (fail-closed), got %d", got)
	}
	cases := map[string]authClass{
		"LoginUser":                authPublic,
		"LogoutUser":               authPublic,
		"GetProductBySlug":         authPublic,
		"GetProducts":              authPublic,
		"QuotePrice":               authPublic,
		"LookupOrder":              authPublic,
		"GetCheckoutConfig":        authPublic,
		"CreatePaymentProofUpload": authPublic,
		"CreateOrder":              authOptional,
		"UpdateBankAccount":        authOwnerOnly,
		"GetDashboard":             authRequired,
		"GetAdminOrders":           authRequired,
		"GetAdminOrder":            authRequired,
		"GetPrintQueue":            authRequired,
		"AdvancePrintJobStage":     authRequired,
		"GetSettings":              authRequired,
		"ListReplyTemplates":       authRequired,
		"TransitionOrder":          authRequired,
	}
	for op, want := range cases {
		if got := classify(op); got != want {
			t.Errorf("classify(%q) = %d, want %d", op, got, want)
		}
	}
}

// A public catalog read (GET /products/{slug}) runs the handler with NO cookie — classify marks it
// authPublic, so the auth boundary must neither resolve an actor nor reject. Docker-free: proves the
// public gate without a DB (the handler's own reads are covered by the integration test).
func TestAuthMiddlewarePublicCatalogRunsWithoutCookie(t *testing.T) {
	next, _, err := callAuthMW(serverWithUsers(fakeUsers{}), "GetProductBySlug", nil)
	if err != nil {
		t.Fatalf("public catalog op errored at the auth boundary: %v", err)
	}
	if !next.called {
		t.Fatal("public catalog op must run the handler with no cookie (authPublic)")
	}
}

func TestActorRoleNeverSystem(t *testing.T) {
	owner, err := actorRole(sqlc.UserRoleOwner)
	if err != nil || owner != order.RoleOwner {
		t.Errorf("owner → (%q,%v), want owner", owner, err)
	}
	staff, err := actorRole(sqlc.UserRoleStaff)
	if err != nil || staff != order.RoleStaff {
		t.Errorf("staff → (%q,%v), want staff", staff, err)
	}
	if _, err := actorRole(sqlc.UserRole("system")); err == nil {
		t.Error("a non-{owner,staff} role must be rejected — system is never a login identity")
	}
}

// End-to-end wire tests: prove the middleware is actually mounted in NewRouter, not just
// unit-callable. These use nil pool/nats — the exercised paths never touch them.

func TestAdminRouteUnauthenticatedReturns401Envelope(t *testing.T) {
	h := NewRouter(slog.New(slog.NewTextHandler(io.Discard, nil)), nil, nil, auth.NewIssuer("test-secret", time.Hour, true, auth.SessionCookieName))
	req := httptest.NewRequest(http.MethodGet, "/admin/dashboard", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("GET /admin/dashboard w/o cookie = %d, want 401", rec.Code)
	}
	var env map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("body not JSON envelope: %v", err)
	}
	if env["code"] != codeUnauthorized {
		t.Errorf("code = %v, want %s", env["code"], codeUnauthorized)
	}
}

func TestLogoutRouteReachableWithoutCookie(t *testing.T) {
	h := NewRouter(slog.New(slog.NewTextHandler(io.Discard, nil)), nil, nil, auth.NewIssuer("test-secret", time.Hour, true, auth.SessionCookieName))
	req := httptest.NewRequest(http.MethodPost, "/auth/logout", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("POST /auth/logout w/o cookie = %d, want 204 (public route)", rec.Code)
	}
}

func TestPublicCreateOrderNotGatedByAuth(t *testing.T) {
	h := NewRouter(slog.New(slog.NewTextHandler(io.Discard, nil)), nil, nil, auth.NewIssuer("test-secret", time.Hour, true, auth.SessionCookieName))
	req := httptest.NewRequest(http.MethodPost, "/orders", http.NoBody)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	// Anonymous POST /orders (web) must pass the auth boundary — it fails later on the empty
	// body (400) or reaches the stub, but must NOT be 401/403.
	if rec.Code == http.StatusUnauthorized || rec.Code == http.StatusForbidden {
		t.Fatalf("anonymous POST /orders = %d, must not be gated (401/403)", rec.Code)
	}
}
