package httpapi

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/money"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/order"
)

// TestMapErrorTable pins the ADR-032 domain-error → (status, code) mapping. Every branch
// must land on its documented status and a stable machine code; the derived messageKey is
// always "errors.<code>".
func TestMapErrorTable(t *testing.T) {
	cases := []struct {
		name       string
		err        error
		wantStatus int
		wantCode   string
	}{
		{"not-implemented", errNotImplemented, http.StatusNotImplemented, codeNotImplemented},
		{"not-found", db.ErrNotFound, http.StatusNotFound, codeNotFound},
		{"no-items", db.ErrNoItems, http.StatusUnprocessableEntity, codeNoItems},
		{"invalid-event", db.ErrInvalidEvent, http.StatusUnprocessableEntity, codeInvalidEvent},
		{"invalid-asset-job", db.ErrInvalidAssetJob, http.StatusUnprocessableEntity, codeInvalidAssetJob},
		{"invalid-bank", db.ErrInvalidBankChange, http.StatusUnprocessableEntity, codeInvalidBank},
		{"invalid-amount", money.ErrInvalidAmount, http.StatusUnprocessableEntity, codeInvalidAmount},
		{"amount-wrapped", fmt.Errorf("calc: %w", money.ErrInvalidAmount), http.StatusUnprocessableEntity, codeInvalidAmount},
		{"transition-invalid-edge", &order.TransitionError{Code: order.ErrInvalidEdge, Message: "Không thể chuyển PAID → PAID."}, http.StatusConflict, "INVALID_EDGE"},
		{"transition-rbac", &order.TransitionError{Code: order.ErrRBAC, Message: "Vai trò staff không được phép."}, http.StatusForbidden, "RBAC"},
		{"transition-reason", &order.TransitionError{Code: order.ErrReasonRequired, Message: "cần lý do."}, http.StatusUnprocessableEntity, "REASON_REQUIRED"},
		{"transition-refund-proof", &order.TransitionError{Code: order.ErrRefundProofRequired, Message: "cần refundProofUrl."}, http.StatusUnprocessableEntity, "REFUND_PROOF_REQUIRED"},
		{"transition-proof", &order.TransitionError{Code: order.ErrProofRequired, Message: "cần proof."}, http.StatusUnprocessableEntity, "PROOF_REQUIRED"},
		{"transition-actor", &order.TransitionError{Code: order.ErrInvalidActor, Message: "cần byUser."}, http.StatusBadRequest, "INVALID_ACTOR"},
		{"transition-timestamp", &order.TransitionError{Code: order.ErrInvalidTimestamp, Message: "at phải ISO-8601."}, http.StatusBadRequest, "INVALID_TIMESTAMP"},
		{"transition-wrapped", fmt.Errorf("seam: %w", &order.TransitionError{Code: order.ErrRBAC, Message: "x"}), http.StatusForbidden, "RBAC"},
		{"transition-unknown-code", &order.TransitionError{Code: order.ErrorCode("SOMETHING_NEW"), Message: "y"}, http.StatusUnprocessableEntity, "SOMETHING_NEW"},
		{"unmapped", fmt.Errorf("boom"), http.StatusInternalServerError, codeInternal},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			status, env := mapError(tc.err)
			if status != tc.wantStatus {
				t.Fatalf("status = %d, want %d", status, tc.wantStatus)
			}
			if env.Code != tc.wantCode {
				t.Fatalf("code = %q, want %q", env.Code, tc.wantCode)
			}
			if want := "errors." + tc.wantCode; env.MessageKey != want {
				t.Fatalf("messageKey = %q, want %q", env.MessageKey, want)
			}
			if env.Fields != nil {
				t.Fatalf("fields = %v, want nil (no per-field errors set)", *env.Fields)
			}
		})
	}
}

// TestMapErrorNeverLeaksDomainMessage is the always-must #3 guard: the domain's Vietnamese
// TransitionError.Message must never appear in the envelope the client receives.
func TestMapErrorNeverLeaksDomainMessage(t *testing.T) {
	msg := "Vai trò staff không được phép chuyển PAID → PRINTING."
	_, env := mapError(&order.TransitionError{Code: order.ErrRBAC, Message: msg})
	blob, _ := json.Marshal(env)
	if strings.Contains(string(blob), "Vai trò") || strings.Contains(string(blob), msg) {
		t.Fatalf("envelope leaked the Vietnamese domain message: %s", blob)
	}
}

// TestDomainRouteReturns501Envelope proves the strict-server error hooks are wired: an
// un-built handler yields a 501 ErrorEnvelope (code NOT_IMPLEMENTED), NOT the generated
// plaintext default — and the raw error string ("endpoint not implemented") never leaks.
func TestDomainRouteReturns501Envelope(t *testing.T) {
	rec := httptest.NewRecorder()
	newTestRouter().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/admin/dashboard", nil))

	if rec.Code != http.StatusNotImplemented {
		t.Fatalf("GET /admin/dashboard = %d, want 501", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
		t.Fatalf("Content-Type = %q, want application/json (envelope, not plaintext)", ct)
	}
	var env struct {
		Code       string `json:"code"`
		MessageKey string `json:"messageKey"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("body is not a JSON envelope: %v (%s)", err, rec.Body.String())
	}
	if env.Code != codeNotImplemented || env.MessageKey != "errors."+codeNotImplemented {
		t.Fatalf("envelope = %+v, want NOT_IMPLEMENTED", env)
	}
	if strings.Contains(rec.Body.String(), "endpoint not implemented") {
		t.Fatalf("body leaked the raw Go error string: %s", rec.Body.String())
	}
}

// TestBadJSONBodyReturns400Validation proves handleRequestError is wired: a malformed body
// on a bodied endpoint yields a 400 VALIDATION envelope, never the raw parser message.
func TestBadJSONBodyReturns400Validation(t *testing.T) {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/auth/login", strings.NewReader("{ this is not json"))
	req.Header.Set("Content-Type", "application/json")
	newTestRouter().ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("POST /auth/login (bad JSON) = %d, want 400", rec.Code)
	}
	var env struct {
		Code string `json:"code"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("body is not a JSON envelope: %v (%s)", err, rec.Body.String())
	}
	if env.Code != codeValidation {
		t.Fatalf("code = %q, want VALIDATION", env.Code)
	}
	if strings.Contains(rec.Body.String(), "can't decode") {
		t.Fatalf("body leaked the raw decoder message: %s", rec.Body.String())
	}
}

// TestBadPathParamReturns400Validation covers the chi-wrapper param-binding seam (distinct
// from the strict body-decode seam above): a non-UUID {id} fails binding BEFORE the strict
// handler runs, and must render the 400 VALIDATION envelope via the ChiServerOptions
// ErrorHandlerFunc — never oapi-codegen's plaintext default, which would echo the raw param.
func TestBadPathParamReturns400Validation(t *testing.T) {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/orders/not-a-uuid/transitions", strings.NewReader(`{}`))
	req.Header.Set("Content-Type", "application/json")
	newTestRouter().ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("POST /orders/{bad-uuid}/transitions = %d, want 400", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
		t.Fatalf("Content-Type = %q, want application/json (envelope, not plaintext)", ct)
	}
	var env struct {
		Code string `json:"code"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("body is not a JSON envelope: %v (%s)", err, rec.Body.String())
	}
	if env.Code != codeValidation {
		t.Fatalf("code = %q, want VALIDATION", env.Code)
	}
	if strings.Contains(rec.Body.String(), "Invalid format for parameter") {
		t.Fatalf("body leaked the raw param-binding message: %s", rec.Body.String())
	}
}
