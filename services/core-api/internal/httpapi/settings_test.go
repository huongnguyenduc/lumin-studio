package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/order"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/pricing"
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

// Every settings/config WRITE is owner-only (staff không sửa cài đặt). Each rejects a staff actor with
// 403 and an absent actor with 401 BEFORE any DB touch (nil pool) — defense in depth behind the
// authOwnerOnly boundary gate, so a classify() regress cannot let staff write settings.
func TestSettingsWritesAreOwnerOnly(t *testing.T) {
	srv := NewServer(slog.New(slog.NewTextHandler(io.Discard, nil)), nil, nil, nil)
	id := uuid.New()
	calls := map[string]func(context.Context) error{
		"UpdateShippingRules": func(ctx context.Context) error {
			_, err := srv.UpdateShippingRules(ctx, api.UpdateShippingRulesRequestObject{Body: &api.ShippingRulesUpdate{}})
			return err
		},
		"UpdateRefundPolicy": func(ctx context.Context) error {
			_, err := srv.UpdateRefundPolicy(ctx, api.UpdateRefundPolicyRequestObject{Body: &api.RefundPolicyUpdate{}})
			return err
		},
		"CreateReplyTemplate": func(ctx context.Context) error {
			_, err := srv.CreateReplyTemplate(ctx, api.CreateReplyTemplateRequestObject{Body: &api.ReplyTemplateInput{Title: "x", Body: "y"}})
			return err
		},
		"UpdateReplyTemplate": func(ctx context.Context) error {
			_, err := srv.UpdateReplyTemplate(ctx, api.UpdateReplyTemplateRequestObject{Id: id, Body: &api.ReplyTemplateInput{Title: "x", Body: "y"}})
			return err
		},
		"DeleteReplyTemplate": func(ctx context.Context) error {
			_, err := srv.DeleteReplyTemplate(ctx, api.DeleteReplyTemplateRequestObject{Id: id})
			return err
		},
	}
	for name, call := range calls {
		t.Run(name+"/staff→403", func(t *testing.T) {
			ctx := withActor(context.Background(), Actor{ByUser: uuid.NewString(), Role: order.RoleStaff, At: time.Now().UTC()})
			if err := call(ctx); !errors.Is(err, errForbidden) {
				t.Fatalf("staff: err = %v, want errForbidden", err)
			}
		})
		t.Run(name+"/no-actor→401", func(t *testing.T) {
			if err := call(context.Background()); !errors.Is(err, errUnauthenticated) {
				t.Fatalf("no actor: err = %v, want errUnauthenticated", err)
			}
		})
	}
}

// cleanShippingRules must produce EXACTLY the shape the checkout fee resolver reads: the test marshals
// the cleaned rows and feeds them back through pricing.ShippingFee. This is the load-bearing link — a
// shape drift here would silently misroute every order's shipping fee.
func TestCleanShippingRules(t *testing.T) {
	ok, fields := cleanShippingRules([]api.ShippingRule{
		{Province: " Nội thành TP.HCM ", Fee: 25000},
		{Province: "*", Fee: 40000},
	})
	if len(fields) != 0 {
		t.Fatalf("valid rules rejected: %v", fields)
	}
	if len(ok) != 2 || ok[0].Province != "Nội thành TP.HCM" || ok[0].Fee != 25000 || ok[1].Province != "*" {
		t.Fatalf("clean wrong: %+v", ok)
	}
	blob, _ := json.Marshal(ok)
	if fee, err := pricing.ShippingFee(blob, "Nội thành TP.HCM", ""); err != nil || fee != 25000 {
		t.Fatalf("resolver on cleaned rules: fee=%d err=%v", fee, err)
	}
	if fee, err := pricing.ShippingFee(blob, "Somewhere Else", ""); err != nil || fee != 40000 {
		t.Fatalf("wildcard fallback: fee=%d err=%v", fee, err)
	}
	// An empty table is valid (owner clearing to rebuild).
	if _, f := cleanShippingRules([]api.ShippingRule{}); len(f) != 0 {
		t.Fatalf("empty table should be valid: %v", f)
	}
	bad := map[string][]api.ShippingRule{
		"negative fee":   {{Province: "Hà Nội", Fee: -1}},
		"empty province": {{Province: "  ", Fee: 1000}},
		"dup province":   {{Province: "Hà Nội", Fee: 1000}, {Province: "Hà Nội", Fee: 2000}},
	}
	for name, in := range bad {
		t.Run(name, func(t *testing.T) {
			if _, f := cleanShippingRules(in); len(f) == 0 {
				t.Fatalf("%s: expected a field error, got none", name)
			}
		})
	}
}

func TestExtractTemplateVariables(t *testing.T) {
	got := extractTemplateVariables("Phí ship {phí}, giao {ngày}. Nhắc lại {phí}. CK {STK}")
	want := []string{"{phí}", "{ngày}", "{STK}"}
	if len(got) != len(want) {
		t.Fatalf("got %v, want %v (dedup + order)", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("order/dedup wrong: got %v, want %v", got, want)
		}
	}
	if v := extractTemplateVariables("no tokens here"); v == nil || len(v) != 0 {
		t.Fatalf("no tokens must be non-nil empty, got %v", v)
	}
}

func TestCleanReplyTemplateInput(t *testing.T) {
	title, body, vars, fields := cleanReplyTemplateInput(api.ReplyTemplateInput{
		Title: "  Báo phí ship  ", Body: "  Phí khu vực là {phí} nha  ",
	})
	if len(fields) != 0 {
		t.Fatalf("valid rejected: %v", fields)
	}
	if title != "Báo phí ship" || body != "Phí khu vực là {phí} nha" {
		t.Fatalf("trim wrong: %q / %q", title, body)
	}
	if len(vars) != 1 || vars[0] != "{phí}" {
		t.Fatalf("derived vars = %v", vars)
	}
	bad := map[string]api.ReplyTemplateInput{
		"empty title": {Title: "  ", Body: "x"},
		"empty body":  {Title: "x", Body: "  "},
		"long title":  {Title: strings.Repeat("a", maxReplyTitleChars+1), Body: "x"},
		"long body":   {Title: "x", Body: strings.Repeat("a", maxReplyBodyChars+1)},
	}
	for name, in := range bad {
		t.Run(name, func(t *testing.T) {
			if _, _, _, f := cleanReplyTemplateInput(in); len(f) == 0 {
				t.Fatalf("%s: expected field errors, got none", name)
			}
		})
	}
}
