package db

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/google/uuid"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/auth"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
)

func seedCustomer(t *testing.T, ctx context.Context, idn *Identity, phone string) sqlc.Customer {
	t.Helper()
	// Address has province/ward/street (+name/phone) and NO district key (ADR-017).
	addresses := []byte(`[{"province":"Hà Nội","ward":"Cửa Nam","street":"12 Hàng Bài","name":"An","phone":"0900000000"}]`)
	c, err := idn.CreateCustomer(ctx, sqlc.InsertCustomerParams{
		ID: uuid.New(), Name: "Nguyễn An", Phone: phone, Email: nil, SocialHandle: nil, Addresses: addresses,
	})
	if err != nil {
		t.Fatalf("create customer: %v", err)
	}
	return c
}

func TestCustomerRoundTripNoDistrict(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()
	idn := NewIdentity(pool)

	c := seedCustomer(t, ctx, idn, "0901234567")
	if c.Email != nil {
		t.Fatalf("email = %v, want nil (not provided)", *c.Email)
	}

	got, err := idn.CustomerByPhone(ctx, "0901234567")
	if err != nil {
		t.Fatalf("by phone: %v", err)
	}
	if got.ID != c.ID || got.Name != "Nguyễn An" {
		t.Fatalf("customer round-trip mismatch: %+v", got)
	}

	var addrs []map[string]any
	if err := json.Unmarshal(got.Addresses, &addrs); err != nil {
		t.Fatalf("addresses unmarshal: %v", err)
	}
	if len(addrs) != 1 {
		t.Fatalf("addresses len = %d, want 1", len(addrs))
	}
	for _, key := range []string{"province", "ward", "street"} {
		if _, ok := addrs[0][key]; !ok {
			t.Fatalf("address missing %q: %v", key, addrs[0])
		}
	}
	if _, ok := addrs[0]["district"]; ok {
		t.Fatal("address must NOT carry a district key (ADR-017)")
	}

	if _, err := idn.CustomerByPhone(ctx, "0000000000"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unknown phone err = %v, want ErrNotFound", err)
	}
}

// PDPL: consent is append-then-mark. A fresh customer has NO active consent (nothing is
// pre-defaulted true); granting adds a row; withdrawing excludes it; re-granting after a
// withdrawal is a new active row (the audit trail is preserved).
func TestConsentAppendThenMark(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()
	idn := NewIdentity(pool)
	c := seedCustomer(t, ctx, idn, "0902000000")

	if active, err := idn.ActiveConsents(ctx, c.ID); err != nil || len(active) != 0 {
		t.Fatalf("fresh customer active consents = %d (err %v), want 0 — marketing must not be pre-defaulted", len(active), err)
	}

	grant := func() uuid.UUID {
		id := uuid.New()
		if _, err := idn.GrantConsent(ctx, sqlc.InsertConsentGrantParams{
			ID: id, CustomerID: c.ID, Scope: sqlc.ConsentScopeMarketing,
			Channel: sqlc.ConsentChannelWeb, PolicyVersion: "v1",
		}); err != nil {
			t.Fatalf("grant consent: %v", err)
		}
		return id
	}

	first := grant()
	if active, _ := idn.ActiveConsents(ctx, c.ID); len(active) != 1 {
		t.Fatalf("after grant active = %d, want 1", len(active))
	}

	if err := idn.WithdrawConsent(ctx, sqlc.WithdrawConsentParams{
		CustomerID: c.ID, Scope: sqlc.ConsentScopeMarketing, Channel: sqlc.ConsentChannelWeb,
	}); err != nil {
		t.Fatalf("withdraw: %v", err)
	}
	if active, _ := idn.ActiveConsents(ctx, c.ID); len(active) != 0 {
		t.Fatalf("after withdraw active = %d, want 0", len(active))
	}

	second := grant() // re-grant after withdrawal is a fresh active row
	active, _ := idn.ActiveConsents(ctx, c.ID)
	if len(active) != 1 {
		t.Fatalf("after re-grant active = %d, want 1", len(active))
	}
	// The re-grant must be a NEW row (append), not a resurrected/updated withdrawn one.
	if second == first || active[0].ID != second {
		t.Fatalf("re-grant must be a new row (id %v), not the withdrawn one (%v); active id = %v", second, first, active[0].ID)
	}
}

// At most one ACTIVE grant per (customer, scope, channel): a second active grant violates
// the partial unique index.
func TestConsentActiveUniqueness(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()
	idn := NewIdentity(pool)
	c := seedCustomer(t, ctx, idn, "0903000000")

	arg := sqlc.InsertConsentGrantParams{
		ID: uuid.New(), CustomerID: c.ID, Scope: sqlc.ConsentScopeMarketing,
		Channel: sqlc.ConsentChannelWeb, PolicyVersion: "v1",
	}
	if _, err := idn.GrantConsent(ctx, arg); err != nil {
		t.Fatalf("first grant: %v", err)
	}
	arg.ID = uuid.New() // fresh row id, same (customer, scope, channel), still active
	if _, err := idn.GrantConsent(ctx, arg); err == nil {
		t.Fatal("a second ACTIVE grant for the same (customer,scope,channel) must violate the partial unique index")
	}
}

func TestUserRoundTrip(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()
	idn := NewIdentity(pool)

	if _, err := idn.CreateUser(ctx, sqlc.InsertUserParams{
		ID: uuid.New(), Name: "Chủ tiệm", Email: "owner@lumin.vn", Role: sqlc.UserRoleOwner, Active: true,
	}); err != nil {
		t.Fatalf("create owner: %v", err)
	}
	if _, err := idn.CreateUser(ctx, sqlc.InsertUserParams{
		ID: uuid.New(), Name: "Nhân viên", Email: "staff@lumin.vn", Role: sqlc.UserRoleStaff, Active: true,
	}); err != nil {
		t.Fatalf("create staff: %v", err)
	}

	got, err := idn.UserByEmail(ctx, "owner@lumin.vn")
	if err != nil {
		t.Fatalf("by email: %v", err)
	}
	if got.Role != sqlc.UserRoleOwner {
		t.Fatalf("role = %q, want owner", got.Role)
	}
	// A user created without a credential (InsertUser) has a NULL password_hash — it exists for
	// attribution/RBAC but cannot log in (auth.VerifyPassword(nil, …) always fails, 000009).
	if got.PasswordHash != nil {
		t.Fatalf("password_hash = %q, want NULL for a credential-less user", *got.PasswordHash)
	}
	if _, err := idn.UserByEmail(ctx, "ghost@lumin.vn"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unknown email err = %v, want ErrNotFound", err)
	}
}

// UpsertOwnerCredential (make seed-owner) creates the first owner with a bcrypt hash, is
// idempotent on email (re-running rotates the password, keeps the row id), and the stored hash
// verifies via the same auth.VerifyPassword the login handler uses — proving the password_hash
// column wiring end-to-end against real Postgres.
func TestUpsertOwnerCredentialRoundTrip(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()
	idn := NewIdentity(pool)

	hash1, err := auth.HashPassword("first-pass-123")
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	u1, err := idn.UpsertOwnerCredential(ctx, sqlc.UpsertOwnerCredentialParams{
		ID: uuid.New(), Name: "Chủ shop", Email: "seed-owner@lumin.vn", PasswordHash: &hash1,
	})
	if err != nil {
		t.Fatalf("upsert: %v", err)
	}
	if u1.Role != sqlc.UserRoleOwner || !u1.Active {
		t.Fatalf("seeded role/active = %q/%v, want owner/true", u1.Role, u1.Active)
	}

	got, err := idn.UserByEmail(ctx, "seed-owner@lumin.vn")
	if err != nil {
		t.Fatalf("by email: %v", err)
	}
	if got.PasswordHash == nil || !auth.VerifyPassword(got.PasswordHash, "first-pass-123") {
		t.Fatal("stored hash must verify the seeded password")
	}

	// Re-run rotates the password and keeps the SAME row id (idempotent on the UNIQUE email).
	hash2, _ := auth.HashPassword("rotated-pass-456")
	u2, err := idn.UpsertOwnerCredential(ctx, sqlc.UpsertOwnerCredentialParams{
		ID: uuid.New(), Name: "Chủ shop", Email: "seed-owner@lumin.vn", PasswordHash: &hash2,
	})
	if err != nil {
		t.Fatalf("rotate: %v", err)
	}
	if u2.ID != u1.ID {
		t.Fatalf("rotate changed the row id %v -> %v, want stable (upsert on email)", u1.ID, u2.ID)
	}
	got2, _ := idn.UserByEmail(ctx, "seed-owner@lumin.vn")
	if !auth.VerifyPassword(got2.PasswordHash, "rotated-pass-456") || auth.VerifyPassword(got2.PasswordHash, "first-pass-123") {
		t.Fatal("after rotate ONLY the new password must verify")
	}
}
