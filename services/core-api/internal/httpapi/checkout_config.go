package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/pricing"
)

// checkout_config.go — the public checkout config surface (PR-P2-a): GET /checkout/config. It hands the
// anonymous storefront the data the payment step (C2) and the pre-purchase disclosure need — the VietQR
// STK, a server-built img.vietqr.io image URL derived from it, the shippable provinces, and the refund
// policy — and NOTHING else. It is a deliberate whitelist over the settings singleton: shopInfo contact
// PII and the shipping-fee table never cross this boundary. The same read also powers the web checkout
// STK gate in checkout.go (webPaymentBlocked): if the shop has no usable STK there is no way to take a
// web payment, so both this endpoint and a web POST /orders fail with 422 NO_STK_CONFIGURED.

// vietQRBaseURL is the VietQR image API host (D-P2-1 / ADR-010). The QR is built ENTIRELY server-side
// from the stored STK — no client-controllable field, no amount, no memo — so a client can never swap
// the destination account via a request param (conventions §Bảo mật; the static-QR-from-stored-STK rule).
const vietQRBaseURL = "https://img.vietqr.io"

// GetCheckoutConfig handles GET /checkout/config (public — classify → authPublic). It returns the STK,
// a server-built VietQR image URL, the shippable provinces, and the refund policy. When the shop has no
// usable STK it returns 422 NO_STK_CONFIGURED (the SAME signal a web POST /orders gives), never a
// half-config with an unrenderable QR.
func (s *Server) GetCheckoutConfig(ctx context.Context, _ api.GetCheckoutConfigRequestObject) (api.GetCheckoutConfigResponseObject, error) {
	row, err := db.NewSettings(s.pool).Get(ctx)
	if errors.Is(err, db.ErrNotFound) {
		// The singleton is seeded by migration 000007; its absence is a SERVER fault (broken seed), not
		// a client 404. Break the ErrNotFound chain so mapError renders a logged 500, not a NOT_FOUND.
		return nil, fmt.Errorf("checkout config: settings singleton missing (seed 000007)")
	}
	if err != nil {
		return nil, err
	}

	acct, ok := stkFromSettings(row.BankAccount)
	if !ok {
		// No usable STK → no web payment possible. 422, not a blank/partial config (P2-a gate).
		return nil, errNoSTKConfigured
	}

	// Decode the STK into the wire shape too (mirrors settingsDTO); acct carries the plain-string copy
	// the URL builder and the gate use without nil-pointer handling.
	var bank api.BankAccount
	if err := json.Unmarshal(row.BankAccount, &bank); err != nil {
		return nil, fmt.Errorf("checkout config: decode bank_account: %w", err)
	}

	provinces, err := shippableProvinces(row.ShippingRules)
	if err != nil {
		return nil, err // malformed shipping_rules → 500 (server config fault, like checkout's path)
	}

	return api.GetCheckoutConfig200JSONResponse(api.CheckoutConfig{
		BankAccount:        bank,
		VietqrUrl:          vietQRImageURL(acct),
		ShippableProvinces: provinces,
		RefundPolicy:       row.RefundPolicy,
	}), nil
}

// stkFromSettings decodes the stored bank_account and reports whether it is USABLE for payment: a
// non-empty bin AND accountNumber (the two fields the VietQR image URL is built from; accountName is a
// display label). An unset / `{}` / partial STK → ok=false, so the caller returns 422. The write path
// (cleanBankUpdate) already enforces the digit/length shape before storing, so the read side gates on
// presence only — it does not re-validate a value the STK-change boundary guaranteed.
// ponytail: presence gate, not a re-validation — the write boundary owns the STK shape.
func stkFromSettings(raw []byte) (bankAccountRecord, bool) {
	var rec bankAccountRecord
	if len(raw) == 0 {
		return rec, false
	}
	if err := json.Unmarshal(raw, &rec); err != nil {
		return rec, false
	}
	rec.Bin = strings.TrimSpace(rec.Bin)
	rec.AccountNumber = strings.TrimSpace(rec.AccountNumber)
	rec.AccountName = strings.TrimSpace(rec.AccountName)
	if rec.Bin == "" || rec.AccountNumber == "" {
		return rec, false
	}
	return rec, true
}

// vietQRImageURL builds the static VietQR image URL for an STK (D-P2-1). The "compact2" template renders
// the QR with the bank logo + account block; accountName is passed for that rendered label (server-stored,
// not client input). No amount/addInfo — the memo is optional and NOT baked into the QR (ADR-010).
// ponytail: the template is the one tunable knob — swap "compact2"→"qr_only" if a bare QR is wanted.
func vietQRImageURL(acct bankAccountRecord) string {
	u := fmt.Sprintf("%s/image/%s-%s-compact2.png", vietQRBaseURL, acct.Bin, acct.AccountNumber)
	if acct.AccountName != "" {
		u += "?accountName=" + url.QueryEscape(acct.AccountName)
	}
	return u
}

// shippableProvinces returns the province names the shop ships to — the keys of settings.shipping_rules,
// with the "*" wildcard EXCLUDED (it is a flat-fee fallback for unlisted provinces, not a selectable
// destination) and duplicates collapsed. It reuses pricing.ShippingRule so the shape can never drift
// from the fee resolver. A malformed shipping_rules is a server config fault → surfaced as an error
// (500), consistent with checkout treating pricing.ErrMalformedShippingRules as non-client. Returns a
// non-nil slice so the JSON renders `[]`, not `null`.
func shippableProvinces(raw []byte) ([]string, error) {
	out := []string{}
	if len(raw) == 0 {
		return out, nil
	}
	var rules []pricing.ShippingRule
	if err := json.Unmarshal(raw, &rules); err != nil {
		return nil, fmt.Errorf("checkout config: %w", pricing.ErrMalformedShippingRules)
	}
	seen := make(map[string]struct{}, len(rules))
	for _, r := range rules {
		if r.Fee < 0 {
			// Same malformed condition pricing.ShippingFee rejects (pricing.go): a negative fee is a
			// corrupt config. Checked at loop-top for EVERY rule (incl. "*") so this stays in lockstep
			// with the fee resolver — a province listed here must never be one checkout would 500 on.
			return nil, fmt.Errorf("checkout config: %w", pricing.ErrMalformedShippingRules)
		}
		p := strings.TrimSpace(r.Province)
		if p == "" || p == "*" {
			continue
		}
		if _, dup := seen[p]; dup {
			continue
		}
		seen[p] = struct{}{}
		out = append(out, p)
	}
	return out, nil
}
