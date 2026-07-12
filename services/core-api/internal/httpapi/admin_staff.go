package httpapi

import (
	"context"
	"errors"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/auth"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
)

// admin_staff.go — the staff & roles surface (P3-q, Cài đặt › Nhân viên). Owner-only for BOTH read and
// write (classify → authOwnerOnly): managing the team — and even seeing the roster — is an owner power
// (spec §08; the design's role matrix gives staff no access to "Cài đặt & nhân viên"). This is the ONE
// owner-only admin READ; every other admin read is owner+staff. The RBAC matrix the FE draws is
// DISPLAY-ONLY: owner/staff are the two fixed roles (spec §08), not configurable (open-Q #3 → hiển-thị).
//
// "Invite" is deliberately minimal: the owner sets an initial password shared out-of-band and the
// invitee logs in immediately with email + password — there is no email-invite / self-service-password
// flow yet. ponytail: owner-set initial password. Add email invite + a tokenized set-password page when
// an email/Zalo channel lands (roadmap); until then a full invite subsystem is speculative.

// staffNameMin/Max mirror the customers.name CHECK (2..60 runes) for consistent, sane data — users.name
// has no DB CHECK, so this handler is the only guard. password reuses the customer bounds (passwordMin/
// passwordMax, customer.go): bcrypt's usable range (a strength floor + the 72-byte truncation ceiling).
const (
	staffNameMin = 2
	staffNameMax = 60
)

// GetAdminStaff handles GET /admin/staff (owner-only): the team roster, owner first. No credential
// material is projected (toAdminStaff drops password_hash).
func (s *Server) GetAdminStaff(ctx context.Context, _ api.GetAdminStaffRequestObject) (api.GetAdminStaffResponseObject, error) {
	rows, err := db.NewIdentity(s.pool).ListUsers(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]api.AdminStaff, len(rows))
	for i, u := range rows {
		out[i] = toAdminStaff(u)
	}
	return api.GetAdminStaff200JSONResponse(out), nil
}

// CreateStaff handles POST /admin/staff (owner-only): create a staff/owner account with an owner-set
// login credential. A duplicate email → 409 EMAIL_TAKEN (a login email is user-known, safe to surface —
// unlike the uniform-401 login path); bad input → 400. The FE re-reads the roster, so the 201 body is
// the created row only for confirmation.
func (s *Server) CreateStaff(ctx context.Context, req api.CreateStaffRequestObject) (api.CreateStaffResponseObject, error) {
	inv, ok := parseStaffInvite(req.Body)
	if !ok {
		return api.CreateStaff400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(envelope(codeValidation))}, nil
	}
	hash, err := auth.HashPassword(inv.password)
	if err != nil {
		return nil, err // bcrypt fault → 500 (logged), never leaked
	}
	user, err := db.NewIdentity(s.pool).InviteUser(ctx, sqlc.InsertUserWithCredentialParams{
		ID:           uuid.New(),
		Name:         inv.name,
		Email:        inv.email,
		Role:         inv.role,
		PasswordHash: &hash,
	})
	if err != nil {
		if errors.Is(err, db.ErrDuplicate) {
			return api.CreateStaff409JSONResponse{ConflictJSONResponse: api.ConflictJSONResponse(envelope(codeEmailTaken))}, nil
		}
		return nil, err // genuine DB fault → 500
	}
	return api.CreateStaff201JSONResponse(toAdminStaff(user)), nil
}

// staffInvite is a validated, normalized invite. password is kept separate from the persisted fields so
// it is never accidentally stored raw or logged — only its bcrypt hash reaches the DB.
type staffInvite struct {
	name     string
	email    string
	role     sqlc.UserRole
	password string
}

// parseStaffInvite validates + normalizes a StaffInvite body: name 2..60 runes, non-empty normalized
// email, password 8..72 bytes, role ∈ {owner, staff}. Pure (no clock/db) so it is unit-testable. The
// oapi-codegen strict server does not enforce the schema's min/maxLength, so the bounds are checked here.
func parseStaffInvite(body *api.StaffInvite) (staffInvite, bool) {
	if body == nil {
		return staffInvite{}, false
	}
	name := strings.TrimSpace(body.Name)
	if n := utf8.RuneCountInString(name); n < staffNameMin || n > staffNameMax {
		return staffInvite{}, false
	}
	// email is the login handle → must be non-empty. Over HTTP openapi_types.Email regex-validates at
	// decode (empty/malformed → 400 before this runs); this guard is defense-in-depth for a non-HTTP
	// caller and turns a would-be misleading 409 (two blank emails collide) into an honest 400.
	email := normalizeEmail(string(body.Email))
	if email == "" {
		return staffInvite{}, false
	}
	if l := len(body.Password); l < passwordMin || l > passwordMax {
		return staffInvite{}, false
	}
	role, ok := staffRole(body.Role)
	if !ok {
		return staffInvite{}, false
	}
	return staffInvite{name: name, email: email, role: role, password: body.Password}, true
}

// staffRole maps the wire UserRole to the stored sqlc.UserRole, rejecting anything outside {owner,
// staff} (the two fixed roles — spec §08). A bad enum is a clean 400, never a Postgres user_role 500.
func staffRole(r api.UserRole) (sqlc.UserRole, bool) {
	switch r {
	case api.Owner:
		return sqlc.UserRoleOwner, true
	case api.Staff:
		return sqlc.UserRoleStaff, true
	default:
		return "", false
	}
}

// toAdminStaff projects a persisted user row to the wire roster row — no credential material.
func toAdminStaff(u sqlc.User) api.AdminStaff {
	return api.AdminStaff{
		Id:     u.ID,
		Name:   u.Name,
		Email:  openapi_types.Email(u.Email),
		Role:   api.UserRole(u.Role),
		Active: u.Active,
	}
}
