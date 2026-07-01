package httpapi

import (
	"bytes"
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
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
)

// fakeUsers is an injectable userReader for Docker-free login tests: it returns a fixed user
// (or error) regardless of the email queried, so the handler logic is exercised without a DB.
type fakeUsers struct {
	user sqlc.User
	err  error
}

func (f fakeUsers) UserByEmail(_ context.Context, _ string) (sqlc.User, error) {
	return f.user, f.err
}

// testLoginServer builds a *Server wired with an injected user-reader and a real token issuer,
// bypassing NewServer (which would build the reader from a live pool). pool/nats stay nil — the
// login path never touches them.
func testLoginServer(users userReader) *Server {
	return &Server{
		logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		users:  users,
		auth:   auth.NewIssuer("test-secret", time.Hour, true),
	}
}

// testAuthRouter mounts the strict-server routes around srv exactly as NewRouter does (both
// oapi error seams overridden), so tests exercise the real request→handler→cookie wire.
func testAuthRouter(srv *Server) http.Handler {
	strict := api.NewStrictHandlerWithOptions(srv, nil, api.StrictHTTPServerOptions{
		RequestErrorHandlerFunc:  srv.handleRequestError,
		ResponseErrorHandlerFunc: srv.handleResponseError,
	})
	return api.HandlerWithOptions(strict, api.ChiServerOptions{
		BaseRouter:       chi.NewRouter(),
		ErrorHandlerFunc: srv.handleRequestError,
	})
}

func postLogin(h http.Handler, email, password string) *http.Response {
	body, _ := json.Marshal(map[string]string{"email": email, "password": password})
	req := httptest.NewRequest(http.MethodPost, "/auth/login", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec.Result()
}

func sessionCookie(res *http.Response) *http.Cookie {
	for _, c := range res.Cookies() {
		if c.Name == auth.SessionCookieName {
			return c
		}
	}
	return nil
}

func ownerUser(t *testing.T, email, password string) sqlc.User {
	t.Helper()
	hash, err := auth.HashPassword(password)
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	return sqlc.User{
		ID: uuid.New(), Name: "Chủ shop", Email: email,
		Role: sqlc.UserRoleOwner, Active: true, PasswordHash: &hash,
	}
}

func TestLoginSuccessSetsHttpOnlyCookieTokenNotInBody(t *testing.T) {
	srv := testLoginServer(fakeUsers{user: ownerUser(t, "owner@lumin.vn", "secret123")})
	// Mixed-case email must still match (the handler lower-cases before lookup).
	res := postLogin(testAuthRouter(srv), "Owner@Lumin.VN", "secret123")
	defer res.Body.Close()

	if res.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", res.StatusCode)
	}
	c := sessionCookie(res)
	if c == nil {
		t.Fatal("a successful login must set the session cookie")
	}
	if !c.HttpOnly {
		t.Fatal("session cookie must be HttpOnly (ADR-030)")
	}
	if c.Value == "" {
		t.Fatal("session cookie must carry the JWT")
	}

	raw, _ := io.ReadAll(res.Body)
	// The token lives ONLY in the cookie — it must never appear in the JSON body (ADR-030).
	if bytes.Contains(raw, []byte(c.Value)) {
		t.Fatal("the JWT must not be echoed in the response body (cookie-only)")
	}
	var out api.AuthUser
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("body not an AuthUser: %v (%s)", err, raw)
	}
	if out.Role != api.Owner || string(out.Email) != "owner@lumin.vn" {
		t.Fatalf("AuthUser = %+v, want role owner + normalized email", out)
	}
}

func TestLoginWrongPasswordUniform401(t *testing.T) {
	srv := testLoginServer(fakeUsers{user: ownerUser(t, "o@lumin.vn", "secret123")})
	assertUnauthorizedNoCookie(t, postLogin(testAuthRouter(srv), "o@lumin.vn", "WRONG"))
}

func TestLoginUnknownEmailUniform401(t *testing.T) {
	// ErrNotFound must be indistinguishable from a wrong password (no user enumeration).
	srv := testLoginServer(fakeUsers{err: db.ErrNotFound})
	assertUnauthorizedNoCookie(t, postLogin(testAuthRouter(srv), "ghost@lumin.vn", "whatever"))
}

func TestLoginInactiveUser401(t *testing.T) {
	u := ownerUser(t, "o@lumin.vn", "secret123")
	u.Active = false
	// Correct password, but the account is disabled → same uniform 401.
	srv := testLoginServer(fakeUsers{user: u})
	assertUnauthorizedNoCookie(t, postLogin(testAuthRouter(srv), "o@lumin.vn", "secret123"))
}

// A genuine DB fault (not ErrNotFound) must surface as a 500 that does NOT leak the raw error.
func TestLoginDBFaultReturns500NoLeak(t *testing.T) {
	srv := testLoginServer(fakeUsers{err: errors.New("connection reset by peer")})
	res := postLogin(testAuthRouter(srv), "o@lumin.vn", "x")
	defer res.Body.Close()
	if res.StatusCode != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500 on a genuine DB fault", res.StatusCode)
	}
	raw, _ := io.ReadAll(res.Body)
	if bytes.Contains(raw, []byte("connection reset")) {
		t.Fatalf("500 body must not leak the raw DB error: %s", raw)
	}
}

func TestLogoutClearsCookie(t *testing.T) {
	srv := testLoginServer(fakeUsers{})
	req := httptest.NewRequest(http.MethodPost, "/auth/logout", nil)
	rec := httptest.NewRecorder()
	testAuthRouter(srv).ServeHTTP(rec, req)
	res := rec.Result()
	defer res.Body.Close()

	if res.StatusCode != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", res.StatusCode)
	}
	c := sessionCookie(res)
	if c == nil || c.MaxAge >= 0 {
		t.Fatalf("logout must expire the session cookie (MaxAge<0); got %+v", c)
	}
}

func assertUnauthorizedNoCookie(t *testing.T, res *http.Response) {
	t.Helper()
	defer res.Body.Close()
	if res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", res.StatusCode)
	}
	if sessionCookie(res) != nil {
		t.Fatal("a failed login must NOT set the session cookie")
	}
	raw, _ := io.ReadAll(res.Body)
	var env api.ErrorEnvelope
	if err := json.Unmarshal(raw, &env); err != nil {
		t.Fatalf("401 body not an ErrorEnvelope: %v (%s)", err, raw)
	}
	if env.Code != codeUnauthorized || env.MessageKey != "errors."+codeUnauthorized {
		t.Fatalf("envelope = %+v, want a uniform UNAUTHORIZED code", env)
	}
}
