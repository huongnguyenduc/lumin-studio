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
)

// errNotImplemented marks a handler stub not yet built (PR-3d scaffolding). Each domain
// PR (3e–3k) replaces its stub with the real handler; mapError renders this as 501.
var errNotImplemented = errors.New("httpapi: endpoint not implemented")

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
