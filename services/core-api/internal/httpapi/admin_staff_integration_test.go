package httpapi

import (
	"context"
	"io"
	"log/slog"
	"testing"

	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/auth"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db"
)

// Integration tests for the P3-q staff & roles surface against real Postgres (testcontainers: skip local
// without Docker, run in CI — ADR-020). They prove the load-bearing properties: an invite creates a
// WORKING login credential (not a dead pending row — auth.VerifyPassword round-trips the stored hash),
// the roster lists every account owner-first with NO credential material, a duplicate email is a clean
// 409 (not a 500), and a bad password is a 400 response (not an error).

func TestAdminStaffInviteEndToEnd(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()
	owner := ownerCtx()
	srv := NewServer(slog.New(slog.NewTextHandler(io.Discard, nil)), pool, nil, nil)
	idn := db.NewIdentity(pool)

	// A seeded owner so the roster is never empty (the caller is always an owner in practice).
	ownerID := seedOwnerUser(t, ctx, pool)

	// --- invite a staff account → 201, role=staff, active=true, no credential material in the DTO ---
	const staffEmail = "huong@lumin.vn"
	const staffPassword = "hunter2!!"
	created := invite(t, srv, owner, api.StaffInvite{
		Name: "Hương", Email: openapi_types.Email(staffEmail), Role: api.Staff, Password: staffPassword,
	})
	if created.Role != api.Staff || !created.Active || string(created.Email) != staffEmail {
		t.Fatalf("created staff DTO wrong: %+v", created)
	}

	// --- the credential actually works: the stored bcrypt hash verifies against the owner-set password
	//     (the whole point of "invite" — the invitee can log in, not a dead pending row) ---
	row, err := idn.UserByEmail(ctx, staffEmail)
	if err != nil {
		t.Fatalf("read invited staff: %v", err)
	}
	if !auth.VerifyPassword(row.PasswordHash, staffPassword) {
		t.Fatal("invited staff's stored password_hash does not verify — invite produced no working credential")
	}

	// --- roster lists BOTH (seeded owner + invited staff), owner first, no password material ---
	roster := staffRoster(t, srv, owner)
	if len(roster) != 2 {
		t.Fatalf("roster = %d accounts, want 2 (owner + staff)", len(roster))
	}
	if roster[0].Id != ownerID || roster[0].Role != api.Owner {
		t.Fatalf("roster[0] = %+v, want the owner first (user_role orders owner<staff)", roster[0])
	}
	if roster[1].Id != created.Id || roster[1].Role != api.Staff {
		t.Fatalf("roster[1] = %+v, want the invited staff", roster[1])
	}

	// --- duplicate email → 409 (a login email is user-known; safe to surface), not a 500 ---
	dup, err := srv.CreateStaff(owner, api.CreateStaffRequestObject{Body: &api.StaffInvite{
		Name: "Hương khác", Email: openapi_types.Email(staffEmail), Role: api.Staff, Password: "another11",
	}})
	if err != nil {
		t.Fatalf("duplicate email should be a 409 response, not an error: %v", err)
	}
	if _, ok := dup.(api.CreateStaff409JSONResponse); !ok {
		t.Fatalf("duplicate email resp = %T, want 409", dup)
	}

	// --- bad input (short password) → 400 response, nothing created ---
	bad, err := srv.CreateStaff(owner, api.CreateStaffRequestObject{Body: &api.StaffInvite{
		Name: "Ngắn", Email: openapi_types.Email("short@lumin.vn"), Role: api.Staff, Password: "short7!",
	}})
	if err != nil {
		t.Fatalf("short password should be a 400 response, not an error: %v", err)
	}
	if _, ok := bad.(api.CreateStaff400JSONResponse); !ok {
		t.Fatalf("short password resp = %T, want 400", bad)
	}
	if r := staffRoster(t, srv, owner); len(r) != 2 {
		t.Fatalf("roster grew to %d after a rejected invite — a 400 must not create", len(r))
	}
}

// invite drives CreateStaff and asserts a 201, returning the created roster row.
func invite(t *testing.T, srv *Server, ctx context.Context, body api.StaffInvite) api.AdminStaff {
	t.Helper()
	resp, err := srv.CreateStaff(ctx, api.CreateStaffRequestObject{Body: &body})
	if err != nil {
		t.Fatalf("invite %s: %v", body.Email, err)
	}
	created, ok := resp.(api.CreateStaff201JSONResponse)
	if !ok {
		t.Fatalf("invite resp = %T, want 201", resp)
	}
	return api.AdminStaff(created)
}

// staffRoster drives GetAdminStaff and returns the roster.
func staffRoster(t *testing.T, srv *Server, ctx context.Context) []api.AdminStaff {
	t.Helper()
	resp, err := srv.GetAdminStaff(ctx, api.GetAdminStaffRequestObject{})
	if err != nil {
		t.Fatalf("list staff: %v", err)
	}
	list, ok := resp.(api.GetAdminStaff200JSONResponse)
	if !ok {
		t.Fatalf("staff roster resp = %T, want 200", resp)
	}
	return list
}
