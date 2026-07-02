package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/order"
)

// A non-owner actor reaching the STK write is rejected 403 (errForbidden) BEFORE any DB touch —
// defense in depth behind the authOwnerOnly boundary gate, so a classify() regress can never let
// staff rewrite the STK. Docker-free: the handler returns before touching the (nil) pool.
func TestUpdateBankAccountRejectsNonOwner(t *testing.T) {
	srv := NewServer(slog.New(slog.NewTextHandler(io.Discard, nil)), nil, nil, nil)
	ctx := withActor(context.Background(), Actor{ByUser: uuid.NewString(), Role: order.RoleStaff, At: time.Now().UTC()})
	_, err := srv.UpdateBankAccount(ctx, api.UpdateBankAccountRequestObject{
		Body: &api.BankAccountUpdate{Bin: "970436", AccountNumber: "1023456789", AccountName: "LUMIN STUDIO"},
	})
	if !errors.Is(err, errForbidden) {
		t.Fatalf("staff STK write: err = %v, want errForbidden", err)
	}
}

// --- Docker-free unit -----------------------------------------------------------------

// cleanBankUpdate trims and validates the owner's STK change at the HTTP boundary — a money-out
// field, so an empty/garbage STK must be rejected loudly (per-field 400), not silently stored.
func TestCleanBankUpdate(t *testing.T) {
	rec, fields := cleanBankUpdate(api.BankAccountUpdate{
		Bin: " 970436 ", AccountNumber: " 1023456789 ", AccountName: " LUMIN STUDIO ",
	})
	if len(fields) != 0 {
		t.Fatalf("valid change rejected: %v", fields)
	}
	if rec.Bin != "970436" || rec.AccountNumber != "1023456789" || rec.AccountName != "LUMIN STUDIO" {
		t.Fatalf("trim wrong: %+v", rec)
	}

	bad := map[string]struct {
		in    api.BankAccountUpdate
		field string
	}{
		"empty bin":               {api.BankAccountUpdate{Bin: "  ", AccountNumber: "1", AccountName: "x"}, "bin"},
		"non-digit bin":           {api.BankAccountUpdate{Bin: "97O436", AccountNumber: "1", AccountName: "x"}, "bin"},
		"short bin (5 digits)":    {api.BankAccountUpdate{Bin: "97043", AccountNumber: "1", AccountName: "x"}, "bin"},
		"long bin (7 digits)":     {api.BankAccountUpdate{Bin: "9704360", AccountNumber: "1", AccountName: "x"}, "bin"},
		"empty accountNumber":     {api.BankAccountUpdate{Bin: "970436", AccountNumber: " ", AccountName: "x"}, "accountNumber"},
		"non-digit accountNumber": {api.BankAccountUpdate{Bin: "970436", AccountNumber: "12A45", AccountName: "x"}, "accountNumber"},
		"overlong accountNumber":  {api.BankAccountUpdate{Bin: "970436", AccountNumber: "123456789012345678901", AccountName: "x"}, "accountNumber"},
		"empty accountName":       {api.BankAccountUpdate{Bin: "970436", AccountNumber: "1", AccountName: ""}, "accountName"},
	}
	for name, tc := range bad {
		t.Run(name, func(t *testing.T) {
			_, f := cleanBankUpdate(tc.in)
			if _, ok := f[tc.field]; !ok {
				t.Fatalf("%s: expected a %q field error, got %v", name, tc.field, f)
			}
		})
	}
}

// settingsDTO decodes the jsonb columns into the typed contract shape.
func TestSettingsDTODecodesJSONB(t *testing.T) {
	row := sqlc.Setting{
		ShopInfo:      []byte(`{"name":"Lumin Studio"}`),
		BankAccount:   []byte(`{"bin":"970436","accountNumber":"123","accountName":"LUMIN"}`),
		ShippingRules: []byte(`[{"province":"Hà Nội","fee":30000}]`),
		RefundPolicy:  "đổi trả trong 3 ngày",
	}
	dto, err := settingsDTO(row)
	if err != nil {
		t.Fatal(err)
	}
	if dto.BankAccount.Bin == nil || *dto.BankAccount.Bin != "970436" {
		t.Fatalf("bin: %+v", dto.BankAccount)
	}
	if dto.RefundPolicy != "đổi trả trong 3 ngày" {
		t.Fatalf("refundPolicy = %q", dto.RefundPolicy)
	}
	if dto.ShopInfo == nil || (*dto.ShopInfo)["name"] != "Lumin Studio" {
		t.Fatalf("shopInfo: %+v", dto.ShopInfo)
	}
	if dto.ShippingRules == nil || len(*dto.ShippingRules) != 1 {
		t.Fatalf("shippingRules: %+v", dto.ShippingRules)
	}
}

// The seeded defaults ('{}' / '[]') decode to an empty (all-nil) BankAccount and non-nil empty rules.
func TestSettingsDTOEmptyJSONB(t *testing.T) {
	row := sqlc.Setting{ShopInfo: []byte(`{}`), BankAccount: []byte(`{}`), ShippingRules: []byte(`[]`)}
	dto, err := settingsDTO(row)
	if err != nil {
		t.Fatal(err)
	}
	if dto.BankAccount.Bin != nil || dto.BankAccount.AccountNumber != nil || dto.BankAccount.AccountName != nil {
		t.Fatalf("empty bank_account should decode to all-nil fields: %+v", dto.BankAccount)
	}
	if dto.ShippingRules == nil {
		t.Fatal("shippingRules should be non-nil empty, not nil")
	}
}

func TestReplyTemplatesDTO(t *testing.T) {
	rows := []sqlc.ReplyTemplate{{
		ID: uuid.New(), Title: "Chào", Body: "Xin chào {tên}", Variables: []byte(`["{tên}","{mã đơn}"]`),
	}}
	dtos, err := replyTemplatesDTO(rows)
	if err != nil {
		t.Fatal(err)
	}
	if len(dtos) != 1 || dtos[0].Title != "Chào" || len(dtos[0].Variables) != 2 || dtos[0].Variables[0] != "{tên}" {
		t.Fatalf("mapped wrong: %+v", dtos)
	}
	// A nil variables column renders [], never null.
	empty, err := replyTemplatesDTO([]sqlc.ReplyTemplate{{ID: uuid.New(), Variables: nil}})
	if err != nil {
		t.Fatal(err)
	}
	if empty[0].Variables == nil {
		t.Fatal("variables must render [] (non-nil), not null")
	}
	blob, _ := json.Marshal(empty[0])
	if !json.Valid(blob) {
		t.Fatal("reply template must marshal to valid JSON")
	}
}
