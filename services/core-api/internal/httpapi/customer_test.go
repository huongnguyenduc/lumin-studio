package httpapi

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/auth"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
)

// These are the Docker-free half of PR-P1-r: the customer realm's classify wiring, its cryptographic
// isolation from the admin realm (the security-critical property), the register/login input guards
// that fire before any DB touch, and the account projection. The DB-backed register→login→orders flow
// is in customer_integration_test.go.

func TestClassifyCustomerRealm(t *testing.T) {
	public := []string{"RegisterCustomer", "LoginCustomer", "LogoutCustomer"}
	for _, op := range public {
		if got := classify(op); got != authPublic {
			t.Errorf("classify(%q) = %v, want authPublic", op, got)
		}
	}
	if got := classify("GetCustomerOrders"); got != authCustomer {
		t.Errorf("classify(GetCustomerOrders) = %v, want authCustomer", got)
	}
}

// resolveCustomer is the realm boundary: it must accept ONLY a token signed by the customer issuer's
// own secret and reject anything else — most importantly a token minted by the ADMIN realm (a
// different secret), even when copied into the customer cookie. This is what makes the two realms
// isolated (ADR-030), so it is proven directly.
func TestResolveCustomerRealmIsolation(t *testing.T) {
	custIssuer := auth.NewIssuer("customer-secret", time.Hour, true, auth.CustomerCookieName)
	adminIssuer := auth.NewIssuer("admin-secret", time.Hour, true, auth.SessionCookieName)
	srv := NewServer(slog.New(slog.NewTextHandler(io.Discard, nil)), nil, nil, nil, WithCustomerAuth(custIssuer))
	now := time.Now().UTC()

	reqWithCookie := func(name, value string) *http.Request {
		r := httptest.NewRequest(http.MethodGet, "/customer/orders", nil)
		r.AddCookie(&http.Cookie{Name: name, Value: value})
		return r
	}

	// A valid customer token resolves to its subject.
	want := uuid.New()
	custCookie, err := custIssuer.Issue(want.String(), customerTokenRole, now)
	if err != nil {
		t.Fatalf("issue customer token: %v", err)
	}
	if got, ok, err := srv.resolveCustomer(reqWithCookie(auth.CustomerCookieName, custCookie.Value)); !ok || err != nil || got != want {
		t.Fatalf("valid customer token → (%v,%v,%v), want (%v,true,nil)", got, ok, err, want)
	}

	// An ADMIN token copied into the customer cookie is rejected — different signing secret.
	adminCookie, err := adminIssuer.Issue(uuid.NewString(), "owner", now)
	if err != nil {
		t.Fatalf("issue admin token: %v", err)
	}
	if _, ok, err := srv.resolveCustomer(reqWithCookie(auth.CustomerCookieName, adminCookie.Value)); ok || err == nil {
		t.Fatal("an admin-realm token must NOT authenticate a customer request (realm isolation)")
	}

	// No cookie → anonymous (false, nil), not an error.
	if _, ok, err := srv.resolveCustomer(httptest.NewRequest(http.MethodGet, "/customer/orders", nil)); ok || err != nil {
		t.Fatalf("no cookie → (_,%v,%v), want (_,false,nil)", ok, err)
	}

	// A validly-signed token whose subject is not a uuid is rejected (can't scope a query).
	badSub, err := custIssuer.Issue("not-a-uuid", customerTokenRole, now)
	if err != nil {
		t.Fatalf("issue bad-sub token: %v", err)
	}
	if _, ok, err := srv.resolveCustomer(reqWithCookie(auth.CustomerCookieName, badSub.Value)); ok || err == nil {
		t.Fatal("a non-uuid subject must be rejected")
	}
}

// Registration input guards fire BEFORE any DB access (nil pool proves it), so a malformed request
// never reaches an INSERT. Password bounds are enforced here because oapi-codegen's strict-server
// does not validate the schema's min/maxLength.
func TestRegisterCustomerValidation(t *testing.T) {
	srv := NewServer(slog.New(slog.NewTextHandler(io.Discard, nil)), nil, nil, nil)
	ctx := context.Background()
	valid := func() *api.CustomerRegisterInput {
		return &api.CustomerRegisterInput{Name: "Mai Anh", Email: "mai@example.com", Phone: "0901234567", Password: "hunter2!!"}
	}
	cases := []struct {
		name string
		body *api.CustomerRegisterInput
	}{
		{"nil-body", nil},
		{"short-name", func() *api.CustomerRegisterInput { b := valid(); b.Name = "a"; return b }()},
		{"blank-name", func() *api.CustomerRegisterInput { b := valid(); b.Name = "   "; return b }()},
		{"long-name", func() *api.CustomerRegisterInput { b := valid(); b.Name = strings.Repeat("â", 61); return b }()},
		{"empty-phone", func() *api.CustomerRegisterInput { b := valid(); b.Phone = "  "; return b }()},
		{"blank-email", func() *api.CustomerRegisterInput { b := valid(); b.Email = "   "; return b }()},
		{"short-password", func() *api.CustomerRegisterInput { b := valid(); b.Password = "short7!"; return b }()},
		{"long-password", func() *api.CustomerRegisterInput { b := valid(); b.Password = strings.Repeat("a", 73); return b }()},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			resp, err := srv.RegisterCustomer(ctx, api.RegisterCustomerRequestObject{Body: tc.body})
			if err != nil {
				t.Fatalf("unexpected error (should be a 400 response, not an error): %v", err)
			}
			if _, ok := resp.(api.RegisterCustomer400JSONResponse); !ok {
				t.Fatalf("resp = %T, want RegisterCustomer400JSONResponse", resp)
			}
		})
	}
}

func TestLoginCustomerNilBody(t *testing.T) {
	srv := NewServer(slog.New(slog.NewTextHandler(io.Discard, nil)), nil, nil, nil)
	resp, err := srv.LoginCustomer(context.Background(), api.LoginCustomerRequestObject{Body: nil})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if _, ok := resp.(api.LoginCustomer400JSONResponse); !ok {
		t.Fatalf("resp = %T, want LoginCustomer400JSONResponse", resp)
	}
}

func TestToCustomerAccount(t *testing.T) {
	id := uuid.New()
	email := "buyer@example.com"
	got := toCustomerAccount(sqlc.Customer{ID: id, Name: "Buyer", Phone: "0900000000", Email: &email})
	if got.Id != id || got.Name != "Buyer" || got.Phone != "0900000000" || got.Email != openapi_types.Email(email) {
		t.Fatalf("account = %+v, want id/name/phone/email mapped", got)
	}
	// A nil email (defensive — a credentialed row always has one) must not panic; it maps to "".
	if nilEmail := toCustomerAccount(sqlc.Customer{ID: id, Name: "X", Phone: "0"}); nilEmail.Email != "" {
		t.Fatalf("nil email → %q, want empty", nilEmail.Email)
	}
}

// Wire tests: the customer realm is actually mounted and gated in NewRouter (nil pool — the rejection
// paths never reach the DB). They prove GET /customer/orders needs a valid CUSTOMER session and the
// admin cookie does not grant it.
func TestCustomerOrdersRequiresCustomerSession(t *testing.T) {
	adminIssuer := auth.NewIssuer("admin-secret", time.Hour, true, auth.SessionCookieName)
	custIssuer := auth.NewIssuer("customer-secret", time.Hour, true, auth.CustomerCookieName)
	wrongCust := auth.NewIssuer("some-other-secret", time.Hour, true, auth.CustomerCookieName)
	h := NewRouter(slog.New(slog.NewTextHandler(io.Discard, nil)), nil, nil, adminIssuer, WithCustomerAuth(custIssuer))
	now := time.Now().UTC()

	get := func(cookie *http.Cookie) int {
		req := httptest.NewRequest(http.MethodGet, "/customer/orders", nil)
		if cookie != nil {
			req.AddCookie(cookie)
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec.Code
	}

	if code := get(nil); code != http.StatusUnauthorized {
		t.Errorf("no cookie = %d, want 401", code)
	}
	// A valid ADMIN session cookie must not reach customer data (separate realm).
	adminCookie, _ := adminIssuer.Issue(uuid.NewString(), "owner", now)
	if code := get(adminCookie); code != http.StatusUnauthorized {
		t.Errorf("admin session cookie = %d, want 401 (wrong realm)", code)
	}
	// A customer cookie signed with the wrong secret is rejected (forged token).
	forged, _ := wrongCust.Issue(uuid.NewString(), customerTokenRole, now)
	if code := get(forged); code != http.StatusUnauthorized {
		t.Errorf("forged customer cookie = %d, want 401", code)
	}
}

func TestCustomerLogoutPublic(t *testing.T) {
	custIssuer := auth.NewIssuer("customer-secret", time.Hour, true, auth.CustomerCookieName)
	h := NewRouter(slog.New(slog.NewTextHandler(io.Discard, nil)), nil, nil, nil, WithCustomerAuth(custIssuer))
	req := httptest.NewRequest(http.MethodPost, "/customer/logout", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("POST /customer/logout w/o cookie = %d, want 204 (public)", rec.Code)
	}
	// The clear cookie is set (expires the customer session).
	if sc := rec.Result().Cookies(); len(sc) != 1 || sc[0].Name != auth.CustomerCookieName || sc[0].MaxAge >= 0 {
		t.Fatalf("logout Set-Cookie = %+v, want an expiring %s cookie", sc, auth.CustomerCookieName)
	}
}
