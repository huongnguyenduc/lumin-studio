package httpapi

import (
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/order"
)

// Docker-free unit tests for the P3-p customers DTO mappers. They pin the row→wire slot wiring (so a
// swapped field or a mis-summed total fails without a DB) and the two zero-shape edges the LEFT JOIN +
// jsonb decode produce: a customer with no orders (count 0, spent 0, lastOrderAt absent) and an empty
// address list (JSON `[]`, not `null`). totalSpent is asserted server-summed (always-must #2).
// strptr / mustParse are shared package test helpers (admin_filament_test.go / dashboard_test.go).

func TestAdminCustomersDTO(t *testing.T) {
	id1, id2 := uuid.New(), uuid.New()
	at := mustParse(t, "2026-07-02T09:00:00Z")
	rows := []sqlc.ListAdminCustomersRow{
		{
			ID: id1, Name: "Nguyễn An", Phone: "0901234567",
			Email: strptr("an@gmail.com"), SocialHandle: strptr("m.me/an.79"),
			OrderCount: 4, TotalSpent: 1_210_000,
			LastOrderAt: pgtype.Timestamptz{Time: at, Valid: true},
		},
		{ // a customer with NO orders: nil contact extras, zero aggregates, NULL last order
			ID: id2, Name: "Lê Cúc", Phone: "0907888222",
			Email: nil, SocialHandle: nil,
			OrderCount: 0, TotalSpent: 0, LastOrderAt: pgtype.Timestamptz{},
		},
	}
	got := adminCustomersDTO(rows)
	if len(got) != 2 {
		t.Fatalf("len = %d, want 2", len(got))
	}
	a := got[0]
	if a.Id != id1 || a.Name != "Nguyễn An" || a.Phone != "0901234567" || a.OrderCount != 4 || a.TotalSpent != 1_210_000 {
		t.Fatalf("row0 = %+v", a)
	}
	if a.Email == nil || string(*a.Email) != "an@gmail.com" {
		t.Fatalf("row0 email = %v, want an@gmail.com", a.Email)
	}
	if a.SocialHandle == nil || *a.SocialHandle != "m.me/an.79" {
		t.Fatalf("row0 social = %v", a.SocialHandle)
	}
	if a.LastOrderAt == nil || !a.LastOrderAt.Equal(at) {
		t.Fatalf("row0 lastOrderAt = %v, want %v", a.LastOrderAt, at)
	}
	b := got[1]
	if b.OrderCount != 0 || b.TotalSpent != 0 {
		t.Fatalf("row1 aggregates = (%d, %d), want (0, 0)", b.OrderCount, b.TotalSpent)
	}
	if b.Email != nil || b.SocialHandle != nil || b.LastOrderAt != nil {
		t.Fatalf("row1 should have nil email/social/lastOrderAt: %+v", b)
	}
}

func TestAdminCustomersDTOEmpty(t *testing.T) {
	// nil rows → a non-nil empty slice so the JSON renders `[]`, not `null` (spec §03 zero-state).
	got := adminCustomersDTO(nil)
	if got == nil || len(got) != 0 {
		t.Fatalf("empty = %#v, want non-nil empty slice", got)
	}
}

func TestAdminCustomerDetailDTO(t *testing.T) {
	custID := uuid.New()
	createdAt := mustParse(t, "2026-06-01T08:00:00Z")
	cust := sqlc.Customer{
		ID: custID, Name: "Nguyễn An", Phone: "0901234567",
		Email: strptr("an@gmail.com"), SocialHandle: strptr("m.me/an.79"),
		Addresses: []byte(`[{"province":"TP.HCM","ward":"Bến Thành","street":"123 Lê Lợi"}]`),
		CreatedAt: pgtype.Timestamptz{Time: createdAt, Valid: true},
	}
	o1, o2 := uuid.New(), uuid.New()
	at1 := mustParse(t, "2026-06-18T09:00:00Z")
	at2 := mustParse(t, "2026-06-10T09:00:00Z")
	orders := []sqlc.Order{ // ByCustomer returns newest-first; the DTO preserves that order
		{ID: o1, Code: "#LM2048", Status: order.Printing, Total: 445_000, CreatedAt: pgtype.Timestamptz{Time: at1, Valid: true}},
		{ID: o2, Code: "#LM1990", Status: order.Completed, Total: 180_000, CreatedAt: pgtype.Timestamptz{Time: at2, Valid: true}},
	}
	got, err := adminCustomerDetailDTO(cust, orders)
	if err != nil {
		t.Fatalf("detail: %v", err)
	}
	if got.Id != custID || got.Name != "Nguyễn An" || got.Phone != "0901234567" {
		t.Fatalf("contact = %+v", got)
	}
	if got.TotalSpent != 625_000 { // 445k + 180k, summed server-side (always-must #2)
		t.Fatalf("totalSpent = %d, want 625000", got.TotalSpent)
	}
	if len(got.Addresses) != 1 || got.Addresses[0].Street != "123 Lê Lợi" || got.Addresses[0].Province != "TP.HCM" {
		t.Fatalf("addresses = %+v", got.Addresses)
	}
	if len(got.Orders) != 2 || got.Orders[0].Code != "#LM2048" ||
		got.Orders[0].Status != api.OrderStatus(order.Printing) || got.Orders[0].Total != 445_000 {
		t.Fatalf("orders[0] = %+v", got.Orders)
	}
	if got.Orders[1].Code != "#LM1990" || got.Orders[1].Status != api.OrderStatus(order.Completed) {
		t.Fatalf("orders[1] = %+v", got.Orders[1])
	}
}

func TestAdminCustomerDetailDTOEmptyShapes(t *testing.T) {
	// A customer with no addresses + no orders → non-nil empty slices (JSON `[]`), totalSpent 0.
	cust := sqlc.Customer{
		ID: uuid.New(), Name: "Lê Cúc", Phone: "0907888222",
		Addresses: []byte(`[]`), CreatedAt: pgtype.Timestamptz{Time: mustParse(t, "2026-06-01T08:00:00Z"), Valid: true},
	}
	got, err := adminCustomerDetailDTO(cust, nil)
	if err != nil {
		t.Fatalf("detail: %v", err)
	}
	if got.Addresses == nil || len(got.Addresses) != 0 {
		t.Fatalf("addresses = %#v, want non-nil empty", got.Addresses)
	}
	if got.Orders == nil || len(got.Orders) != 0 {
		t.Fatalf("orders = %#v, want non-nil empty", got.Orders)
	}
	if got.TotalSpent != 0 || got.Email != nil || got.SocialHandle != nil {
		t.Fatalf("zero-shape wrong: %+v", got)
	}
}

func TestDecodeAddresses(t *testing.T) {
	// nil / empty / '[]' jsonb → a non-nil empty slice; a NULL column (len 0) never panics.
	for _, raw := range [][]byte{nil, {}, []byte(`[]`)} {
		got, err := decodeAddresses(raw)
		if err != nil || got == nil || len(got) != 0 {
			t.Fatalf("decodeAddresses(%q) = (%#v, %v), want empty non-nil", raw, got, err)
		}
	}
	// malformed jsonb → error (a corrupt store is a 500, never a silently-dropped address).
	if _, err := decodeAddresses([]byte(`{not json`)); err == nil {
		t.Fatal("malformed addresses jsonb should error")
	}
}
