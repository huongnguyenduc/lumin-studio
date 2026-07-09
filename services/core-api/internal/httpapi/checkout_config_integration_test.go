package httpapi

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"testing"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
)

// Integration tests for the public checkout config + the web checkout STK gate (PR-P2-a) against real
// Postgres (testcontainers: skip local without Docker, run in CI — ADR-020). They assert the 200
// whitelist (STK + server-built VietQR URL + shippable provinces + refund policy, nothing else), the
// 422 NO_STK_CONFIGURED signal when the shop has no STK, and that the SAME gate refuses a web POST
// /orders BEFORE any row is written.

func TestGetCheckoutConfigEndToEnd(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()
	setShippingRules(t, ctx, pool, `[{"province":"Hà Nội","fee":30000},{"province":"*","fee":45000},{"province":"Hồ Chí Minh","fee":30000}]`)
	setBankAccount(t, ctx, pool)
	if _, err := pool.Exec(ctx, `UPDATE settings SET refund_policy = 'Đổi trả trong 7 ngày' WHERE id = true`); err != nil {
		t.Fatalf("seed refund policy: %v", err)
	}
	srv := NewServer(slog.New(slog.NewTextHandler(io.Discard, nil)), pool, nil, nil)

	resp, err := srv.GetCheckoutConfig(ctx, api.GetCheckoutConfigRequestObject{})
	if err != nil {
		t.Fatalf("GetCheckoutConfig: %v", err)
	}
	cfg, ok := resp.(api.GetCheckoutConfig200JSONResponse)
	if !ok {
		t.Fatalf("resp = %T, want 200 CheckoutConfig", resp)
	}

	if cfg.BankAccount.Bin == nil || *cfg.BankAccount.Bin != "970436" ||
		cfg.BankAccount.AccountNumber == nil || *cfg.BankAccount.AccountNumber != "0011001234567" {
		t.Fatalf("bankAccount = %+v, want the seeded STK", cfg.BankAccount)
	}
	// VietQR URL is server-built from the stored STK (no client input) — bin + accountNumber in the path.
	if want := "https://img.vietqr.io/image/970436-0011001234567-compact2.png?accountName=LUMIN+STUDIO"; cfg.VietqrUrl != want {
		t.Fatalf("vietqrUrl = %q, want %q", cfg.VietqrUrl, want)
	}
	// Shippable provinces = shipping_rules keys, "*" wildcard excluded.
	if len(cfg.ShippableProvinces) != 2 ||
		cfg.ShippableProvinces[0] != "Hà Nội" || cfg.ShippableProvinces[1] != "Hồ Chí Minh" {
		t.Fatalf("shippableProvinces = %v, want [Hà Nội, Hồ Chí Minh] (no \"*\")", cfg.ShippableProvinces)
	}
	if cfg.RefundPolicy != "Đổi trả trong 7 ngày" {
		t.Fatalf("refundPolicy = %q, want the seeded text", cfg.RefundPolicy)
	}
}

func TestGetCheckoutConfigNoSTKConfigured(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()
	// Fresh seed leaves bank_account `{}` — no STK. Shipping rules present, but there is still no way
	// to take a web payment, so the config is 422, not a half-config with an unrenderable QR.
	setShippingRules(t, ctx, pool, `[{"province":"*","fee":45000}]`)
	srv := NewServer(slog.New(slog.NewTextHandler(io.Discard, nil)), pool, nil, nil, WithPaymentProofUploads(newTestProofStore()))

	_, err := srv.GetCheckoutConfig(ctx, api.GetCheckoutConfigRequestObject{})
	if err == nil {
		t.Fatal("GetCheckoutConfig with no STK must error (NO_STK_CONFIGURED)")
	}
	if status, env := mapError(err); status != http.StatusUnprocessableEntity || env.Code != codeNoSTK {
		t.Fatalf("mapError = %d/%s, want 422/%s", status, env.Code, codeNoSTK)
	}
}

// The web checkout STK gate: a web POST /orders against a shop with no STK is refused with 422
// NO_STK_CONFIGURED BEFORE any write — no customer/order row is left behind. (Inbox is unaffected: it
// is staff-created and born-PAID; covered by TestCreateOrderInboxStaffEndToEnd, which seeds no STK.)
func TestCreateOrderWebRequiresSTK(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()
	fx := seedCheckoutCatalog(t, ctx, pool)
	setShippingRules(t, ctx, pool, `[{"province":"*","fee":45000}]`)
	// Deliberately NO setBankAccount — the shop has no STK.
	srv := NewServer(slog.New(slog.NewTextHandler(io.Discard, nil)), pool, nil, nil)

	raw := webBody(map[string]any{
		"items": []any{map[string]any{"productId": fx.product.ID.String(), "quantity": 1}},
	})
	_, err := srv.CreateOrder(ctx, api.CreateOrderRequestObject{Body: mkCreateOrderBody(t, raw)})
	if err == nil {
		t.Fatal("web create with no STK must be refused")
	}
	if status, env := mapError(err); status != http.StatusUnprocessableEntity || env.Code != codeNoSTK {
		t.Fatalf("mapError = %d/%s, want 422/%s", status, env.Code, codeNoSTK)
	}
	// Gate fires before the tx — no customer or order row written.
	var n int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM orders`).Scan(&n); err != nil {
		t.Fatalf("count orders: %v", err)
	}
	if n != 0 {
		t.Fatalf("orders after refused create = %d, want 0 (gate must precede any write)", n)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM customers`).Scan(&n); err != nil {
		t.Fatalf("count customers: %v", err)
	}
	if n != 0 {
		t.Fatalf("customers after refused create = %d, want 0", n)
	}
}
