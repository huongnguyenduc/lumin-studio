package db

import (
	"context"
	"errors"
	"regexp"
	"testing"

	"github.com/google/uuid"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
)

// Integration tests for the PR-3f order-intake prerequisites (by-id catalog read, order-code
// sequence, customer find-or-create, idempotent consent). testcontainers: skips local (no Docker),
// runs in CI (ADR-020). Reuses seedProduct / seedCustomer from the catalog_test / identity_test
// helpers in this package.

func TestProductByID(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()
	cat := NewCatalog(pool)

	p := seedProduct(t, ctx, cat, "den-mat-trang", 390_000)
	got, err := cat.ProductByID(ctx, p.ID)
	if err != nil {
		t.Fatalf("ProductByID: %v", err)
	}
	if got.ID != p.ID || got.BasePrice != 390_000 {
		t.Fatalf("got %+v, want id %s base 390000", got, p.ID)
	}
	if _, err := cat.ProductByID(ctx, uuid.New()); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing product err = %v, want ErrNotFound", err)
	}
}

// NextOrderCode mints distinct, monotonic, well-formed codes minted inside a tx.
func TestNextOrderCode(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()

	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	orders := NewOrders(tx)
	format := regexp.MustCompile(`^#LMN-\d{4,}$`)
	seen := map[string]struct{}{}
	var prev string
	for i := 0; i < 3; i++ {
		code, err := orders.NextOrderCode(ctx)
		if err != nil {
			t.Fatalf("NextOrderCode: %v", err)
		}
		if !format.MatchString(code) {
			t.Fatalf("code %q does not match #LMN-<n>", code)
		}
		if _, dup := seen[code]; dup {
			t.Fatalf("duplicate code %q", code)
		}
		seen[code] = struct{}{}
		if prev != "" && code <= prev {
			t.Fatalf("code %q not after %q (sequence not monotonic)", code, prev)
		}
		prev = code
	}
	// START WITH 1000 → the first code in a fresh DB is #LMN-1000.
	if _, ok := seen["#LMN-1000"]; !ok {
		t.Fatalf("first code was not #LMN-1000: %v", seen)
	}
}

// FindOrCreateCustomer creates a new customer on a fresh phone and returns the existing one
// (created=false, name untouched) on a repeat — no duplicate row.
func TestFindOrCreateCustomer(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()
	idn := NewIdentity(pool)

	addresses := []byte(`[{"province":"Hà Nội","ward":"Cửa Nam","street":"12 Hàng Bài"}]`)
	arg := sqlc.InsertCustomerParams{ID: uuid.New(), Name: "Nguyễn An", Phone: "0912345678", Addresses: addresses}

	first, created, err := idn.FindOrCreateCustomer(ctx, arg)
	if err != nil || !created {
		t.Fatalf("first: created=%v err=%v, want true nil", created, err)
	}

	// Same phone, different id/name → returns the existing row, does not create or overwrite.
	repeat := sqlc.InsertCustomerParams{ID: uuid.New(), Name: "Someone Else", Phone: "0912345678", Addresses: addresses}
	again, created, err := idn.FindOrCreateCustomer(ctx, repeat)
	if err != nil {
		t.Fatalf("repeat: %v", err)
	}
	if created {
		t.Fatal("repeat created a second customer for the same phone")
	}
	if again.ID != first.ID || again.Name != "Nguyễn An" {
		t.Fatalf("repeat returned %+v, want the original id %s name 'Nguyễn An'", again, first.ID)
	}
}

// GrantConsentIfAbsent is idempotent: granting the same active (scope, channel) twice leaves
// exactly one active grant (no partial-unique violation).
func TestGrantConsentIfAbsent(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()
	idn := NewIdentity(pool)

	cust := seedCustomer(t, ctx, idn, "0987654321")
	grant := func() {
		if err := idn.GrantConsentIfAbsent(ctx, sqlc.InsertConsentGrantIfAbsentParams{
			ID: uuid.New(), CustomerID: cust.ID,
			Scope: sqlc.ConsentScopeOrderFulfillment, Channel: sqlc.ConsentChannelWeb, PolicyVersion: "2026-01",
		}); err != nil {
			t.Fatalf("GrantConsentIfAbsent: %v", err)
		}
	}
	grant()
	grant() // second is a no-op, not a unique violation

	active, err := idn.ActiveConsents(ctx, cust.ID)
	if err != nil {
		t.Fatalf("ActiveConsents: %v", err)
	}
	if len(active) != 1 {
		t.Fatalf("active consents = %d, want 1 (idempotent)", len(active))
	}
}
