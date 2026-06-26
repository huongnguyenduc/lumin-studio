// order.go holds the order value types persisted alongside the state machine — Address
// (shipping) and Personalization (per-item engraving) — plus GenesisEvent, the from=nil
// creation record that seeds an order's statusHistory. These reuse the same Go types the
// data layer maps the jsonb columns to (sqlc overrides), so the persisted shapes cannot
// drift from the domain (plan core-data-layer §3, ADR-004). status.go stays focused on the
// transition guard and its mutation-gate anchors; keep value types and the genesis helper here.
package order

import "strings"

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
