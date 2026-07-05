package httpapi

import (
	"context"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/google/uuid"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/auth"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
)

// Customer registration bounds. name mirrors the customers.name CHECK (2..60 runes) so a bad name
// is a clean 400, not a DB CHECK 500. password is bcrypt's usable range: a floor for strength and a
// 72-byte ceiling because bcrypt silently truncates (or errors) past it — reject rather than hash a
// surprise-truncated secret. oapi-codegen strict-server does not enforce the schema's min/maxLength
// (no validation middleware wired), so these are checked here.
const (
	customerNameMin = 2
	customerNameMax = 60
	passwordMin     = 8
	passwordMax     = 72
)

// RegisterCustomer handles POST /customer/register (PR-P1-r, ADR-030): create a storefront account
// in the SEPARATE customer realm and log it in by setting the customer session cookie. A duplicate
// login email is the one safe-to-surface error (409 EMAIL_TAKEN) — a login email is user-known, not
// a secret, unlike the uniform-401 login path. Guest orders placed before registering are NOT
// auto-linked (claiming an unverified phone's orders is a security hole — deferred).
func (s *Server) RegisterCustomer(ctx context.Context, req api.RegisterCustomerRequestObject) (api.RegisterCustomerResponseObject, error) {
	if req.Body == nil {
		return api.RegisterCustomer400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(envelope(codeValidation))}, nil
	}
	name := strings.TrimSpace(req.Body.Name)
	phone := strings.TrimSpace(req.Body.Phone)
	email := normalizeEmail(string(req.Body.Email))
	if n := utf8.RuneCountInString(name); n < customerNameMin || n > customerNameMax {
		return api.RegisterCustomer400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(envelope(codeValidation))}, nil
	}
	if phone == "" {
		return api.RegisterCustomer400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(envelope(codeValidation))}, nil
	}
	// email is the login handle → it must be non-empty. Over HTTP it can't be empty/malformed here:
	// openapi_types.Email regex-validates at JSON decode (an empty/whitespace/bad address is a 400
	// VALIDATION before this handler runs). This guard is defense-in-depth for any non-HTTP caller
	// and turns a would-be misleading 409 EMAIL_TAKEN (two blank emails collide on the unique index)
	// into an honest 400 — matching the name/phone/password checks above.
	if email == "" {
		return api.RegisterCustomer400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(envelope(codeValidation))}, nil
	}
	if l := len(req.Body.Password); l < passwordMin || l > passwordMax {
		return api.RegisterCustomer400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(envelope(codeValidation))}, nil
	}

	hash, err := auth.HashPassword(req.Body.Password)
	if err != nil {
		return nil, err // bcrypt fault → 500 (logged), never leaked
	}
	customer, err := db.NewIdentity(s.pool).RegisterCustomer(ctx, sqlc.InsertCustomerWithCredentialParams{
		ID:           uuid.New(),
		Name:         name,
		Phone:        phone,
		Email:        &email,
		PasswordHash: &hash,
	})
	if err != nil {
		if errors.Is(err, db.ErrDuplicate) {
			return api.RegisterCustomer409JSONResponse{ConflictJSONResponse: api.ConflictJSONResponse(envelope(codeEmailTaken))}, nil
		}
		return nil, err // genuine DB fault → 500
	}

	cookie, err := s.customerAuth.Issue(customer.ID.String(), customerTokenRole, time.Now().UTC())
	if err != nil {
		return nil, err
	}
	return api.RegisterCustomer201JSONResponse{
		Body:    toCustomerAccount(customer),
		Headers: api.RegisterCustomer201ResponseHeaders{SetCookie: cookie.String()},
	}, nil
}

// LoginCustomer handles POST /customer/login (PR-P1-r): look the customer up by login email, verify
// bcrypt, mint the customer session cookie. Unknown email and wrong password return the SAME uniform
// 401 — auth.VerifyPassword always runs one bcrypt compare (even for a missing row / nil hash) so the
// paths are timing-indistinguishable and no email is confirmed/denied to exist (no enumeration).
func (s *Server) LoginCustomer(ctx context.Context, req api.LoginCustomerRequestObject) (api.LoginCustomerResponseObject, error) {
	if req.Body == nil {
		return api.LoginCustomer400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(envelope(codeValidation))}, nil
	}
	email := normalizeEmail(string(req.Body.Email))

	customer, err := db.NewIdentity(s.pool).CustomerByLoginEmail(ctx, email)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			// Unknown email: still burn a bcrypt compare (nil hash) so timing matches the wrong-
			// password path, then the uniform 401.
			auth.VerifyPassword(nil, req.Body.Password)
			return customerLoginUnauthorized(), nil
		}
		return nil, err // genuine DB fault → 500
	}
	if !auth.VerifyPassword(customer.PasswordHash, req.Body.Password) {
		return customerLoginUnauthorized(), nil
	}

	cookie, err := s.customerAuth.Issue(customer.ID.String(), customerTokenRole, time.Now().UTC())
	if err != nil {
		return nil, err
	}
	return api.LoginCustomer200JSONResponse{
		Body:    toCustomerAccount(customer),
		Headers: api.LoginCustomer200ResponseHeaders{SetCookie: cookie.String()},
	}, nil
}

// LogoutCustomer handles POST /customer/logout: clear the customer session cookie, return 204.
// It is authPublic (clearing a cookie can't itself require one); clearing an absent cookie is a no-op.
func (s *Server) LogoutCustomer(_ context.Context, _ api.LogoutCustomerRequestObject) (api.LogoutCustomerResponseObject, error) {
	return api.LogoutCustomer204Response{
		Headers: api.LogoutCustomer204ResponseHeaders{SetCookie: s.customerAuth.Clear().String()},
	}, nil
}

// GetCustomerOrders handles GET /customer/orders (PR-P1-r): the authenticated customer's own order
// history, newest-first, as the SAME public timeline projection the guest lookup returns (no internal
// money/PII/address fields — ADR-032). Scoped strictly by the verified session's customer id, injected
// by the auth middleware. The admin cookie can't reach here (separate realm) — the middleware's
// authCustomer branch already rejected a request with no valid customer session (401).
func (s *Server) GetCustomerOrders(ctx context.Context, _ api.GetCustomerOrdersRequestObject) (api.GetCustomerOrdersResponseObject, error) {
	customerID, ok := customerFrom(ctx)
	if !ok {
		// Defense in depth: the middleware injects the customer for this operation, so a miss means a
		// wiring bug, not an anonymous request. Fail closed as unauthenticated rather than leak all rows.
		return nil, errUnauthenticated
	}
	rows, err := db.NewOrders(s.pool).ByCustomer(ctx, customerID)
	if err != nil {
		return nil, err // genuine DB fault → 500
	}
	list := make(api.CustomerOrderList, len(rows))
	for i, row := range rows {
		dto, err := publicTimelineDTO(row)
		if err != nil {
			return nil, err // malformed stored `at` (never written by the seams) → 500 (logged)
		}
		list[i] = dto
	}
	return api.GetCustomerOrders200JSONResponse(list), nil
}

// customerTokenRole is the placeholder `role` claim customer tokens carry. The customer realm has no
// role axis (every account is just a customer); the claim exists only because auth.Verify requires a
// non-empty role. resolveCustomer reads the token SUBJECT (customers.id), never this value.
const customerTokenRole = "customer"

// customerLoginUnauthorized is the single uniform bad-email-or-password 401 (no enumeration).
func customerLoginUnauthorized() api.LoginCustomer401JSONResponse {
	return api.LoginCustomer401JSONResponse{UnauthorizedJSONResponse: api.UnauthorizedJSONResponse(envelope(codeUnauthorized))}
}

// toCustomerAccount projects a persisted customer row to the wire account (no credential material).
// A credentialed customer always has an email (the customers_credential_needs_email CHECK), so the
// nil-guard is defensive only.
func toCustomerAccount(c sqlc.Customer) api.CustomerAccount {
	email := ""
	if c.Email != nil {
		email = *c.Email
	}
	return api.CustomerAccount{
		Id:    c.ID,
		Name:  c.Name,
		Email: openapi_types.Email(email),
		Phone: c.Phone,
	}
}

// customerCtxKey is the unexported context key for the resolved customer id — unexported so only
// this package can set/read it (a handler can't be tricked into reading an id planted elsewhere).
type customerCtxKey struct{}

// withCustomer returns a child context carrying the authenticated customer id (auth middleware).
func withCustomer(ctx context.Context, id uuid.UUID) context.Context {
	return context.WithValue(ctx, customerCtxKey{}, id)
}

// customerFrom returns the customer id injected by the authCustomer middleware branch, or ok=false
// when the request carried no valid customer session.
func customerFrom(ctx context.Context) (uuid.UUID, bool) {
	id, ok := ctx.Value(customerCtxKey{}).(uuid.UUID)
	return id, ok
}
