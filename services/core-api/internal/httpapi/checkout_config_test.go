package httpapi

import (
	"errors"
	"strings"
	"testing"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/pricing"
)

// Docker-free unit tests for the checkout-config pure logic (PR-P2-a): the STK-usable gate, the
// server-built VietQR URL, and the shippable-province projection. These hold the money/QR-integrity
// behaviour; the handler 200/422 wiring + the web checkout gate are covered by the integration tests.

func TestStkFromSettingsGate(t *testing.T) {
	cases := []struct {
		name    string
		raw     string
		wantOK  bool
		wantBin string
	}{
		{"usable", `{"bin":"970436","accountNumber":"0011001234567","accountName":"LUMIN STUDIO"}`, true, "970436"},
		{"trims whitespace", `{"bin":" 970436 ","accountNumber":" 123 ","accountName":" LUMIN "}`, true, "970436"},
		{"empty object", `{}`, false, ""},
		{"nil bytes", ``, false, ""},
		{"missing accountNumber", `{"bin":"970436","accountName":"LUMIN"}`, false, "970436"},
		{"missing bin", `{"accountNumber":"123","accountName":"LUMIN"}`, false, ""},
		{"blank bin", `{"bin":"   ","accountNumber":"123"}`, false, ""},
		{"json null", `null`, false, ""},
		{"malformed json", `{"bin":`, false, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec, ok := stkFromSettings([]byte(tc.raw))
			if ok != tc.wantOK {
				t.Fatalf("ok = %v, want %v", ok, tc.wantOK)
			}
			if ok && rec.Bin != tc.wantBin {
				t.Errorf("bin = %q, want %q (trimmed)", rec.Bin, tc.wantBin)
			}
		})
	}
}

func TestVietQRImageURLServerBuilt(t *testing.T) {
	got := vietQRImageURL(bankAccountRecord{Bin: "970436", AccountNumber: "0011001234567", AccountName: "LUMIN STUDIO"})
	want := "https://img.vietqr.io/image/970436-0011001234567-compact2.png?accountName=LUMIN+STUDIO"
	if got != want {
		t.Fatalf("vietQRImageURL = %q, want %q", got, want)
	}
	// No accountName → no query string (still a valid static QR).
	if got := vietQRImageURL(bankAccountRecord{Bin: "970436", AccountNumber: "123"}); got != "https://img.vietqr.io/image/970436-123-compact2.png" {
		t.Errorf("no-name URL = %q", got)
	}
	// accountName is URL-escaped, not concatenated raw (a Vietnamese/space name must not break the URL).
	got = vietQRImageURL(bankAccountRecord{Bin: "970407", AccountNumber: "9", AccountName: "Nguyễn Studio & Co"})
	if want := "accountName=Nguy%E1%BB%85n+Studio+%26+Co"; !strings.Contains(got, want) {
		t.Errorf("accountName not escaped: %q (want substring %q)", got, want)
	}
}

func TestShippableProvincesExcludesWildcard(t *testing.T) {
	raw := `[{"province":"Hà Nội","fee":30000},{"province":"*","fee":50000},{"province":"Hồ Chí Minh","fee":30000},{"province":" Hà Nội ","fee":99}]`
	got, err := shippableProvinces([]byte(raw))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// "*" excluded; "Hà Nội" (and its whitespace-dup) collapsed to one; order preserved.
	want := []string{"Hà Nội", "Hồ Chí Minh"}
	if len(got) != len(want) {
		t.Fatalf("provinces = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("provinces = %v, want %v", got, want)
		}
	}
}

func TestShippableProvincesEmptyIsNonNil(t *testing.T) {
	// Wildcard-only config → empty selectable list, but never nil (JSON must render [] not null).
	got, err := shippableProvinces([]byte(`[{"province":"*","fee":50000}]`))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got == nil || len(got) != 0 {
		t.Fatalf("wildcard-only provinces = %v (len %d), want non-nil empty", got, len(got))
	}
	if got, _ := shippableProvinces(nil); got == nil {
		t.Fatal("nil shipping_rules must yield non-nil empty slice")
	}
}

func TestShippableProvincesMalformedIsServerFault(t *testing.T) {
	// Corrupt shipping_rules is a server config fault → wrapped pricing.ErrMalformedShippingRules
	// (mapError leaves it a 500), never a partial list. Two malformed subclasses, both of which
	// pricing.ShippingFee also rejects — the config listing must stay in lockstep with the fee resolver
	// so /checkout/config never lists a province a web order there would 500 on:
	cases := map[string]string{
		"json-shape":           `{"not":"an array"}`,
		"negative-fee":         `[{"province":"Hà Nội","fee":-1}]`,
		"negative-fee-on-star": `[{"province":"*","fee":-5}]`,
	}
	for name, raw := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := shippableProvinces([]byte(raw)); !errors.Is(err, pricing.ErrMalformedShippingRules) {
				t.Fatalf("malformed shipping_rules err = %v, want ErrMalformedShippingRules", err)
			}
		})
	}
}
