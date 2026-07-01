package httpapi

import (
	"context"
	"errors"
	"strings"
	"time"

	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/auth"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db"
)

// LoginUser handles POST /auth/login (PR-3e-1, ADR-030): look the user up by email, verify the
// password with bcrypt, and on success mint a signed JWT set as an httpOnly session cookie —
// the token is NEVER placed in the response body (out of JS-readable storage, blunts XSS theft).
// Unknown email and wrong password return the SAME uniform 401: auth.VerifyPassword always runs
// one bcrypt comparison (even for a missing user / null hash) so the two paths are timing-
// indistinguishable and the endpoint leaks no signal about which emails exist (no enumeration).
func (s *Server) LoginUser(ctx context.Context, req api.LoginUserRequestObject) (api.LoginUserResponseObject, error) {
	if req.Body == nil {
		return loginBadRequest(), nil
	}
	email := normalizeEmail(string(req.Body.Email))

	user, err := s.users.UserByEmail(ctx, email)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			// Unknown email: still burn a bcrypt compare (nil hash) so timing matches the
			// wrong-password path below, then return the uniform 401.
			auth.VerifyPassword(nil, req.Body.Password)
			return loginUnauthorized(), nil
		}
		// A genuine DB fault → 500 via handleResponseError (logged server-side, never leaked).
		return nil, err
	}

	// Always run the compare (don't short-circuit on !Active) so an inactive account's timing
	// matches an active one's — same no-enumeration guarantee.
	passwordOK := auth.VerifyPassword(user.PasswordHash, req.Body.Password)
	if !user.Active || !passwordOK {
		return loginUnauthorized(), nil
	}

	cookie, err := s.auth.Issue(user.ID.String(), string(user.Role), time.Now().UTC())
	if err != nil {
		return nil, err
	}
	// The token rides ONLY in the Set-Cookie header (the openapi Set-Cookie response header,
	// generated as Headers.SetCookie) — never the JSON body, so it stays out of JS-readable
	// storage (ADR-030). cookie.String() serializes all the security attributes (httpOnly/Secure/
	// SameSite/Path/Max-Age) set by the issuer.
	return api.LoginUser200JSONResponse{
		Body: api.AuthUser{
			Id:    user.ID,
			Name:  user.Name,
			Email: openapi_types.Email(user.Email),
			Role:  api.UserRole(user.Role),
		},
		Headers: api.LoginUser200ResponseHeaders{SetCookie: cookie.String()},
	}, nil
}

// LogoutUser handles POST /auth/logout: clear the session cookie, return 204. The PR-3e-2 verify
// middleware gates this route once it lands; clearing an already-absent cookie is harmless.
func (s *Server) LogoutUser(_ context.Context, _ api.LogoutUserRequestObject) (api.LogoutUserResponseObject, error) {
	return api.LogoutUser204Response{
		Headers: api.LogoutUser204ResponseHeaders{SetCookie: s.auth.Clear().String()},
	}, nil
}

// loginUnauthorized is the single uniform "bad email-or-password" 401 (no enumeration). It
// carries the ErrorEnvelope shape every endpoint returns (ADR-032).
func loginUnauthorized() api.LoginUser401JSONResponse {
	return api.LoginUser401JSONResponse{UnauthorizedJSONResponse: api.UnauthorizedJSONResponse(envelope(codeUnauthorized))}
}

// loginBadRequest is the 400 for a missing/undecodable body (a decode failure is already caught
// by the strict RequestErrorHandlerFunc; this covers a nil body reaching the handler).
func loginBadRequest() api.LoginUser400JSONResponse {
	return api.LoginUser400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(envelope(codeValidation))}
}

// normalizeEmail lower-cases and trims the login email so it matches the value `make seed-owner`
// persisted (email is case-insensitive in practice; the users.email column stores it verbatim).
func normalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}
