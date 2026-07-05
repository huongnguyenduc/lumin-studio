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

	"github.com/google/uuid"
	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/auth"
)

// Integration tests for the storefront customer realm (PR-P1-r) against real Postgres
// (testcontainers: skip local without Docker, run in CI). They cover the DB-backed half the
// Docker-free customer_test.go can't: register persists a bcrypt credential, login round-trips it,
// the uniform-401 and duplicate-409 paths, and GET /customer/orders scoped strictly by customer_id
// (both directly and over the full router with a valid session cookie).

// TestCustomerRegisterLoginFlow: register a credentialed account, confirm the hash is persisted and
// the email normalized, then log in (case-insensitively), and prove the uniform-401 (wrong password,
// unknown email) and duplicate-email-409 boundaries.
func TestCustomerRegisterLoginFlow(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()
	issuer := auth.NewIssuer("test-customer-secret", time.Hour, true, auth.CustomerCookieName)
	srv := NewServer(slog.New(slog.NewTextHandler(io.Discard, nil)), pool, nil, nil, WithCustomerAuth(issuer))

	reg := api.CustomerRegisterInput{
		Name: "Mai Anh", Email: openapi_types.Email("Mai@Example.com"), Phone: "0901234567", Password: "hunter2!!",
	}
	resp, err := srv.RegisterCustomer(ctx, api.RegisterCustomerRequestObject{Body: &reg})
	if err != nil {
		t.Fatalf("RegisterCustomer: %v", err)
	}
	created, ok := resp.(api.RegisterCustomer201JSONResponse)
	if !ok {
		t.Fatalf("register resp = %T, want 201", resp)
	}
	// Email is normalized (lower-cased) on the wire and in the DB; the register auto-logs-in.
	if created.Body.Email != openapi_types.Email("mai@example.com") {
		t.Errorf("account email = %q, want normalized mai@example.com", created.Body.Email)
	}
	if created.Headers.SetCookie == "" {
		t.Error("register must set the customer session cookie (auto-login)")
	}

	var hash *string
	var email string
	if err := pool.QueryRow(ctx, `SELECT password_hash, email FROM customers WHERE id=$1`, created.Body.Id).Scan(&hash, &email); err != nil {
		t.Fatalf("read persisted customer: %v", err)
	}
	if hash == nil || *hash == "" {
		t.Fatal("password_hash not persisted")
	}
	if email != "mai@example.com" {
		t.Errorf("stored email = %q, want normalized", email)
	}

	// Login with the correct credential (email in a DIFFERENT case) → 200, cookie set.
	login := func(pw, addr string) api.LoginCustomerResponseObject {
		r, lerr := srv.LoginCustomer(ctx, api.LoginCustomerRequestObject{
			Body: &api.LoginRequest{Email: openapi_types.Email(addr), Password: pw},
		})
		if lerr != nil {
			t.Fatalf("LoginCustomer: %v", lerr)
		}
		return r
	}
	okResp, ok := login("hunter2!!", "MAI@example.com").(api.LoginCustomer200JSONResponse)
	if !ok {
		t.Fatal("correct credential (case-insensitive email) must log in")
	}
	if okResp.Body.Id != created.Body.Id || okResp.Headers.SetCookie == "" {
		t.Errorf("login body/cookie = %+v, want the registered id + a Set-Cookie", okResp)
	}

	// Wrong password and unknown email are the SAME uniform 401 (no enumeration).
	if _, ok := login("wrong-password", "mai@example.com").(api.LoginCustomer401JSONResponse); !ok {
		t.Error("wrong password must be 401")
	}
	if _, ok := login("hunter2!!", "nobody@example.com").(api.LoginCustomer401JSONResponse); !ok {
		t.Error("unknown email must be 401")
	}

	// A guest customer sharing the same phone can NOT be logged into (no credential) — prove the
	// login excludes non-credentialed rows even when a phone collides.
	if _, err := pool.Exec(ctx, `INSERT INTO customers (id, name, phone, email) VALUES ($1,$2,$3,$4)`,
		uuid.New(), "Guest", "0901234567", "guest@example.com"); err != nil {
		t.Fatalf("seed guest: %v", err)
	}
	if _, ok := login("anything!!", "guest@example.com").(api.LoginCustomer401JSONResponse); !ok {
		t.Error("a credential-less guest row must never authenticate")
	}

	// Duplicate registration (same login email, any case) → 409 EMAIL_TAKEN, no second account.
	dupResp, err := srv.RegisterCustomer(ctx, api.RegisterCustomerRequestObject{Body: &api.CustomerRegisterInput{
		Name: "Impostor", Email: openapi_types.Email("MAI@EXAMPLE.COM"), Phone: "0907654321", Password: "different1",
	}})
	if err != nil {
		t.Fatalf("duplicate register errored instead of 409: %v", err)
	}
	if _, ok := dupResp.(api.RegisterCustomer409JSONResponse); !ok {
		t.Fatalf("duplicate email resp = %T, want 409", dupResp)
	}
	var credentialed int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM customers WHERE lower(email)='mai@example.com' AND password_hash IS NOT NULL`).Scan(&credentialed); err != nil {
		t.Fatalf("count credentialed: %v", err)
	}
	if credentialed != 1 {
		t.Fatalf("credentialed accounts for the email = %d, want 1 (duplicate rejected at the DB)", credentialed)
	}
}

// TestGetCustomerOrdersScoped: a customer sees ONLY their own orders (scoped by customer_id), as the
// public timeline projection, both via the handler and over the full router with a valid session
// cookie. A different id sees nothing; a request with no customer in context fails closed.
func TestGetCustomerOrdersScoped(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()
	fx := seedCheckoutCatalog(t, ctx, pool)
	setShippingRules(t, ctx, pool, `[{"province":"*","fee":45000}]`)
	setBankAccount(t, ctx, pool) // P2-a: web orders need a configured STK
	issuer := auth.NewIssuer("test-customer-secret", time.Hour, true, auth.CustomerCookieName)
	srv := NewServer(slog.New(slog.NewTextHandler(io.Discard, nil)), pool, nil, nil, WithCustomerAuth(issuer))

	placeOrder := func(phone string) api.Order {
		return mustCreateOrder(t, srv, ctx, webBody(map[string]any{
			"customer": map[string]any{"name": "Khách " + phone, "phone": phone},
			"items":    []any{map[string]any{"productId": fx.product.ID.String(), "quantity": 1}},
		}))
	}
	dtoA := placeOrder("0900000001")
	_ = placeOrder("0900000002") // a second customer's order — must NOT leak into A's history

	custID := func(code string) uuid.UUID {
		var id uuid.UUID
		if err := pool.QueryRow(ctx, `SELECT customer_id FROM orders WHERE code=$1`, code).Scan(&id); err != nil {
			t.Fatalf("read customer_id for %s: %v", code, err)
		}
		return id
	}
	custA := custID(dtoA.Code)

	// Direct handler: custA's context returns exactly custA's one order, as a timeline (no money).
	resp, err := srv.GetCustomerOrders(withCustomer(ctx, custA), api.GetCustomerOrdersRequestObject{})
	if err != nil {
		t.Fatalf("GetCustomerOrders: %v", err)
	}
	list, ok := resp.(api.GetCustomerOrders200JSONResponse)
	if !ok {
		t.Fatalf("resp = %T, want 200", resp)
	}
	if len(list) != 1 || list[0].Code != dtoA.Code || list[0].Status != "PENDING_CONFIRM" {
		t.Fatalf("custA history = %+v, want exactly custA's PENDING_CONFIRM order", list)
	}

	// An unknown customer id → empty (never an error, never someone else's rows).
	empty, err := srv.GetCustomerOrders(withCustomer(ctx, uuid.New()), api.GetCustomerOrdersRequestObject{})
	if err != nil {
		t.Fatalf("GetCustomerOrders(unknown): %v", err)
	}
	if l := empty.(api.GetCustomerOrders200JSONResponse); len(l) != 0 {
		t.Fatalf("unknown id history = %+v, want empty", l)
	}

	// No customer in context (a wiring bug, not an anonymous request) → fail closed.
	if _, err := srv.GetCustomerOrders(ctx, api.GetCustomerOrdersRequestObject{}); !errors.Is(err, errUnauthenticated) {
		t.Fatalf("no-actor GetCustomerOrders err = %v, want errUnauthenticated", err)
	}

	// Over the full router: a valid customer session cookie returns custA's order as a JSON array.
	h := NewRouter(slog.New(slog.NewTextHandler(io.Discard, nil)), pool, nil, nil, WithCustomerAuth(issuer))
	cookie, err := issuer.Issue(custA.String(), customerTokenRole, time.Now().UTC())
	if err != nil {
		t.Fatalf("issue session: %v", err)
	}
	req := httptest.NewRequest(http.MethodGet, "/customer/orders", nil)
	req.AddCookie(&http.Cookie{Name: auth.CustomerCookieName, Value: cookie.Value})
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("router GET /customer/orders w/ valid cookie = %d, want 200", rec.Code)
	}
	var body []map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("body not a JSON array: %v", err)
	}
	if len(body) != 1 || body[0]["code"] != dtoA.Code {
		t.Fatalf("router history = %v, want [custA's order]", body)
	}
	// The projection carries NO internal money/PII fields (ADR-032).
	for _, leaked := range []string{"total", "subtotal", "customer", "shippingAddress", "paymentProofUrl"} {
		if _, present := body[0][leaked]; present {
			t.Errorf("customer order history leaked %q", leaked)
		}
	}
}
