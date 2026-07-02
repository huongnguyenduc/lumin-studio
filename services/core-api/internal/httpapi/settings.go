package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/order"
)

// settings.go — the admin config/reference surface (PR-3k): read the settings singleton, change the
// VietQR STK (owner-only, audited), and list the extension reply templates. Handlers stay thin; the
// SQL + the audit seam live in internal/db. The static VietQR *image* render (the display half of
// conventions §57) is NOT here — it is a storefront/checkout-display concern deferred with that
// surface (plan §0/§6 D6); this PR only persists + returns the STK.

// GetSettings handles GET /admin/settings (admin-gated: owner+staff both read). It returns the
// singleton with its jsonb columns decoded into the typed contract shape. Money-bearing config (the
// STK) is read here but only CHANGED through UpdateBankAccount (owner-only + audited).
func (s *Server) GetSettings(ctx context.Context, _ api.GetSettingsRequestObject) (api.GetSettingsResponseObject, error) {
	row, err := db.NewSettings(s.pool).Get(ctx)
	if errors.Is(err, db.ErrNotFound) {
		// The singleton is seeded by migration 000007; its absence is a SERVER fault (broken seed),
		// not a client 404. Break the ErrNotFound chain so mapError renders a logged 500, not a 404.
		return nil, fmt.Errorf("settings: singleton missing (seed 000007)")
	}
	if err != nil {
		return nil, err
	}
	dto, err := settingsDTO(row)
	if err != nil {
		return nil, err
	}
	return api.GetSettings200JSONResponse(dto), nil
}

// UpdateBankAccount handles PATCH /admin/settings/bank-account (PR-3k): change the VietQR STK. It is
// OWNER-ONLY — enforced at the auth boundary (classify → authOwnerOnly), so a resolved actor here is
// always the owner; the handler still fails closed if the actor is somehow absent. The change goes
// through db.UpdateBankAccountTx, which updates the column AND appends a setting_bank_audit row in ONE
// tx (conventions §57): an STK change can never be persisted without its audit trail. Actor identity
// (changed_by) comes from the auth context (users.id), never the body.
func (s *Server) UpdateBankAccount(ctx context.Context, req api.UpdateBankAccountRequestObject) (api.UpdateBankAccountResponseObject, error) {
	// Authz FIRST — this is the owner-only STK edge, so fail closed on identity BEFORE doing (or
	// disclosing) any request-body processing. classify()→authOwnerOnly already gates non-owners at the
	// boundary; the handler re-asserts here (defense in depth — the STK is the single highest-value
	// money-out field, a bad STK reroutes EVERY customer payment) so a classify() regress can neither
	// let staff rewrite the STK NOR leak per-field validation detail to a non-owner. conventions
	// §Bảo mật / domain-core RBAC ("staff không sửa STK").
	actor, ok := actorFrom(ctx)
	if !ok {
		return nil, errUnauthenticated
	}
	if actor.Role != order.RoleOwner {
		return nil, errForbidden
	}

	if req.Body == nil {
		// A decode failure is already caught by the strict RequestErrorHandlerFunc; this covers a nil
		// body reaching the handler (mirrors checkout.go/transition.go).
		return api.UpdateBankAccount400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(envelope(codeValidation))}, nil
	}
	rec, fields := cleanBankUpdate(*req.Body)
	if len(fields) > 0 {
		env := envelope(codeValidation)
		env.Fields = &fields
		return api.UpdateBankAccount400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(env)}, nil
	}

	changedBy, err := uuid.Parse(actor.ByUser)
	if err != nil {
		// actor.ByUser is standardized on users.id (a uuid) by the auth middleware; a non-uuid means
		// a broken actor, not a client error.
		return nil, errUnauthenticated
	}
	bankJSON, err := json.Marshal(rec)
	if err != nil {
		return nil, fmt.Errorf("settings: marshal bank account: %w", err)
	}

	var row sqlc.Setting
	err = withTx(ctx, s.pool, func(tx pgx.Tx) error {
		var e error
		row, e = db.UpdateBankAccountTx(ctx, tx, db.BankAccountChange{
			ChangedBy:   changedBy,
			BankAccount: bankJSON,
			Reason:      req.Body.Reason,
		})
		return e
	})
	if err != nil {
		return nil, err // db.ErrInvalidBankChange → 422, other → 500 (mapError)
	}

	dto, err := settingsDTO(row)
	if err != nil {
		return nil, err
	}
	return api.UpdateBankAccount200JSONResponse(dto), nil
}

// ListReplyTemplates handles GET /admin/reply-templates (admin-gated read), ordered by title.
func (s *Server) ListReplyTemplates(ctx context.Context, _ api.ListReplyTemplatesRequestObject) (api.ListReplyTemplatesResponseObject, error) {
	rows, err := db.NewSettings(s.pool).ReplyTemplates(ctx)
	if err != nil {
		return nil, err
	}
	dtos, err := replyTemplatesDTO(rows)
	if err != nil {
		return nil, err
	}
	return api.ListReplyTemplates200JSONResponse(dtos), nil
}

// bankAccountRecord is the persisted STK shape stored in settings.bank_account (jsonb) and read back
// into api.BankAccount. Keys match VietQR {bin, accountNumber, accountName} (conventions §57).
type bankAccountRecord struct {
	Bin           string `json:"bin"`
	AccountNumber string `json:"accountNumber"`
	AccountName   string `json:"accountName"`
}

// cleanBankUpdate trims and validates the owner's STK change at the HTTP boundary (the VietQR field
// shape the db seam's validate() does not model — it only guards the jsonb-object shape). It returns
// the cleaned record to persist and a per-field error map (empty ⇒ valid). This is a money-out field
// the server renders a static VietQR from, so a garbage STK must be rejected loudly before it can be
// stored and later misroute payments:
//   - bin: EXACTLY 6 digits — a napas bank id (e.g. 970436 Vietcombank, 970407 Techcombank). A
//     numeric-but-wrong-length bin resolves to the wrong/no bank, so length matters, not just digits.
//   - accountNumber: all digits, ≤ 19 (VN bank account numbers are numeric; VietQR caps them at 19).
//   - accountName: non-empty after trimming (free text — beneficiary display name).
func cleanBankUpdate(in api.BankAccountUpdate) (bankAccountRecord, map[string]string) {
	rec := bankAccountRecord{
		Bin:           strings.TrimSpace(in.Bin),
		AccountNumber: strings.TrimSpace(in.AccountNumber),
		AccountName:   strings.TrimSpace(in.AccountName),
	}
	fields := map[string]string{}
	if len(rec.Bin) != 6 || !isDigits(rec.Bin) {
		fields["bin"] = msgKey(codeValidation)
	}
	if !isDigits(rec.AccountNumber) || len(rec.AccountNumber) > 19 {
		// isDigits is false for the empty string, so this also rejects a blank accountNumber.
		fields["accountNumber"] = msgKey(codeValidation)
	}
	if rec.AccountName == "" {
		fields["accountName"] = msgKey(codeValidation)
	}
	if len(fields) == 0 {
		return rec, nil
	}
	return rec, fields
}

// isDigits reports whether s is non-empty and all ASCII digits.
func isDigits(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

// settingsDTO decodes the settings singleton's jsonb columns into the typed contract shape. shop_info
// and shipping_rules are free-form jsonb (their precise shapes are pinned in the Phase-1 storefront
// slice; typed loosely here on purpose). A decode failure is a server fault (corrupt settings row) →
// surfaced as an error (500), never a partial/blank body. Money-bearing fields carry no formatting.
func settingsDTO(row sqlc.Setting) (api.Settings, error) {
	var bank api.BankAccount
	if len(row.BankAccount) > 0 {
		if err := json.Unmarshal(row.BankAccount, &bank); err != nil {
			return api.Settings{}, fmt.Errorf("settings: decode bank_account: %w", err)
		}
	}
	var shop map[string]interface{}
	if len(row.ShopInfo) > 0 {
		if err := json.Unmarshal(row.ShopInfo, &shop); err != nil {
			return api.Settings{}, fmt.Errorf("settings: decode shop_info: %w", err)
		}
	}
	var rules []map[string]interface{}
	if len(row.ShippingRules) > 0 {
		if err := json.Unmarshal(row.ShippingRules, &rules); err != nil {
			return api.Settings{}, fmt.Errorf("settings: decode shipping_rules: %w", err)
		}
	}
	return api.Settings{
		BankAccount:   bank,
		ShopInfo:      &shop,
		ShippingRules: &rules,
		RefundPolicy:  row.RefundPolicy,
		UpdatedAt:     row.UpdatedAt.Time,
	}, nil
}

// replyTemplatesDTO maps the persisted reply templates to their wire shape, decoding the `variables`
// jsonb array of placeholder tokens. A nil/empty column yields a non-nil empty slice so the JSON
// renders `[]`, not `null`.
func replyTemplatesDTO(rows []sqlc.ReplyTemplate) ([]api.ReplyTemplate, error) {
	out := make([]api.ReplyTemplate, len(rows))
	for i, r := range rows {
		vars := []string{}
		if len(r.Variables) > 0 {
			if err := json.Unmarshal(r.Variables, &vars); err != nil {
				return nil, fmt.Errorf("reply template %s: decode variables: %w", r.ID, err)
			}
		}
		out[i] = api.ReplyTemplate{
			Id:        r.ID,
			Title:     r.Title,
			Body:      r.Body,
			Variables: vars,
			CreatedAt: r.CreatedAt.Time,
			UpdatedAt: r.UpdatedAt.Time,
		}
	}
	return out, nil
}
