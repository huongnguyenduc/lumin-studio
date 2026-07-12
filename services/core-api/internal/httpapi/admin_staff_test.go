package httpapi

import (
	"testing"

	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
)

// Docker-free unit tests for the P3-q staff-invite validator. parseStaffInvite is the trust boundary
// (it feeds account creation), so its bounds — name length, non-empty/normalized email, password range,
// role ∈ {owner,staff} — are pinned here without a DB. The password floor/ceiling and the role enum are
// the load-bearing checks: a slipped role would let a client fabricate a role the user_role enum rejects
// (500), and a slipped password bound would hash a too-weak or bcrypt-truncated secret.

func staffBody(name, email, pw string, role api.UserRole) *api.StaffInvite {
	return &api.StaffInvite{Name: name, Email: openapi_types.Email(email), Role: role, Password: pw}
}

func TestParseStaffInviteValid(t *testing.T) {
	// Whitespace is trimmed and the email is lower-cased/trimmed, so the normalized values are stored.
	inv, ok := parseStaffInvite(staffBody("  Hương  ", "  Huong@Lumin.VN ", "hunter2!!", api.Staff))
	if !ok {
		t.Fatal("valid staff invite rejected")
	}
	if inv.name != "Hương" || inv.email != "huong@lumin.vn" || inv.role != sqlc.UserRoleStaff || inv.password != "hunter2!!" {
		t.Fatalf("normalized invite wrong: %+v", inv)
	}
	// A co-owner invite is allowed (owner is a legitimate fixed role, spec §08).
	if inv, ok := parseStaffInvite(staffBody("Sếp", "boss@lumin.vn", "password1", api.Owner)); !ok || inv.role != sqlc.UserRoleOwner {
		t.Fatalf("owner invite: ok=%v role=%v, want ok + owner", ok, inv.role)
	}
}

func TestParseStaffInviteRejects(t *testing.T) {
	long := make([]byte, 61) // 61 runes > staffNameMax
	for i := range long {
		long[i] = 'a'
	}
	longPw := make([]byte, 73) // 73 bytes > passwordMax (bcrypt 72)
	for i := range longPw {
		longPw[i] = 'x'
	}
	cases := map[string]*api.StaffInvite{
		"nil body":       nil,
		"name too short": staffBody("H", "h@lumin.vn", "password1", api.Staff),
		"name too long":  staffBody(string(long), "h@lumin.vn", "password1", api.Staff),
		"blank name":     staffBody("   ", "h@lumin.vn", "password1", api.Staff),
		"empty email":    staffBody("Hương", "   ", "password1", api.Staff),
		"password short": staffBody("Hương", "h@lumin.vn", "short7!", api.Staff), // 7 chars
		"password long":  staffBody("Hương", "h@lumin.vn", string(longPw), api.Staff),
		"bad role":       staffBody("Hương", "h@lumin.vn", "password1", api.UserRole("superadmin")),
		"system role":    staffBody("Hương", "h@lumin.vn", "password1", api.UserRole("system")),
	}
	for name, body := range cases {
		if _, ok := parseStaffInvite(body); ok {
			t.Errorf("%s: parseStaffInvite accepted, want rejected", name)
		}
	}
}
