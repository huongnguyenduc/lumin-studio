package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/url"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/order"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/pricing"
)

// CreateOrder handles POST /orders (PR-3g): order intake for both channels behind the
// optional-auth middleware (classify → authOptional: an actor is resolved iff a session cookie
// is present, an anonymous request is never rejected there).
//
// INBOX GATE (critique BLOCKER / CHK-05): `channel=inbox` mints a born-PAID order with no
// payment proof (order.InitialStatusForChannel — conventions §17: staff verified money landed
// in the DM before creating), so it is a money-creation primitive. This handler rejects it with
// 403 unless the optional-auth middleware resolved an actor; a resolved actor is ALWAYS
// staff/owner (actorRole can never yield `system`, and only users rows produce actors), so the
// presence check is the staff/owner check. `channel=web` stays public and enters at
// PENDING_CONFIRM behind a mandatory payment proof (CHK-04). §6 D2 resolved: ONE handler, one
// mount, branch on the resolved actor — no dual admin mount, the classify table stays the
// single auth-path source of truth.
//
// MONEY (ADR-019 / always-must #2): the wire input carries no price. Every line's UnitPrice is
// derived from the catalog via pricing.PriceItem, the shipping fee from settings via
// pricing.ShippingFee, and totals via money.CalcTotals inside db.CreateOrderTx. A client that
// tries to send unitPrice/subtotal/total anyway is rejected LOUDLY (400 with fields) rather
// than silently ignored — an integrator that believes it set a price must find out.
func (s *Server) CreateOrder(ctx context.Context, req api.CreateOrderRequestObject) (api.CreateOrderResponseObject, error) {
	if req.Body == nil {
		// Decode failures are caught by the strict RequestErrorHandlerFunc; this covers a nil
		// body reaching the handler (mirrors transition.go).
		return createOrderBadRequest(nil), nil
	}
	if fields := clientMoneyFields(*req.Body); len(fields) > 0 {
		return createOrderBadRequest(fields), nil
	}

	in, err := intakeFrom(ctx, *req.Body)
	var ve *validationError
	if errors.As(err, &ve) {
		return createOrderBadRequest(ve.fields), nil
	}
	if err != nil {
		// The boundary sentinels: inbox-forbidden / proof-required / ack-required / no-items.
		return nil, err
	}
	// Host-pin the receipt URL to a Garage object THIS server issued (P2-c, ADR-035), but only when
	// uploads are wired. If they are not (dev/test, or a shop that has not configured S3), the
	// storefront could not have produced a proof URL at all, so fall back to the boundary shape check
	// (intakeFrom, CHK-04) and let the STK/other gates decide — the owner still eyeballs the receipt
	// before reconciling → PAID, so no path a real web order can take silently accepts a spoofed proof.
	if in.channel == order.ChannelWeb && s.proofUploads != nil && !s.proofUploads.OwnsURL(in.proofURL) {
		return nil, errPaymentProofRequired
	}

	// Derive every line's server-authoritative price from the catalog (reads on the pool, before
	// the tx opens, so the catalog lookups don't hold the write tx open).
	items := make([]db.NewOrderItem, len(in.items))
	for i, it := range in.items {
		priced, perr := s.priceLine(ctx, it)
		if perr != nil {
			return nil, perr
		}
		items[i] = priced
	}

	// Resolve the shipping fee from settings.shipping_rules by province (no district, ADR-017;
	// no matching rule → 422 NO_SHIPPING_RULE, never a silent ₫0).
	settings, err := db.NewSettings(s.pool).Get(ctx)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			// The settings singleton is seeded by migration; its absence is a server-config
			// fault, not a client 404. Break the ErrNotFound chain (%v, not %w) so mapError
			// renders it as a logged 500 (default) instead of an unlogged NOT_FOUND.
			return nil, fmt.Errorf("checkout: settings singleton missing (unseeded?): %v", err)
		}
		return nil, err
	}

	// STK gate (P2-a): a web order is paid by transferring to the shop STK, so a web create against a
	// shop with no usable bank account cannot be honoured — reject BEFORE any write (422
	// NO_STK_CONFIGURED), the SAME signal GET /checkout/config gives. Inbox orders are staff-created and
	// already paid (born-PAID, CHK-05), so they need no STK at create time.
	if in.channel == order.ChannelWeb {
		if _, ok := stkFromSettings(settings.BankAccount); !ok {
			return nil, errNoSTKConfigured
		}
	}

	fee, err := pricing.ShippingFee(settings.ShippingRules, in.address.Province)
	if err != nil {
		return nil, err
	}

	customerParams, err := in.customerParams()
	if err != nil {
		return nil, err
	}

	// One tx: customer find-or-create + PDPL consent + order code + order/items/genesis/outbox
	// commit atomically (the seams document this contract; publish-on-commit ADR-006). The
	// response DTO is assembled INSIDE the tx too, so a read failure after the writes rolls the
	// whole thing back — the client is never handed a 500 for an order that in fact committed
	// and emitted order.created, which (idempotency deferred, §6 D5) a retry would then duplicate.
	var dto api.Order
	err = withTx(ctx, s.pool, func(tx pgx.Tx) error {
		idn := db.NewIdentity(tx)
		cust, _, cerr := idn.FindOrCreateCustomer(ctx, customerParams)
		if cerr != nil {
			return cerr
		}
		// Record the order_fulfillment consent the purchase itself grants, idempotently — a
		// returning buyer's active grant is a no-op, never a unique-violation rollback. This is
		// ONLY the fulfillment scope: marketing consent is a separate, unbundled opt-in
		// (compliance.md §2 — KHÔNG bundle, KHÔNG gate việc mua) and never rides checkout.
		if cerr := idn.GrantConsentIfAbsent(ctx, sqlc.InsertConsentGrantIfAbsentParams{
			ID:            uuid.New(),
			CustomerID:    cust.ID,
			Scope:         sqlc.ConsentScopeOrderFulfillment,
			Channel:       in.consentChannel(),
			PolicyVersion: consentPolicyVersion,
		}); cerr != nil {
			return cerr
		}
		code, cerr := db.NewOrders(tx).NextOrderCode(ctx)
		if cerr != nil {
			return cerr
		}
		row, cerr := db.CreateOrderTx(ctx, tx, db.CreateOrderInput{
			ID:              uuid.New(),
			Code:            code,
			Channel:         in.channel,
			CustomerID:      cust.ID,
			ShippingAddress: in.address,
			Items:           items,
			ShippingFee:     fee,
			PaymentProofURL: in.proofURL,
			Note:            in.note,
			At:              in.at.UTC().Format(time.RFC3339Nano),
			ByUser:          in.byUser,
		})
		if cerr != nil {
			return cerr
		}
		// Assemble the response from the tx (reads its own just-written rows) so the whole
		// create is all-or-nothing — see the block comment above.
		dto, cerr = assembleOrderDTO(ctx, tx, row)
		return cerr
	})
	if err != nil {
		return nil, err // domain/db error → mapError (handleResponseError)
	}
	// Mint the phone-less tracking token (P2-i, D-P2-8) from the order code and return it ONLY here
	// (never on the Order schema or a read endpoint). It is a deterministic HMAC of the code, so the
	// GET /orders/track read recomputes and constant-time-verifies it — no column, no migration.
	return api.CreateOrder201JSONResponse{Order: dto, TrackingToken: s.tracking.token(dto.Code)}, nil
}

const (
	// byUserCustomer is the reserved genesis actor for a guest web checkout: no storefront
	// Account identity exists this slice, so the customer self-service genesis records this
	// documented non-uuid constant instead of a users.id. It nuances locked decision #6
	// (statusHistory.byUser = users.id) — that rule holds for every staff/owner action; the
	// guest genesis is the one documented exception (plan core-http-relay §3g).
	byUserCustomer = "customer"
	// consentPolicyVersion identifies the privacy-notice version an order_fulfillment consent
	// is granted under (PDPL — consent rows carry {scope, channel, policy_version}). Static
	// until the storefront privacy-notice surface ships; bump alongside the notice text.
	consentPolicyVersion = "2026-01"
)

// vnPhoneRe is the contract's Vietnamese-mobile shape: `0` or `+84` prefix + 9 digits (spec §05).
var vnPhoneRe = regexp.MustCompile(`^(0|\+84)\d{9}$`)

// validationError carries a per-field map for a 400 VALIDATION response (ErrorEnvelope.fields,
// ADR-032). It stays inside the handler — the caller renders it directly as the typed 400, so
// mapError never needs to learn about fields.
type validationError struct {
	fields map[string]string
}

func (e *validationError) Error() string { return "httpapi: request validation failed" }

// intake is the channel-normalized create request: both union arms funnel into this one shape so
// pricing/persistence below stay channel-agnostic. byUser/at are ALREADY resolved (actor or
// guest sentinel + server clock) — nothing downstream reads the request identity again.
type intake struct {
	channel  order.Channel
	customer api.Customer
	address  order.Address
	items    []api.OrderItemInput
	proofURL string // web only: the CK receipt image URL
	note     string // inbox only: staff note ("" = none)
	byUser   string
	at       time.Time
}

// intakeFrom decodes the discriminated union, applies the per-channel boundary gates (CHK-04
// proof / CHK-05 inbox-staff / ADR-012 ack), and shape-validates the result. It returns a
// *validationError for field-level 400s and the boundary sentinels for the gate rejections;
// everything it enforces runs BEFORE any DB read.
func intakeFrom(ctx context.Context, body api.CreateOrderInput) (intake, error) {
	disc, err := body.Discriminator()
	if err != nil {
		return intake{}, &validationError{fields: map[string]string{"channel": msgKey(codeValidation)}}
	}
	actor, hasActor := actorFrom(ctx)

	var in intake
	switch disc {
	case string(order.ChannelWeb):
		w, aerr := body.AsCreateWebOrderInput()
		if aerr != nil {
			return intake{}, &validationError{fields: map[string]string{"body": msgKey(codeValidation)}}
		}
		// CHK-04: the CK receipt must be a usable http(s) URL at the boundary. The host/path pin
		// depends on server upload config, so CreateOrder applies that check after this pure
		// union decode and before the first DB read.
		proof := strings.TrimSpace(w.PaymentProofUrl)
		if !isHTTPProofURL(proof) {
			return intake{}, errPaymentProofRequired
		}
		// ADR-012: an engraved (personalized) order needs the no-return acknowledgement AND the
		// engrave-echo confirmation, both true, server-side — the UI tickbox alone is not a gate.
		if anyPersonalization(w.Items) && (!boolVal(w.PersonalizationAck) || !boolVal(w.EngraveEchoConfirmed)) {
			return intake{}, errPersonalizationAckRequired
		}
		in = intake{
			channel:  order.ChannelWeb,
			customer: w.Customer,
			address:  addressFrom(w.ShippingAddress),
			items:    w.Items,
			proofURL: proof,
			byUser:   byUserCustomer,
			at:       time.Now().UTC(),
		}
		if hasActor {
			// A logged-in staff/owner placing a web order records their real identity — the
			// guest sentinel is only for the anonymous storefront path.
			in.byUser, in.at = actor.ByUser, actor.At
		}
	case string(order.ChannelInbox):
		// CHK-05: inbox-create is staff/owner-only (it mints a born-PAID order). The middleware
		// resolves an actor only from a valid session over a users row, so presence == staff/owner.
		// A no-actor caller is rejected 403 FORBIDDEN (not 401): POST /orders is a public endpoint
		// (channel=web needs no auth), so requesting the staff-only inbox operation is an
		// AUTHORIZATION failure, not a missing-credential one — acceptance CHK-05 locks 403. This
		// is deliberately distinct from the middleware's 401 on a present-but-broken cookie, and is
		// the documented exception to actor.go's generic "ok=false ⇒ unauthenticated" guidance.
		if !hasActor {
			return intake{}, errForbidden
		}
		ib, aerr := body.AsCreateInboxOrderInput()
		if aerr != nil {
			return intake{}, &validationError{fields: map[string]string{"body": msgKey(codeValidation)}}
		}
		in = intake{
			channel:  order.ChannelInbox,
			customer: ib.Customer,
			address:  addressFrom(ib.ShippingAddress),
			items:    ib.Items,
			note:     deref(ib.Note),
			byUser:   actor.ByUser,
			at:       actor.At,
		}
	default:
		return intake{}, &validationError{fields: map[string]string{"channel": msgKey(codeValidation)}}
	}

	if len(in.items) == 0 {
		return intake{}, db.ErrNoItems // 422 NO_ITEMS — same code the seam would emit, but pre-DB
	}
	if fields := in.validate(); len(fields) > 0 {
		return intake{}, &validationError{fields: fields}
	}
	return in, nil
}

// validate shape-checks the normalized intake per spec §05 (tên 2–60 ký tự · SĐT VN · address đủ
// 3 cấp, no district ADR-017 · quantity ≥ 1). Returns a field-path → messageKey map (empty =
// valid); money and catalog-membership rules live in pricing, not here. Email format is enforced
// UPSTREAM by the typed decode (the wire type openapi_types.Email rejects a malformed address in
// UnmarshalJSON → fields:{body}), so the "@" check below is an unreached defense-in-depth backstop
// — kept in case that type ever loosens; a malformed email normally never reaches here.
func (in intake) validate() map[string]string {
	fields := map[string]string{}
	if n := utf8.RuneCountInString(strings.TrimSpace(in.customer.Name)); n < 2 || n > 60 {
		fields["customer.name"] = msgKey(codeValidation)
	}
	if !vnPhoneRe.MatchString(strings.TrimSpace(in.customer.Phone)) {
		fields["customer.phone"] = msgKey(codeValidation)
	}
	if in.customer.Email != nil && !strings.Contains(string(*in.customer.Email), "@") {
		fields["customer.email"] = msgKey(codeValidation)
	}
	if strings.TrimSpace(in.address.Province) == "" {
		fields["shippingAddress.province"] = msgKey(codeValidation)
	}
	if strings.TrimSpace(in.address.Ward) == "" {
		fields["shippingAddress.ward"] = msgKey(codeValidation)
	}
	if strings.TrimSpace(in.address.Street) == "" {
		fields["shippingAddress.street"] = msgKey(codeValidation)
	}
	for i, it := range in.items {
		if it.Quantity < 1 || it.Quantity > math.MaxInt32 {
			fields[fmt.Sprintf("items[%d].quantity", i)] = msgKey(codeValidation)
		}
		if p := personalizationFrom(it.Personalization); p != nil && strings.TrimSpace(p.ZoneID) == "" {
			fields[fmt.Sprintf("items[%d].personalization.zoneId", i)] = msgKey(codeValidation)
		}
	}
	return fields
}

// customerParams maps the intake customer to the insert used when no row matches the phone; a
// new customer's address book is seeded with the order's shipping address.
func (in intake) customerParams() (sqlc.InsertCustomerParams, error) {
	addresses, err := json.Marshal([]order.Address{in.address})
	if err != nil {
		return sqlc.InsertCustomerParams{}, fmt.Errorf("checkout: marshal addresses: %w", err)
	}
	params := sqlc.InsertCustomerParams{
		ID:           uuid.New(),
		Name:         strings.TrimSpace(in.customer.Name),
		Phone:        strings.TrimSpace(in.customer.Phone),
		SocialHandle: in.customer.SocialHandle,
		Addresses:    addresses,
	}
	if in.customer.Email != nil {
		email := string(*in.customer.Email)
		params.Email = &email
	}
	return params, nil
}

// consentChannel maps the order channel to the consent channel the grant is recorded under.
func (in intake) consentChannel() sqlc.ConsentChannel {
	if in.channel == order.ChannelInbox {
		return sqlc.ConsentChannelInbox
	}
	return sqlc.ConsentChannelWeb
}

// priceLine turns one requested line into a persisted line with a server-derived UnitPrice: it
// reads the product + its full color/option sets and routes the selection through
// pricing.PriceItem (the authenticity gate CreateOrderTx documents it does NOT perform). A
// missing or non-active product is PRODUCT_UNAVAILABLE — never a bare 404 on this public route.
func (s *Server) priceLine(ctx context.Context, it api.OrderItemInput) (db.NewOrderItem, error) {
	cat := db.NewCatalog(s.pool)
	product, err := cat.ProductByID(ctx, it.ProductId)
	if errors.Is(err, db.ErrNotFound) {
		return db.NewOrderItem{}, errProductUnavailable
	}
	if err != nil {
		return db.NewOrderItem{}, err
	}
	if product.Status != sqlc.ProductStatusActive {
		return db.NewOrderItem{}, errProductUnavailable
	}
	colors, err := cat.ColorsByProduct(ctx, product.ID)
	if err != nil {
		return db.NewOrderItem{}, err
	}
	options, err := cat.OptionsByProduct(ctx, product.ID)
	if err != nil {
		return db.NewOrderItem{}, err
	}
	parts, err := cat.PartsByProduct(ctx, product.ID)
	if err != nil {
		return db.NewOrderItem{}, err
	}
	choices, err := cat.ChoicesByProduct(ctx, product.ID)
	if err != nil {
		return db.NewOrderItem{}, err
	}

	personalization := personalizationFrom(it.Personalization)
	optionIDs := optionIDsFrom(it.OptionIds)
	// ADR-037: the wire now carries the per-part colours + per-choice picks. The SAME selection value is
	// fed to PriceItem (the money gate — validates part/choice membership) and snapshotted onto the line,
	// so the priced selection and the persisted selection can never drift (quote/charge parity, oracle
	// note c). A parts product 422s here if a part colour is missing; a flat product sends none.
	sel := pricing.Selection{
		ColorID:         it.ColorId,
		OptionIDs:       optionIDs,
		PartColors:      partColorSelectionsFrom(it.PartColors),
		OptionChoices:   optionChoiceSelectionsFrom(it.OptionChoices),
		Personalization: personalization,
	}
	unit, err := pricing.PriceItem(product, colors, options, parts, choices, sel)
	if err != nil {
		return db.NewOrderItem{}, err
	}

	// PriceItem validated the selection above, so every id is known-good here: resolve each into its
	// DENORMALIZED snapshot (ids + the part/colour/option/choice NAMES read from the catalog we already
	// fetched to price it) and persist THAT. Freezing the names at capture is ADR-037 pt 2 — admin/print
	// then read what-to-make with no live join, and a later rename can't rewrite this sold line. This is
	// display metadata only; `unit` (the money) is already computed and unaffected.
	line := db.NewOrderItem{
		ProductID:       it.ProductId,
		ColorID:         it.ColorId,
		PartColors:      partColorSnapshotsFrom(sel.PartColors, colors, parts),
		OptionChoices:   optionChoiceSnapshotsFrom(sel.OptionChoices, options, choices),
		Personalization: personalization,
		Quantity:        int32(it.Quantity), // bounds checked in validate()
		UnitPrice:       unit,
	}
	for _, id := range optionIDs {
		line.OptionIDs = append(line.OptionIDs, id.String())
	}
	return line, nil
}

// clientMoneyFields scans the raw union body for money fields the contract deliberately omits
// (unitPrice/subtotal/total/shippingFee — server-authoritative, ADR-019). encoding/json would
// silently drop them; rejecting loudly turns "my client sets the price" into a development-time
// 400 instead of a silently different charge.
//
// The scan folds case because encoding/json binds struct fields CASE-INSENSITIVELY: an
// exact-case key check would let {"Total":…} or {"Items":[{"UnitPrice":…}]} slip past the reject
// yet still decode into the order (dropping the smuggled price silently — the exact failure this
// loud-reject exists to prevent). No money can actually be set either way (the input DTOs carry
// no price field and the server re-prices), but the fail-loud contract must hold across casings.
func clientMoneyFields(body api.CreateOrderInput) map[string]string {
	raw, err := body.MarshalJSON() // returns the stored union bytes verbatim
	if err != nil {
		return nil
	}
	var top map[string]json.RawMessage
	if json.Unmarshal(raw, &top) != nil {
		return nil // not an object — the decode path 400s it anyway
	}
	fields := map[string]string{}
	for k, v := range top {
		if isMoneyKey(k) {
			fields[k] = msgKey(codeValidation)
			continue
		}
		if !strings.EqualFold(k, "items") {
			continue
		}
		var items []map[string]json.RawMessage
		if json.Unmarshal(v, &items) != nil {
			continue
		}
		for i, item := range items {
			for ik := range item {
				if strings.EqualFold(ik, "unitPrice") {
					fields[fmt.Sprintf("items[%d].unitPrice", i)] = msgKey(codeValidation)
				}
			}
		}
	}
	if len(fields) == 0 {
		return nil
	}
	return fields
}

// isMoneyKey reports whether a top-level JSON key names one of the server-authoritative money
// fields the contract omits (case-folded to mirror encoding/json's field binding).
func isMoneyKey(k string) bool {
	switch strings.ToLower(k) {
	case "subtotal", "total", "shippingfee", "unitprice":
		return true
	default:
		return false
	}
}

// createOrderBadRequest renders a 400 VALIDATION envelope, with the per-field map when present.
func createOrderBadRequest(fields map[string]string) api.CreateOrder400JSONResponse {
	env := envelope(codeValidation)
	if len(fields) > 0 {
		env.Fields = &fields
	}
	return api.CreateOrder400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(env)}
}

// isHTTPProofURL reports whether s is a non-empty http/https URL with a host — the boundary
// shape check for paymentProofUrl (mirrors the domain's unexported isHTTPURL: reject hostless/
// degenerate URLs rather than coerce them).
func isHTTPProofURL(s string) bool {
	if s == "" {
		return false
	}
	u, err := url.Parse(s)
	if err != nil || u.Host == "" {
		return false
	}
	return u.Scheme == "http" || u.Scheme == "https"
}

// anyPersonalization reports whether any line carries an engraving with non-empty text (the
// shape that triggers the ADR-012 ack requirement).
func anyPersonalization(items []api.OrderItemInput) bool {
	for _, it := range items {
		if personalizationFrom(it.Personalization) != nil {
			return true
		}
	}
	return false
}

// personalizationFrom maps the wire personalization to the domain's, normalizing an absent or
// empty-text engraving to nil (pricing and persistence both treat empty text as "none").
func personalizationFrom(p *api.Personalization) *order.Personalization {
	if p == nil || strings.TrimSpace(p.Text) == "" {
		return nil
	}
	return &order.Personalization{Text: p.Text, ZoneID: p.ZoneId}
}

// addressFrom maps the wire Address to the domain shipping address (both are the 3-level VN
// model with no district, ADR-017 — the inverse of dto.go's addressDTO).
func addressFrom(a api.Address) order.Address {
	return order.Address{Province: a.Province, Ward: a.Ward, Street: a.Street}
}

// optionIDsFrom flattens the optional wire slice ([]uuid, may be absent) to a plain slice.
func optionIDsFrom(ids *[]uuid.UUID) []uuid.UUID {
	if ids == nil {
		return nil
	}
	return *ids
}

// partColorSelectionsFrom maps the optional wire partColors ([]PartColorSelection, may be absent) to the
// domain pricing INPUT (ids only; PriceItem validates colour ∈ part). Absent → nil (a flat product). The
// persisted, denormalized record is built separately by partColorSnapshotsFrom after pricing.
func partColorSelectionsFrom(sel *[]api.PartColorSelection) []order.PartColorSelection {
	if sel == nil {
		return nil
	}
	out := make([]order.PartColorSelection, len(*sel))
	for i, s := range *sel {
		out[i] = order.PartColorSelection{PartID: s.PartId, ColorID: s.ColorId}
	}
	return out
}

// optionChoiceSelectionsFrom maps the optional wire optionChoices to the domain pricing input (ids only).
func optionChoiceSelectionsFrom(sel *[]api.OptionChoiceSelection) []order.OptionChoiceSelection {
	if sel == nil {
		return nil
	}
	out := make([]order.OptionChoiceSelection, len(*sel))
	for i, s := range *sel {
		out[i] = order.OptionChoiceSelection{OptionID: s.OptionId, ChoiceID: s.ChoiceId}
	}
	return out
}

// partColorSnapshotsFrom resolves each VALIDATED per-part colour selection into the denormalized snapshot
// persisted on the line (ADR-037 pt 2): the ids plus the part name + colour name/hex read from the catalog
// the caller already fetched to PRICE the line — so no extra query, and the priced ids and the stored names
// come from the one read. Called AFTER PriceItem, so every id resolved; a lookup miss (impossible after
// validation) leaves that name empty rather than dropping the id. Empty selection → nil (a flat product).
func partColorSnapshotsFrom(sel []order.PartColorSelection, colors []sqlc.Color, parts []sqlc.Part) []order.PartColorSnapshot {
	if len(sel) == 0 {
		return nil
	}
	partName := make(map[uuid.UUID]string, len(parts))
	for _, p := range parts {
		partName[p.ID] = p.Name
	}
	colorByID := make(map[uuid.UUID]sqlc.Color, len(colors))
	for _, c := range colors {
		colorByID[c.ID] = c
	}
	out := make([]order.PartColorSnapshot, len(sel))
	for i, pc := range sel {
		c := colorByID[pc.ColorID]
		out[i] = order.PartColorSnapshot{
			PartID:    pc.PartID,
			PartName:  partName[pc.PartID],
			ColorID:   pc.ColorID,
			ColorName: c.Name,
			Hex:       c.Hex,
		}
	}
	return out
}

// optionChoiceSnapshotsFrom resolves each validated choice pick into its denormalized snapshot (ADR-037 pt
// 2): ids + the option label + the picked choice's label, from the priced catalog. Empty → nil.
func optionChoiceSnapshotsFrom(sel []order.OptionChoiceSelection, options []sqlc.Option, choices []sqlc.OptionChoice) []order.OptionChoiceSnapshot {
	if len(sel) == 0 {
		return nil
	}
	optLabel := make(map[uuid.UUID]string, len(options))
	for _, o := range options {
		optLabel[o.ID] = o.Label
	}
	choiceLabel := make(map[uuid.UUID]string, len(choices))
	for _, c := range choices {
		choiceLabel[c.ID] = c.Label
	}
	out := make([]order.OptionChoiceSnapshot, len(sel))
	for i, oc := range sel {
		out[i] = order.OptionChoiceSnapshot{
			OptionID:    oc.OptionID,
			OptionLabel: optLabel[oc.OptionID],
			ChoiceID:    oc.ChoiceID,
			ChoiceLabel: choiceLabel[oc.ChoiceID],
		}
	}
	return out
}

// boolVal returns the pointed-to bool, false for nil (an omitted optional flag).
func boolVal(b *bool) bool {
	return b != nil && *b
}
