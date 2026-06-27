package contract

// The 4-way enum parity guard (ADR-031, plan core-http-relay.md §3c-1.3). The
// hand-authored openapi.yaml introduces a SECOND hand-maintained copy of the order
// enums on top of internal/order, packages/core Zod, and the Postgres native enums.
// Three of those four already cross-check each other (the OSM battery, sqlc enum
// overrides, migration 000001 byte-identical comment); this test pins the new fourth
// copy to them so the generated Go + TS clients cannot silently diverge.
//
// `system` is the one deliberate asymmetry: it is a valid actor Role (runtime-only,
// e.g. delivery auto-complete) but NEVER a stored user role, so Postgres user_role
// (and OpenAPI UserRole) omit it. The test asserts that relationship explicitly
// instead of waving it through — a future edit that adds `system` to user_role, or
// drops it from Role, fails here.

import (
	"os"
	"regexp"
	"testing"

	"gopkg.in/yaml.v3"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/order"
)

// Paths are relative to this package dir (go test sets CWD = the package dir).
const (
	openapiPath  = "../../openapi.yaml"
	enumsSQLPath = "../../db/migrations/000001_enums.up.sql"
	tsOrderState = "../../../../packages/core/src/order-state.ts"
	tsSchemas    = "../../../../packages/core/src/schemas.ts"
)

// openapiDoc captures just enough of the contract to read its enum sets + smoke-check
// the document is structurally an OpenAPI spec (so a truncated/garbled file fails loud).
type openapiDoc struct {
	OpenAPI    string         `yaml:"openapi"`
	Paths      map[string]any `yaml:"paths"`
	Components struct {
		Schemas map[string]struct {
			Enum []string `yaml:"enum"`
		} `yaml:"schemas"`
	} `yaml:"components"`
}

func loadOpenAPI(t *testing.T) openapiDoc {
	t.Helper()
	data, err := os.ReadFile(openapiPath)
	if err != nil {
		t.Fatalf("read openapi.yaml: %v (a missing contract voids the parity guarantee)", err)
	}
	var doc openapiDoc
	if err := yaml.Unmarshal(data, &doc); err != nil {
		t.Fatalf("parse openapi.yaml: %v", err)
	}
	if doc.OpenAPI == "" || len(doc.Paths) < 8 || len(doc.Components.Schemas) == 0 {
		t.Fatalf("openapi.yaml does not look like the full slice-3 contract: openapi=%q paths=%d schemas=%d",
			doc.OpenAPI, len(doc.Paths), len(doc.Components.Schemas))
	}
	return doc
}

func openapiEnum(t *testing.T, doc openapiDoc, schema string) []string {
	t.Helper()
	s, ok := doc.Components.Schemas[schema]
	if !ok {
		t.Fatalf("openapi.yaml: components.schemas.%s missing", schema)
	}
	if len(s.Enum) == 0 {
		t.Fatalf("openapi.yaml: schema %s has no enum", schema)
	}
	return s.Enum
}

func mustRead(t *testing.T, path string) string {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v (parity sources must all be present)", path, err)
	}
	return string(data)
}

// Token class allows digits/hyphens so a future enum value like 'recycled-PLA' is extracted
// whole (a partial match would silently shorten the set); current enums are [A-Za-z_] only.
var quoted = regexp.MustCompile(`['"]([A-Za-z0-9_-]+)['"]`)

// listAfter finds the first match of anchor, then extracts the single/double-quoted
// tokens inside the first [...] that follows — the shared shape of a TS array literal,
// a z.enum([...]) call, and a Postgres ENUM (...) (with the bracket char varied).
func listAfter(t *testing.T, src, anchor, open, close string) []string {
	t.Helper()
	loc := regexp.MustCompile(anchor).FindStringIndex(src)
	if loc == nil {
		t.Fatalf("anchor %q not found", anchor)
	}
	rest := src[loc[1]:]
	o := indexOf(rest, open)
	if o < 0 {
		t.Fatalf("opening %q after anchor %q not found", open, anchor)
	}
	c := indexOf(rest[o:], close)
	if c < 0 {
		t.Fatalf("closing %q after anchor %q not found", close, anchor)
	}
	inner := rest[o : o+c]
	var out []string
	for _, m := range quoted.FindAllStringSubmatch(inner, -1) {
		out = append(out, m[1])
	}
	if len(out) == 0 {
		t.Fatalf("no tokens between %q and %q after anchor %q", open, close, anchor)
	}
	return out
}

func indexOf(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}

func assertSame(t *testing.T, label string, want, got []string) {
	t.Helper()
	if len(want) != len(got) {
		t.Fatalf("%s: length mismatch want %v got %v", label, want, got)
	}
	for i := range want {
		if want[i] != got[i] {
			t.Fatalf("%s: index %d mismatch want %q got %q (full want=%v got=%v)", label, i, want[i], got[i], want, got)
		}
	}
}

func TestOrderStatusParity(t *testing.T) {
	doc := loadOpenAPI(t)
	api := openapiEnum(t, doc, "OrderStatus")

	// Go: the canonical ordering var (mirrors ORDER_STATUSES in core).
	goVals := make([]string, len(order.Statuses))
	for i, s := range order.Statuses {
		goVals[i] = string(s)
	}
	ts := listAfter(t, mustRead(t, tsOrderState), `ORDER_STATUSES[^=]*=`, "[", "]")
	pg := listAfter(t, mustRead(t, enumsSQLPath), `CREATE TYPE order_status AS ENUM`, "(", ")")

	assertSame(t, "OrderStatus OpenAPI vs Go", goVals, api)
	assertSame(t, "OrderStatus OpenAPI vs TS", ts, api)
	assertSame(t, "OrderStatus OpenAPI vs Postgres", pg, api)
}

func TestChannelParity(t *testing.T) {
	doc := loadOpenAPI(t)
	api := openapiEnum(t, doc, "Channel")

	goVals := []string{string(order.ChannelWeb), string(order.ChannelInbox)}
	ts := listAfter(t, mustRead(t, tsSchemas), `channelEnum[^=]*=`, "[", "]")
	pg := listAfter(t, mustRead(t, enumsSQLPath), `CREATE TYPE order_channel AS ENUM`, "(", ")")

	assertSame(t, "Channel OpenAPI vs Go", goVals, api)
	assertSame(t, "Channel OpenAPI vs TS", ts, api)
	assertSame(t, "Channel OpenAPI vs Postgres", pg, api)
}

// TestRoleParity covers the actor Role (owner|staff|system) across OpenAPI, Go and TS.
// Postgres has no actor-role type — its user_role is the STORED subset, asserted in
// TestUserRoleParity below.
func TestRoleParity(t *testing.T) {
	doc := loadOpenAPI(t)
	api := openapiEnum(t, doc, "Role")

	goVals := []string{string(order.RoleOwner), string(order.RoleStaff), string(order.RoleSystem)}
	ts := listAfter(t, mustRead(t, tsSchemas), `roleEnum[^=]*=`, "[", "]")

	assertSame(t, "Role OpenAPI vs Go", goVals, api)
	assertSame(t, "Role OpenAPI vs TS", ts, api)
}

// TestUserRoleParity pins the STORED user role (OpenAPI UserRole) to Postgres user_role
// and asserts the documented asymmetry: UserRole == Role minus the runtime-only `system`.
func TestUserRoleParity(t *testing.T) {
	doc := loadOpenAPI(t)
	apiUserRole := openapiEnum(t, doc, "UserRole")
	apiRole := openapiEnum(t, doc, "Role")

	pg := listAfter(t, mustRead(t, enumsSQLPath), `CREATE TYPE user_role AS ENUM`, "(", ")")

	assertSame(t, "UserRole OpenAPI vs Postgres user_role", pg, apiUserRole)

	// Relationship: UserRole is exactly Role with `system` removed.
	var roleMinusSystem []string
	for _, r := range apiRole {
		if r != "system" {
			roleMinusSystem = append(roleMinusSystem, r)
		}
	}
	assertSame(t, "UserRole == Role minus system", roleMinusSystem, apiUserRole)

	for _, r := range apiUserRole {
		if r == "system" {
			t.Fatalf("UserRole must not contain `system` (it is a runtime-only actor, never stored)")
		}
	}
	// And `system` MUST still be a valid actor Role — guards against dropping it from Role.
	found := false
	for _, r := range apiRole {
		if r == "system" {
			found = true
		}
	}
	if !found {
		t.Fatalf("Role must still contain `system` (the runtime delivery-complete actor)")
	}
}
