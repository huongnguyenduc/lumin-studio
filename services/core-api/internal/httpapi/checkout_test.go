package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/order"
)

// Docker-free CreateOrder tests: every boundary gate (CHK-04 proof, CHK-05 inbox-staff, ADR-012
// ack, client-money loud-reject, spec §05 shape rules) fires BEFORE any DB read, so a nil-pool
// Server proves the ordering as well as the outcome — if a gate ever moved behind a catalog
// read, these would panic on the nil pool instead of returning the expected rejection.

func testCheckoutServer() *Server {
	return NewServer(slog.New(slog.NewTextHandler(io.Discard, nil)), nil, nil, nil)
}

// mkCreateOrderBody decodes a raw JSON body through the same union path the wire uses.
func mkCreateOrderBody(t *testing.T, raw string) *api.CreateOrderInput {
	t.Helper()
	var body api.CreateOrderInput
	if err := json.Unmarshal([]byte(raw), &body); err != nil {
		t.Fatalf("unmarshal body: %v", err)
	}
	return &body
}

// webBody returns a minimal valid web-create JSON with the given overrides applied on top.
func webBody(overrides map[string]any) string {
	m := map[string]any{
		"channel":         "web",
		"customer":        map[string]any{"name": "Nguyễn An", "phone": "0901234567"},
		"shippingAddress": map[string]any{"province": "Hà Nội", "ward": "Cửa Nam", "street": "12 Lý Thường Kiệt"},
		"items":           []any{map[string]any{"productId": uuid.NewString(), "quantity": 1}},
		"paymentProofUrl": "https://cdn.example.com/receipt.jpg",
	}
	for k, v := range overrides {
		if v == nil {
			delete(m, k)
			continue
		}
		m[k] = v
	}
	b, _ := json.Marshal(m)
	return string(b)
}

func inboxBody() string {
	m := map[string]any{
		"channel":         "inbox",
		"customer":        map[string]any{"name": "Trần Bình", "phone": "0912345678"},
		"shippingAddress": map[string]any{"province": "Hà Nội", "ward": "Cửa Nam", "street": "5 Hàng Gai"},
		"items":           []any{map[string]any{"productId": uuid.NewString(), "quantity": 1}},
	}
	b, _ := json.Marshal(m)
	return string(b)
}

func fieldsOf(t *testing.T, resp api.CreateOrderResponseObject) map[string]string {
	t.Helper()
	bad, ok := resp.(api.CreateOrder400JSONResponse)
	if !ok {
		t.Fatalf("resp = %T, want CreateOrder400JSONResponse", resp)
	}
	env := api.ErrorEnvelope(bad.BadRequestJSONResponse)
	if env.Code != codeValidation {
		t.Fatalf("code = %s, want %s", env.Code, codeValidation)
	}
	if env.Fields == nil {
		return map[string]string{}
	}
	return *env.Fields
}

// A nil body (decode already handled upstream) yields a plain 400 VALIDATION envelope.
func TestCreateOrderNilBody(t *testing.T) {
	resp, err := testCheckoutServer().CreateOrder(context.Background(), api.CreateOrderRequestObject{Body: nil})
	if err != nil {
		t.Fatalf("err = %v, want typed 400", err)
	}
	if _, ok := resp.(api.CreateOrder400JSONResponse); !ok {
		t.Fatalf("resp = %T, want CreateOrder400JSONResponse", resp)
	}
}

// ADR-019 loud-reject: a client that smuggles money fields the contract omits gets a 400 naming
// each offending path — never a silently different (server-priced) charge.
func TestCreateOrderRejectsClientMoneyFields(t *testing.T) {
	raw := webBody(map[string]any{
		"total":       999,
		"subtotal":    500,
		"shippingFee": 0,
		"items":       []any{map[string]any{"productId": uuid.NewString(), "quantity": 1, "unitPrice": 1}},
	})
	resp, err := testCheckoutServer().CreateOrder(context.Background(), api.CreateOrderRequestObject{Body: mkCreateOrderBody(t, raw)})
	if err != nil {
		t.Fatalf("err = %v, want typed 400", err)
	}
	fields := fieldsOf(t, resp)
	for _, want := range []string{"total", "subtotal", "shippingFee", "items[0].unitPrice"} {
		if _, ok := fields[want]; !ok {
			t.Errorf("fields missing %q (got %v)", want, fields)
		}
	}
}

// ADR-019 loud-reject must fold case: encoding/json binds struct fields case-INSENSITIVELY, so a
// client that smuggles money under a case-variant key ({"Total":…}, {"Items":[{"UnitPrice":…}]})
// would otherwise slip past the scan yet still decode into the order — the price dropped silently
// instead of loudly rejected. The reject folds case so these still 400.
func TestCreateOrderRejectsCaseVariantMoneyFields(t *testing.T) {
	raw := webBody(map[string]any{
		"items": nil, // drop the lowercase default; keep only the case-variant "Items"
		"Total": 999,
		"Items": []any{map[string]any{"productId": uuid.NewString(), "quantity": 1, "UnitPrice": 1}},
	})
	resp, err := testCheckoutServer().CreateOrder(context.Background(), api.CreateOrderRequestObject{Body: mkCreateOrderBody(t, raw)})
	if err != nil {
		t.Fatalf("err = %v, want typed 400", err)
	}
	fields := fieldsOf(t, resp)
	for _, want := range []string{"Total", "items[0].unitPrice"} {
		if _, ok := fields[want]; !ok {
			t.Errorf("case-variant money key not caught: missing %q (got %v)", want, fields)
		}
	}
}

// CHK-05 (boundary half): channel=inbox with no resolved actor is rejected 403 FORBIDDEN — an
// anonymous caller must not mint a born-PAID order.
func TestCreateOrderInboxRequiresStaffActor(t *testing.T) {
	_, err := testCheckoutServer().CreateOrder(context.Background(), api.CreateOrderRequestObject{Body: mkCreateOrderBody(t, inboxBody())})
	if !errors.Is(err, errForbidden) {
		t.Fatalf("err = %v, want errForbidden", err)
	}
	if status, env := mapError(err); status != http.StatusForbidden || env.Code != codeForbidden {
		t.Fatalf("mapError = %d/%s, want 403/%s", status, env.Code, codeForbidden)
	}
}

// CHK-05 through the real router: the optional-auth middleware lets the anonymous request reach
// the handler, whose inbox gate rejects it as a 403 FORBIDDEN envelope on the wire.
func TestCreateOrderInboxAnonymousWire(t *testing.T) {
	r := NewRouter(slog.New(slog.NewTextHandler(io.Discard, nil)), nil, nil, nil)
	req := httptest.NewRequest(http.MethodPost, "/orders", bytes.NewBufferString(inboxBody()))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403 (body %s)", rec.Code, rec.Body.String())
	}
	var env api.ErrorEnvelope
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("body not an ErrorEnvelope: %v (%s)", err, rec.Body.String())
	}
	if env.Code != codeForbidden || env.MessageKey != "errors."+codeForbidden {
		t.Fatalf("envelope = %+v, want FORBIDDEN", env)
	}
}

// CHK-04 (boundary half): a web create needs a non-empty http(s) payment-proof URL with a host,
// checked before any DB read; each degenerate shape maps to 422 PROOF_REQUIRED.
func TestCreateOrderWebRequiresPaymentProof(t *testing.T) {
	cases := map[string]any{
		"absent":    nil,
		"empty":     "",
		"blank":     "   ",
		"not-a-url": "biên lai.jpg",
		"ftp":       "ftp://cdn.example.com/receipt.jpg",
		"hostless":  "http:///receipt.jpg",
	}
	for name, proof := range cases {
		t.Run(name, func(t *testing.T) {
			raw := webBody(map[string]any{"paymentProofUrl": proof})
			_, err := testCheckoutServer().CreateOrder(context.Background(), api.CreateOrderRequestObject{Body: mkCreateOrderBody(t, raw)})
			if !errors.Is(err, errPaymentProofRequired) {
				t.Fatalf("err = %v, want errPaymentProofRequired", err)
			}
			if status, env := mapError(err); status != http.StatusUnprocessableEntity || env.Code != string(order.ErrProofRequired) {
				t.Fatalf("mapError = %d/%s, want 422/%s", status, env.Code, order.ErrProofRequired)
			}
		})
	}
}

// ADR-012: an engraved web order requires BOTH the no-return ack and the engrave-echo
// confirmation; any missing/false combination is 422 PERSONALIZATION_ACK_REQUIRED. An order
// whose personalization has empty text is not engraved, so it passes the gate.
func TestCreateOrderPersonalizationAckRequired(t *testing.T) {
	engraved := func(ack, echo any) string {
		o := map[string]any{
			"items": []any{map[string]any{
				"productId":       uuid.NewString(),
				"quantity":        1,
				"personalization": map[string]any{"text": "Miu", "zoneId": "front"},
			}},
		}
		if ack != nil {
			o["personalizationAck"] = ack
		}
		if echo != nil {
			o["engraveEchoConfirmed"] = echo
		}
		return webBody(o)
	}
	for name, raw := range map[string]string{
		"both-absent": engraved(nil, nil),
		"ack-only":    engraved(true, nil),
		"echo-only":   engraved(nil, true),
		"ack-false":   engraved(false, true),
		"echo-false":  engraved(true, false),
	} {
		t.Run(name, func(t *testing.T) {
			_, err := testCheckoutServer().CreateOrder(context.Background(), api.CreateOrderRequestObject{Body: mkCreateOrderBody(t, raw)})
			if !errors.Is(err, errPersonalizationAckRequired) {
				t.Fatalf("err = %v, want errPersonalizationAckRequired", err)
			}
			if status, env := mapError(err); status != http.StatusUnprocessableEntity || env.Code != codeAckRequired {
				t.Fatalf("mapError = %d/%s, want 422/%s", status, env.Code, codeAckRequired)
			}
		})
	}

	// Empty-text personalization is normalized to "no engraving" — no ack needed; with a nil
	// pool the very next step (catalog read) would panic, so recover proves the gate PASSED.
	t.Run("empty-text-passes-gate", func(t *testing.T) {
		raw := webBody(map[string]any{
			"items": []any{map[string]any{
				"productId":       uuid.NewString(),
				"quantity":        1,
				"personalization": map[string]any{"text": "  ", "zoneId": "front"},
			}},
		})
		defer func() { _ = recover() }() // nil-pool catalog read panics — expected past the gate
		_, err := testCheckoutServer().CreateOrder(context.Background(), api.CreateOrderRequestObject{Body: mkCreateOrderBody(t, raw)})
		if errors.Is(err, errPersonalizationAckRequired) {
			t.Fatalf("empty-text engraving tripped the ack gate")
		}
	})
}

// spec §05 shape rules: each violation lands in the 400 fields map under its JSON path (or, for
// empty items, the seam's NO_ITEMS), all before any DB read.
func TestCreateOrderShapeValidation(t *testing.T) {
	srv := testCheckoutServer()
	call := func(t *testing.T, raw string) (api.CreateOrderResponseObject, error) {
		t.Helper()
		return srv.CreateOrder(context.Background(), api.CreateOrderRequestObject{Body: mkCreateOrderBody(t, raw)})
	}

	fieldCases := map[string]struct {
		raw   string
		field string
	}{
		"name-too-short": {webBody(map[string]any{"customer": map[string]any{"name": "A", "phone": "0901234567"}}), "customer.name"},
		"name-too-long":  {webBody(map[string]any{"customer": map[string]any{"name": strings.Repeat("a", 61), "phone": "0901234567"}}), "customer.name"},
		"phone-bad":      {webBody(map[string]any{"customer": map[string]any{"name": "Nguyễn An", "phone": "12345"}}), "customer.phone"},
		"phone-plus84-9": {webBody(map[string]any{"customer": map[string]any{"name": "Nguyễn An", "phone": "+8490123456"}}), "customer.phone"},
		// A malformed email fails the union decode itself (openapi_types.Email validates in
		// UnmarshalJSON), surfacing as the body-level flag; the field-level "@" check in
		// validate() stays as defense-in-depth behind the typed decode.
		"email-bad":       {webBody(map[string]any{"customer": map[string]any{"name": "Nguyễn An", "phone": "0901234567", "email": "not-an-email"}}), "body"},
		"province-empty":  {webBody(map[string]any{"shippingAddress": map[string]any{"province": " ", "ward": "Cửa Nam", "street": "12 Lý Thường Kiệt"}}), "shippingAddress.province"},
		"ward-empty":      {webBody(map[string]any{"shippingAddress": map[string]any{"province": "Hà Nội", "ward": "", "street": "12 Lý Thường Kiệt"}}), "shippingAddress.ward"},
		"street-empty":    {webBody(map[string]any{"shippingAddress": map[string]any{"province": "Hà Nội", "ward": "Cửa Nam", "street": ""}}), "shippingAddress.street"},
		"quantity-zero":   {webBody(map[string]any{"items": []any{map[string]any{"productId": uuid.NewString(), "quantity": 0}}}), "items[0].quantity"},
		"quantity-huge":   {webBody(map[string]any{"items": []any{map[string]any{"productId": uuid.NewString(), "quantity": 3_000_000_000}}}), "items[0].quantity"},
		"engrave-no-zone": {webBody(map[string]any{"items": []any{map[string]any{"productId": uuid.NewString(), "quantity": 1, "personalization": map[string]any{"text": "Miu", "zoneId": " "}}}, "personalizationAck": true, "engraveEchoConfirmed": true}), "items[0].personalization.zoneId"},
	}
	for name, tc := range fieldCases {
		t.Run(name, func(t *testing.T) {
			resp, err := call(t, tc.raw)
			if err != nil {
				t.Fatalf("err = %v, want typed 400", err)
			}
			if fields := fieldsOf(t, resp); fields[tc.field] != "errors."+codeValidation {
				t.Fatalf("fields[%q] = %q, want errors.%s (all: %v)", tc.field, fields[tc.field], codeValidation, fields)
			}
		})
	}

	t.Run("channel-unknown", func(t *testing.T) {
		resp, err := call(t, `{"channel":"zalo"}`)
		if err != nil {
			t.Fatalf("err = %v, want typed 400", err)
		}
		if fields := fieldsOf(t, resp); fields["channel"] == "" {
			t.Fatalf("fields = %v, want channel flagged", fields)
		}
	})
	t.Run("channel-missing", func(t *testing.T) {
		resp, err := call(t, `{"customer":{"name":"Nguyễn An","phone":"0901234567"}}`)
		if err != nil {
			t.Fatalf("err = %v, want typed 400", err)
		}
		if fields := fieldsOf(t, resp); fields["channel"] == "" {
			t.Fatalf("fields = %v, want channel flagged", fields)
		}
	})
	t.Run("items-empty", func(t *testing.T) {
		_, err := call(t, webBody(map[string]any{"items": []any{}}))
		if !errors.Is(err, db.ErrNoItems) {
			t.Fatalf("err = %v, want db.ErrNoItems", err)
		}
	})
}

// The genesis actor resolution: guest web → the reserved "customer" sentinel + server clock;
// an authenticated actor (web or inbox) → their users.id + the boundary-captured instant.
func TestIntakeActorResolution(t *testing.T) {
	staff := Actor{ByUser: uuid.NewString(), Role: order.RoleStaff, At: time.Date(2026, 7, 2, 8, 0, 0, 0, time.UTC)}

	t.Run("guest-web-sentinel", func(t *testing.T) {
		in, err := intakeFrom(context.Background(), *mkCreateOrderBody(t, webBody(nil)))
		if err != nil {
			t.Fatalf("intakeFrom: %v", err)
		}
		if in.byUser != byUserCustomer {
			t.Fatalf("byUser = %q, want %q", in.byUser, byUserCustomer)
		}
		if time.Since(in.at) > time.Minute || in.at.Location() != time.UTC {
			t.Fatalf("at = %v, want ~now UTC", in.at)
		}
	})
	t.Run("authed-web-real-id", func(t *testing.T) {
		in, err := intakeFrom(withActor(context.Background(), staff), *mkCreateOrderBody(t, webBody(nil)))
		if err != nil {
			t.Fatalf("intakeFrom: %v", err)
		}
		if in.byUser != staff.ByUser || !in.at.Equal(staff.At) {
			t.Fatalf("byUser/at = %q/%v, want %q/%v", in.byUser, in.at, staff.ByUser, staff.At)
		}
	})
	t.Run("inbox-actor-id", func(t *testing.T) {
		in, err := intakeFrom(withActor(context.Background(), staff), *mkCreateOrderBody(t, inboxBody()))
		if err != nil {
			t.Fatalf("intakeFrom: %v", err)
		}
		if in.byUser != staff.ByUser || in.channel != order.ChannelInbox {
			t.Fatalf("byUser/channel = %q/%s, want %q/inbox", in.byUser, in.channel, staff.ByUser)
		}
	})
}
