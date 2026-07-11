// order.go holds the order value types persisted alongside the state machine — Address
// (shipping) and Personalization (per-item engraving) — plus GenesisEvent, the from=nil
// creation record that seeds an order's statusHistory. These reuse the same Go types the
// data layer maps the jsonb columns to (sqlc overrides), so the persisted shapes cannot
// drift from the domain (plan core-data-layer §3, ADR-004). status.go stays focused on the
// transition guard and its mutation-gate anchors; keep value types and the genesis helper here.
package order

import (
	"strings"

	"github.com/google/uuid"
)

// Address is a Vietnamese shipping address: province → ward → street, with NO district level
// (ADR-017). Byte-identical to packages/core AddressSchema (the OpenAPI/TS contract). The
// district level was abolished administratively; a District field must never be reintroduced.
type Address struct {
	Province string `json:"province"`
	Ward     string `json:"ward"`
	Street   string `json:"street"`
}

// Personalization is one order item's engraving: the text plus the zone it sits in (a valid
// engrave point declared on the product model). Byte-identical to packages/core
// PersonalizationSchema. Persisted as a nullable jsonb column (nil = no engraving).
type Personalization struct {
	Text   string `json:"text"`
	ZoneID string `json:"zoneId"`
}

// PartColorSelection is one part's chosen colour as it arrives from the client (ADR-037): for a product
// with named parts the customer picks one colour per part. It is the pricing INPUT (pricing.Selection
// validates the colour ∈ the part) — ids only, because the client is not trusted for names. At capture
// the server resolves it into a PartColorSnapshot (the persisted, denormalized record). Byte-identical to
// packages/core PartColorSelectionSchema and the OpenAPI PartColorSelection.
type PartColorSelection struct {
	PartID  uuid.UUID `json:"partId"`
	ColorID uuid.UUID `json:"colorId"`
}

// OptionChoiceSelection is one choice-option's picked choice as it arrives from the client (ADR-037): for
// an option that offers enumerated choices the customer picks exactly one (priced by the choice's own
// delta). Like PartColorSelection it is the pricing input (ids only); the server denormalizes it into an
// OptionChoiceSnapshot at capture. Byte-identical to packages/core OptionChoiceSelectionSchema and the
// OpenAPI OptionChoiceSelection.
type OptionChoiceSelection struct {
	OptionID uuid.UUID `json:"optionId"`
	ChoiceID uuid.UUID `json:"choiceId"`
}

// PartColorSnapshot is the DENORMALIZED per-part colour frozen into the order_items.part_colors jsonb at
// capture (ADR-037 pt 2): the ids for lineage PLUS the part name + colour name/hex resolved from the
// catalog AT ORDER TIME. Storing the names on the line means admin order-detail and the print queue read
// what-to-make with no live catalog join — and a later colour rename or delete can never rewrite what a
// sold order says. The server builds it from a validated PartColorSelection + the priced catalog
// (httpapi.partColorSnapshotsFrom); the client never sends names.
type PartColorSnapshot struct {
	PartID    uuid.UUID `json:"partId"`
	PartName  string    `json:"partName"`
	ColorID   uuid.UUID `json:"colorId"`
	ColorName string    `json:"colorName"`
	Hex       string    `json:"hex"`
}

// OptionChoiceSnapshot is the denormalized picked choice frozen into order_items.option_choices at capture
// (ADR-037 pt 2): the ids plus the option label + choice label resolved at order time, so the reads show
// "Kích thước: Lớn" without joining the live catalog. Built server-side from a validated
// OptionChoiceSelection + the priced catalog.
type OptionChoiceSnapshot struct {
	OptionID    uuid.UUID `json:"optionId"`
	OptionLabel string    `json:"optionLabel"`
	ChoiceID    uuid.UUID `json:"choiceId"`
	ChoiceLabel string    `json:"choiceLabel"`
}

// GenesisEvent builds the first statusHistory record for a newly created order: From is nil
// (no prior state) and To is the channel's entry status (from InitialStatusForChannel). It
// validates the actor and timestamp exactly as Transition does, so every history — genesis
// or transition — carries a non-empty byUser and an ISO-8601 UTC instant. ReplayStatus
// accepts the resulting from=nil leading event. There is no edge/RBAC check: creation is not
// a transition, it is the order coming into existence.
func GenesisEvent(to Status, ctx TransitionContext) (StatusEvent, error) {
	if strings.TrimSpace(ctx.ByUser) == "" {
		return StatusEvent{}, &TransitionError{ErrInvalidActor, "statusHistory cần byUser (người thực hiện) không rỗng."}
	}
	if !isISOUTC(ctx.At) {
		return StatusEvent{}, &TransitionError{ErrInvalidTimestamp, "statusHistory.at phải là ISO-8601 UTC (vd 2026-06-25T00:00:00.000Z)."}
	}
	return StatusEvent{From: nil, To: to, At: ctx.At, ByUser: ctx.ByUser}, nil
}
