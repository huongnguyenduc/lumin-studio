// HTTP error handling for core-api: the single domain-error → status/ErrorEnvelope
// table (ADR-032) plus the strict-server error hooks that render it. The domain's
// Vietnamese TransitionError.Message is server-internal and NEVER crosses the wire —
// the edge maps it to a stable machine code + a next-intl key (always-must #3 / i18n).
package httpapi

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5/middleware"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/money"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/order"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/pricing"
)

// Stable machine error codes carried in ErrorEnvelope.code. Each maps 1:1 to the
// next-intl key "errors.<CODE>" via msgKey — the client renders the localized string.
// order.TransitionError contributes its own codes verbatim (INVALID_EDGE, RBAC, …).
const (
	codeValidation      = "VALIDATION"
	codeUnauthorized    = "UNAUTHORIZED"
	codeForbidden       = "FORBIDDEN"
	codeNotFound        = "NOT_FOUND"
	codeNoItems         = "NO_ITEMS"
	codeInvalidEvent    = "INVALID_EVENT"
	codeInvalidAssetJob = "INVALID_ASSET_JOB"
	codeInvalidBank     = "INVALID_BANK_CHANGE"
	codeInvalidAmount   = "INVALID_AMOUNT"
	codeInternal        = "INTERNAL"
	codeNotImplemented  = "NOT_IMPLEMENTED"
	codeTrackingReqd    = "TRACKING_CODE_REQUIRED"
	codeRateLimited     = "RATE_LIMITED"
	// codeEmailTaken is the storefront-register 409: the login email is already registered. It is
	// the ONE field a register form may safely surface (a login email is user-known, not a secret —
	// unlike the login endpoint, which stays uniform to avoid enumeration). PR-P1-r.
	codeEmailTaken = "EMAIL_TAKEN"

	// Checkout (PR-3g) selection/intake codes. Granular where the storefront needs a distinct
	// user-facing message (hết hàng vs quá dài vs chưa hỗ trợ tỉnh); one INVALID_SELECTION for
	// the shapes that only a buggy/hostile client produces (foreign color/option, duplicates).
	codeAckRequired        = "PERSONALIZATION_ACK_REQUIRED"
	codeInvalidSelection   = "INVALID_SELECTION"
	codeColorUnavailable   = "COLOR_UNAVAILABLE"
	codeEngraveTooLong     = "ENGRAVE_TOO_LONG"
	codeNoShippingRule     = "NO_SHIPPING_RULE"
	codeProductUnavailable = "PRODUCT_UNAVAILABLE"
)

// errNotImplemented marks a handler stub not yet built (PR-3d scaffolding). Each domain
// PR (3e–3k) replaces its stub with the real handler; mapError renders this as 501.
var errNotImplemented = errors.New("httpapi: endpoint not implemented")

// errTrackingCodeRequired is the transition handler's boundary rejection for a PRINTING→SHIPPING
// request with no trackingCode (spec §04 requires mã vận chuyển on SHIPPING). It is an HTTP-edge
// concern — the domain order.Transition guard does not model trackingCode — so it lives here and
// maps to 422 TRACKING_CODE_REQUIRED, sibling to the domain's REASON_REQUIRED/REFUND_PROOF_REQUIRED.
var errTrackingCodeRequired = errors.New("httpapi: tracking code required for SHIPPING")

// Checkout (PR-3g) boundary sentinels — HTTP-edge rules the domain/db layers don't model.
var (
	// errPaymentProofRequired — a web create with a missing/malformed paymentProofUrl (CHK-04:
	// enforced at the HTTP boundary, before any DB read). Maps to 422 with the domain's own
	// PROOF_REQUIRED code so the wire code matches what order.InitialStatusForChannel would emit.
	errPaymentProofRequired = errors.New("httpapi: payment proof url required for web order")
	// errPersonalizationAckRequired — a web create carries engraving but the no-return
	// acknowledgement + engrave-echo confirmation are not both true (ADR-012: tickbox trước
	// thanh toán + bước echo nội dung khắc — enforced server-side, not just in the UI).
	errPersonalizationAckRequired = errors.New("httpapi: personalization requires ack + engrave echo confirmation")
	// errProductUnavailable — an ordered product id does not exist or is not `active`. One code
	// for both: a 404 would leak catalog-existence on a public endpoint, and to a buyer the two
	// states are the same ("sản phẩm không còn bán").
	errProductUnavailable = errors.New("httpapi: product not available for ordering")
)

// msgKey derives the next-intl key from a stable code ("errors.<CODE>"). Deriving it
// mechanically means the code and its i18n key can never drift. Frontend consumers own
// the `errors` message namespace (added with the admin/storefront wiring, PR-3j+).
func msgKey(code string) string { return "errors." + code }

// envelope builds the wire ErrorEnvelope for a stable code. It never carries a
// human-readable message — the client resolves messageKey to localized prose.
func envelope(code string) api.ErrorEnvelope {
	return api.ErrorEnvelope{Code: code, MessageKey: msgKey(code)}
}

// mapError is the single domain-error → (HTTP status, ErrorEnvelope) table (ADR-032).
// It is declared here once so no handler improvises its own status/code — all three TS
// clients consume the same shape. It NEVER forwards a domain error's message; a caller
// that wants the raw error recorded must log it before responding (see handleResponseError).
func mapError(err error) (int, api.ErrorEnvelope) {
	// order.TransitionError already carries a machine code — reuse it verbatim so the
	// wire code == the domain code (e.g. INVALID_EDGE, RBAC, REASON_REQUIRED).
	var te *order.TransitionError
	if errors.As(err, &te) {
		switch te.Code {
		case order.ErrInvalidEdge:
			return http.StatusConflict, envelope(string(te.Code))
		case order.ErrRBAC:
			return http.StatusForbidden, envelope(string(te.Code))
		case order.ErrReasonRequired, order.ErrRefundProofRequired, order.ErrProofRequired:
			return http.StatusUnprocessableEntity, envelope(string(te.Code))
		case order.ErrInvalidActor, order.ErrInvalidTimestamp:
			return http.StatusBadRequest, envelope(string(te.Code))
		default:
			// An unrecognised transition code fails closed as unprocessable, never 500 —
			// a new code added upstream still yields a stable, non-leaking envelope.
			return http.StatusUnprocessableEntity, envelope(string(te.Code))
		}
	}

	switch {
	case errors.Is(err, errUnauthenticated):
		// No/invalid session credential at the auth boundary (PR-3e-2).
		return http.StatusUnauthorized, envelope(codeUnauthorized)
	case errors.Is(err, errForbidden):
		// Valid credential, insufficient role (e.g. staff hitting an owner-only edge).
		return http.StatusForbidden, envelope(codeForbidden)
	case errors.Is(err, errNotImplemented):
		return http.StatusNotImplemented, envelope(codeNotImplemented)
	case errors.Is(err, errRateLimited):
		// Guest order-lookup rate-limit / lockout tripped (PR-P1-n). 429 with no Retry-After so the
		// exact lockout window is not leaked; the client backs off (P1-o auto-poll respects this).
		return http.StatusTooManyRequests, envelope(codeRateLimited)
	case errors.Is(err, errTrackingCodeRequired):
		// SHIPPING with no tracking code — well-formed request, unprocessable per spec §04.
		return http.StatusUnprocessableEntity, envelope(codeTrackingReqd)
	case errors.Is(err, errPaymentProofRequired):
		// Web create with no usable CK-receipt URL (CHK-04). Same code the domain guard uses.
		return http.StatusUnprocessableEntity, envelope(string(order.ErrProofRequired))
	case errors.Is(err, errPersonalizationAckRequired):
		// Engraved web order without the ADR-012 no-return ack + engrave-echo confirmation.
		return http.StatusUnprocessableEntity, envelope(codeAckRequired)
	case errors.Is(err, errProductUnavailable):
		// Ordered product missing or not active — never a 404 (catalog-existence probe).
		return http.StatusUnprocessableEntity, envelope(codeProductUnavailable)
	case errors.Is(err, pricing.ErrColorNotForProduct), errors.Is(err, pricing.ErrOptionNotForProduct),
		errors.Is(err, pricing.ErrDuplicateOption), errors.Is(err, pricing.ErrEngraveNotAllowed):
		// A selection referencing catalog rows that don't belong together — client bug/hostile.
		return http.StatusUnprocessableEntity, envelope(codeInvalidSelection)
	case errors.Is(err, pricing.ErrColorUnavailable):
		return http.StatusUnprocessableEntity, envelope(codeColorUnavailable)
	case errors.Is(err, pricing.ErrEngraveTooLong):
		return http.StatusUnprocessableEntity, envelope(codeEngraveTooLong)
	case errors.Is(err, pricing.ErrNoShippingRule):
		// No shipping rule (nor "*" default) for the destination province — never a silent ₫0.
		return http.StatusUnprocessableEntity, envelope(codeNoShippingRule)
	case errors.Is(err, pricing.ErrPriceOverflow):
		return http.StatusUnprocessableEntity, envelope(codeInvalidAmount)
	// pricing.ErrMalformedShippingRules deliberately falls through to the default 500:
	// corrupt settings.shipping_rules is a server config fault, not a client error.
	case errors.Is(err, db.ErrNotFound):
		return http.StatusNotFound, envelope(codeNotFound)
	case errors.Is(err, db.ErrNoItems):
		return http.StatusUnprocessableEntity, envelope(codeNoItems)
	case errors.Is(err, db.ErrInvalidEvent):
		return http.StatusUnprocessableEntity, envelope(codeInvalidEvent)
	case errors.Is(err, db.ErrInvalidAssetJob):
		return http.StatusUnprocessableEntity, envelope(codeInvalidAssetJob)
	case errors.Is(err, db.ErrInvalidBankChange):
		return http.StatusUnprocessableEntity, envelope(codeInvalidBank)
	case errors.Is(err, money.ErrInvalidAmount):
		return http.StatusUnprocessableEntity, envelope(codeInvalidAmount)
	default:
		// Unmapped: a generic 500. The raw error is logged server-side (handleResponseError)
		// but never returned to the client.
		return http.StatusInternalServerError, envelope(codeInternal)
	}
}

// writeError renders an ErrorEnvelope as JSON with the given status. It marshals into a
// buffer first (via writeJSON) so a marshal failure becomes a bare 500, never a truncated
// body. Handlers/middleware that respond with an error directly use this.
func writeError(w http.ResponseWriter, status int, env api.ErrorEnvelope) {
	writeJSON(w, status, env)
}

// handleResponseError is the strict-server ResponseErrorHandlerFunc: it renders an error
// returned by a strict handler as an ErrorEnvelope. Domain errors map to their code; an
// unmapped (500) error is logged server-side so ops sees the real cause, but the raw
// error is NEVER exposed to the client. This replaces the generated plaintext default
// (http.Error(w, err.Error(), 500)), which would leak the Vietnamese domain message.
func (s *Server) handleResponseError(w http.ResponseWriter, r *http.Request, err error) {
	status, env := mapError(err)
	// Log genuine server faults (500) — but not the expected NOT_IMPLEMENTED scaffolding.
	if status >= http.StatusInternalServerError && !errors.Is(err, errNotImplemented) {
		s.logger.Error("handler error",
			"err", err,
			"method", r.Method,
			"path", r.URL.Path,
			"request_id", middleware.GetReqID(r.Context()),
		)
	}
	writeError(w, status, env)
}

// handleRequestError is the strict-server RequestErrorHandlerFunc: a request-binding
// failure (malformed JSON body, bad path/query param) surfaces as a 400 VALIDATION
// envelope — never the raw parser message, which can echo attacker-controlled input.
func (s *Server) handleRequestError(w http.ResponseWriter, _ *http.Request, _ error) {
	writeError(w, http.StatusBadRequest, envelope(codeValidation))
}
