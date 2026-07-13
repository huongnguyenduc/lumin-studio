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
	codeQcPhotoReqd     = "QC_PHOTO_REQUIRED"
	codeRateLimited     = "RATE_LIMITED"
	// codeProductInUse — a hard product delete blocked because the product is referenced by an order or
	// an asset job (ON DELETE RESTRICT, migrations 000005/000006). 409, steering the owner to archive
	// (PATCH status→archived) instead of deleting a product with history (P3-j).
	codeProductInUse = "PRODUCT_IN_USE"
	// codeCategoryInUse — a hard category delete blocked because a product still references it
	// (products.category_id NOT NULL, NO ACTION — migration 000003). 409, steering the owner to
	// reassign or archive the products first (P3-o).
	codeCategoryInUse = "CATEGORY_IN_USE"
	// codeEmailTaken is the storefront-register 409: the login email is already registered. It is
	// the ONE field a register form may safely surface (a login email is user-known, not a secret —
	// unlike the login endpoint, which stays uniform to avoid enumeration). PR-P1-r.
	codeEmailTaken = "EMAIL_TAKEN"
	// codePetTagNotActivatable is the pet-tag activation 409: the scanned tag is not in an activatable
	// state — already ACTIVATED (a second activate, or a lost race), or still UNENCODED (chip not written).
	// A normal scan is ENCODED; this only fires on a re-submit/race or direct API abuse (P3-t t-3).
	codePetTagNotActivatable = "PET_TAG_NOT_ACTIVATABLE"

	// codePetNotLost is the finder share-location 409 (P3-t t-4b): the scanned pet is not in lost mode (or the
	// tag is not yet activated, so no profile exists), so a finder's location can't be recorded — an at-home
	// pet's location is never pinged (spec §10 rescue is lostMode-only). Only fires on an at-home scan or API abuse.
	codePetNotLost = "PET_NOT_LOST"

	// Checkout (PR-3g) selection/intake codes. Granular where the storefront needs a distinct
	// user-facing message (hết hàng vs quá dài vs chưa hỗ trợ tỉnh); one INVALID_SELECTION for
	// the shapes that only a buggy/hostile client produces (foreign color/option, duplicates).
	codeAckRequired        = "PERSONALIZATION_ACK_REQUIRED"
	codeInvalidSelection   = "INVALID_SELECTION"
	codeColorUnavailable   = "COLOR_UNAVAILABLE"
	codeEngraveTooLong     = "ENGRAVE_TOO_LONG"
	codeNoShippingRule     = "NO_SHIPPING_RULE"
	codeProductUnavailable = "PRODUCT_UNAVAILABLE"
	// codeNoSTK — the shop has no bank account (STK) configured, so no web payment can be taken
	// (P2-a). Gates both GET /checkout/config and a web POST /orders; 422, not 500 — it is a
	// recoverable shop-config state the storefront renders as "checkout tạm đóng", not a crash.
	codeNoSTK = "NO_STK_CONFIGURED"
)

// errNotImplemented marks a handler stub not yet built (PR-3d scaffolding). Each domain
// PR (3e–3k) replaces its stub with the real handler; mapError renders this as 501.
var errNotImplemented = errors.New("httpapi: endpoint not implemented")

// errTrackingCodeRequired is the transition handler's boundary rejection for a PRINTING→SHIPPING
// request with no trackingCode (spec §04 requires mã vận chuyển on SHIPPING). It is an HTTP-edge
// concern — the domain order.Transition guard does not model trackingCode — so it lives here and
// maps to 422 TRACKING_CODE_REQUIRED, sibling to the domain's REASON_REQUIRED/REFUND_PROOF_REQUIRED.
var errTrackingCodeRequired = errors.New("httpapi: tracking code required for SHIPPING")

// errQcPhotoRequired is the transition handler's boundary rejection for a PRINTING→SHIPPING request
// whose qcPhotoUrl is missing OR not a valid http/https URL (D-P3-6 requires a QC packing photo on
// SHIPPING; order.IsHTTPURL enforces the same shape the domain guard uses for refundProofUrl, so a
// non-http value can't persist and be rendered as an admin link). Like errTrackingCodeRequired it is
// an HTTP-edge concern — the domain guard models neither shipping artifact — so it lives here and
// maps to 422 QC_PHOTO_REQUIRED.
var errQcPhotoRequired = errors.New("httpapi: valid QC photo URL required for SHIPPING")

// errProductInUse is the admin product-delete boundary rejection for a product referenced by an order or
// an asset job (the DB raises a foreign_key_violation on the RESTRICT FK; the handler translates it here so
// the wire answer is a stable 409, never a leaked pg error). Maps to 409 PRODUCT_IN_USE (P3-j).
var errProductInUse = errors.New("httpapi: product has orders or render history")

// errCategoryInUse is the admin category-delete boundary rejection for a category still referenced by a
// product (the DB raises a foreign_key_violation on the NOT-NULL category_id FK; the handler translates it
// here so the wire answer is a stable 409, never a leaked pg error). Maps to 409 CATEGORY_IN_USE (P3-o).
var errCategoryInUse = errors.New("httpapi: category still has products")

// errPetNotLost is the finder share-location boundary rejection (P3-t t-4b): the pet is not in lost mode (or
// the tag is not yet activated), so there is nothing to rescue and no owner-location ping is recorded. 409 — a
// well-formed request against a pet whose state does not permit a location share.
var errPetNotLost = errors.New("httpapi: pet is not in lost mode")

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
	// errNoSTKConfigured — the settings singleton has no usable bank account (STK), so the shop
	// cannot take a web payment (P2-a). Raised by GET /checkout/config and by a web POST /orders
	// BEFORE any write, so a customer can never "pay" against a shop with no destination account.
	errNoSTKConfigured = errors.New("httpapi: shop bank account (STK) not configured")
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
		// Public endpoint token-bucket tripped. 429 with no Retry-After so the exact limiter window
		// is not leaked; clients back off and retry later.
		return http.StatusTooManyRequests, envelope(codeRateLimited)
	case errors.Is(err, errTrackingCodeRequired):
		// SHIPPING with no tracking code — well-formed request, unprocessable per spec §04.
		return http.StatusUnprocessableEntity, envelope(codeTrackingReqd)
	case errors.Is(err, errQcPhotoRequired):
		// SHIPPING with no QC packing photo — well-formed request, unprocessable per D-P3-6.
		return http.StatusUnprocessableEntity, envelope(codeQcPhotoReqd)
	case errors.Is(err, errProductInUse):
		// Hard product delete blocked by an order/asset-job RESTRICT FK — archive instead (P3-j).
		return http.StatusConflict, envelope(codeProductInUse)
	case errors.Is(err, errCategoryInUse):
		// Hard category delete blocked by a product's category_id FK — reassign/archive first (P3-o).
		return http.StatusConflict, envelope(codeCategoryInUse)
	case errors.Is(err, errPetNotLost):
		// Finder share-location against a pet not in lost mode (or not activated) — well-formed, 409 (P3-t t-4b).
		return http.StatusConflict, envelope(codePetNotLost)
	case errors.Is(err, errPaymentProofRequired):
		// Web create with no usable CK-receipt URL (CHK-04). Same code the domain guard uses.
		return http.StatusUnprocessableEntity, envelope(string(order.ErrProofRequired))
	case errors.Is(err, errPersonalizationAckRequired):
		// Engraved web order without the ADR-012 no-return ack + engrave-echo confirmation.
		return http.StatusUnprocessableEntity, envelope(codeAckRequired)
	case errors.Is(err, errProductUnavailable):
		// Ordered product missing or not active — never a 404 (catalog-existence probe).
		return http.StatusUnprocessableEntity, envelope(codeProductUnavailable)
	case errors.Is(err, errNoSTKConfigured):
		// Shop has no STK configured — no web payment possible (P2-a). 422, not 500: a
		// recoverable config state the storefront shows as "checkout tạm đóng".
		return http.StatusUnprocessableEntity, envelope(codeNoSTK)
	case errors.Is(err, pricing.ErrColorNotForProduct), errors.Is(err, pricing.ErrOptionNotForProduct),
		errors.Is(err, pricing.ErrDuplicateOption), errors.Is(err, pricing.ErrEngraveNotAllowed),
		// ADR-037 configurator: per-part colour + per-option choice selection faults (client bug/hostile).
		errors.Is(err, pricing.ErrColorForPartsProduct), errors.Is(err, pricing.ErrPartColorForFlatProduct),
		errors.Is(err, pricing.ErrMissingPartColor), errors.Is(err, pricing.ErrDuplicatePartColor),
		errors.Is(err, pricing.ErrColorNotForPart), errors.Is(err, pricing.ErrOptionNeedsChoice),
		errors.Is(err, pricing.ErrChoiceNotForOption), errors.Is(err, pricing.ErrDuplicateOptionChoice):
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
