// Package order implements the OrderStatus state machine: the transition guard,
// RBAC, reason / owner-only rules, and the statusHistory append. The SERVER is
// authoritative — clients never self-transition (architecture.md §6, spec.md §04,
// conventions.md §statusHistory).
//
// This is the Go port of packages/core/src/order-state.ts — the reference spine
// the TS frontends share. Parity with that file is enforced by the OSM-01..05
// battery in status_test.go; keep the two in lockstep when either changes.
//
// MUTATION-GATE ANCHORS (forward-compat with a future Go sibling of
// tests/harness/osm-mutation.test.sh): the single-line `allowedEdges` string plus
// the hash-prefixed end-of-line markers EDGES / GUARDMATCH / GUARDCALL / REASON /
// HISTORY, each on its own code line. Do NOT split those lines or repeat the
// hash-prefixed form elsewhere — a kill-gate sed must match ONLY the code line.
package order

import (
	"fmt"
	"net/url"
	"regexp"
	"strings"
	"time"
)

// Status is one OrderStatus enum value (spec.md §04): 5 progress milestones plus
// 2 close states (cancel / refund).
type Status string

const (
	PendingConfirm Status = "PENDING_CONFIRM"
	Paid           Status = "PAID"
	Printing       Status = "PRINTING"
	Shipping       Status = "SHIPPING"
	Completed      Status = "COMPLETED"
	Cancelled      Status = "CANCELLED"
	Refunded       Status = "REFUNDED"
)

// Statuses is the canonical ordering (mirrors ORDER_STATUSES in core).
var Statuses = []Status{
	PendingConfirm, Paid, Printing, Shipping, Completed, Cancelled, Refunded,
}

// Role is who is attempting a transition (spec.md §08).
type Role string

const (
	RoleOwner  Role = "owner"
	RoleStaff  Role = "staff"
	RoleSystem Role = "system"
)

// Channel is the order's origin (spec.md §04).
type Channel string

const (
	ChannelWeb   Channel = "web"
	ChannelInbox Channel = "inbox"
)

// allowedEdges is the transition table (spec.md §04). Single space-joined line so
// a future Go mutation gate can sed-target it, mirroring order-state.ts.
const allowedEdges = "PENDING_CONFIRM>PAID PENDING_CONFIRM>CANCELLED PAID>PRINTING PAID>CANCELLED PAID>REFUNDED PRINTING>SHIPPING PRINTING>CANCELLED PRINTING>REFUNDED SHIPPING>COMPLETED SHIPPING>CANCELLED SHIPPING>REFUNDED" // #EDGES

// terminalStatuses have no outgoing edge (spec.md §04).
var terminalStatuses = map[Status]bool{Completed: true, Cancelled: true, Refunded: true}

// ownerOnlyEdges — money in (reconcile → PAID) and money out (→ REFUNDED). ADR-010.
var ownerOnlyEdges = map[string]bool{
	"PENDING_CONFIRM>PAID": true,
	"PAID>REFUNDED":        true,
	"PRINTING>REFUNDED":    true,
	"SHIPPING>REFUNDED":    true,
}

// reasonRequired destinations need a non-empty reason; REFUNDED additionally needs
// a refundProofUrl (conventions.md §statusHistory).
var reasonRequired = map[Status]bool{Cancelled: true, Refunded: true}

// IsTerminal reports whether s is a close state with no outgoing edge.
func IsTerminal(s Status) bool { return terminalStatuses[s] }

// StatusEvent is one appended statusHistory record (spec.md §02 / §04). From is
// nil only for the creation event.
type StatusEvent struct {
	From           *Status `json:"from"`
	To             Status  `json:"to"`
	At             string  `json:"at"` // ISO-8601 UTC
	ByUser         string  `json:"byUser"`
	Reason         string  `json:"reason,omitempty"`
	RefundProofURL string  `json:"refundProofUrl,omitempty"`
}

// Order is the minimal shape the state machine reads and writes.
type Order struct {
	Status        Status
	StatusHistory []StatusEvent
}

// TransitionContext carries who/when plus the optional reason and refund proof.
type TransitionContext struct {
	Role           Role
	ByUser         string
	At             string // ISO-8601 UTC
	Reason         string
	RefundProofURL string
}

// ErrorCode is a machine-readable transition failure reason.
type ErrorCode string

const (
	ErrInvalidEdge         ErrorCode = "INVALID_EDGE"
	ErrRBAC                ErrorCode = "RBAC"
	ErrReasonRequired      ErrorCode = "REASON_REQUIRED"
	ErrRefundProofRequired ErrorCode = "REFUND_PROOF_REQUIRED"
	ErrProofRequired       ErrorCode = "PROOF_REQUIRED"
	ErrInvalidActor        ErrorCode = "INVALID_ACTOR"
	ErrInvalidTimestamp    ErrorCode = "INVALID_TIMESTAMP"
)

// TransitionError carries a machine-readable code plus a human (Vietnamese) message.
type TransitionError struct {
	Code    ErrorCode
	Message string
}

func (e *TransitionError) Error() string { return string(e.Code) + ": " + e.Message }

// isoUTC mirrors StatusEventSchema.at in core: an explicit trailing Z (no numeric
// offset), optional fractional seconds.
var isoUTC = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$`)

// isISOUTC reports whether s is a Z-suffixed ISO-8601 UTC instant that also parses.
// The time.Parse backstop rejects calendar-impossible instants (e.g. 2026-02-30,
// hour 24) that the TS reference's Date.parse would silently roll forward — the
// authoritative server is intentionally STRICTER than the lenient browser API on
// malformed timestamps. Real frontends emit Date.toISOString(), which never trips this.
func isISOUTC(s string) bool {
	if !isoUTC.MatchString(s) {
		return false
	}
	_, err := time.Parse(time.RFC3339Nano, s)
	return err == nil
}

// isHTTPURL reports whether s is a non-empty http/https URL with a host. Like
// isISOUTC, this is intentionally STRICTER than the TS reference's WHATWG URL() (which
// coerces hostless shapes like "http:example.com" into a host) — the server rejects
// degenerate/hostless URLs for a refund-proof image rather than silently coercing them.
func isHTTPURL(s string) bool {
	s = strings.TrimSpace(s)
	if s == "" {
		return false
	}
	u, err := url.Parse(s)
	if err != nil || u.Host == "" {
		return false
	}
	return u.Scheme == "http" || u.Scheme == "https"
}

// IsAllowedEdge reports whether from → to is a structurally valid edge (ignores
// role and reason).
func IsAllowedEdge(from, to Status) bool {
	target := string(from) + ">" + string(to)
	for _, e := range strings.Fields(allowedEdges) { // #GUARDMATCH
		if e == target {
			return true
		}
	}
	return false
}

// IsOwnerOnly reports whether from → to is a money-in/out edge restricted to owner.
func IsOwnerOnly(from, to Status) bool {
	return ownerOnlyEdges[string(from)+">"+string(to)]
}

// RoleAllowed enforces RBAC for an edge. Owner-only edges require owner; system may
// only confirm delivery (→ COMPLETED); owner/staff may take any non-owner-only edge.
func RoleAllowed(from, to Status, role Role) bool {
	if IsOwnerOnly(from, to) {
		return role == RoleOwner
	}
	if role == RoleOwner || role == RoleStaff {
		return true
	}
	return role == RoleSystem && to == Completed
}

// CanTransition reports whether the edge is both structurally valid and allowed
// for the role.
func CanTransition(from, to Status, role Role) bool {
	return IsAllowedEdge(from, to) && RoleAllowed(from, to, role)
}

// InitialStatusForChannel returns the entry status per channel (spec.md §04):
// web → PENDING_CONFIRM (requires payment proof), inbox → PAID.
func InitialStatusForChannel(channel Channel, hasPaymentProof bool) (Status, error) {
	if channel == ChannelWeb {
		if !hasPaymentProof {
			return "", &TransitionError{
				Code:    ErrProofRequired,
				Message: "Đơn web chỉ tạo sau khi khách đính ảnh biên lai chuyển khoản.",
			}
		}
		return PendingConfirm, nil
	}
	return Paid, nil
}

// Transition applies a state change: it validates edge + RBAC + actor + timestamp +
// reason rules, then appends exactly one statusHistory record. It returns a NEW
// Order (the input is never mutated) and a *TransitionError on any violation.
func Transition(o Order, to Status, ctx TransitionContext) (Order, error) {
	from := o.Status
	if !IsAllowedEdge(from, to) { // #GUARDCALL
		return Order{}, &TransitionError{ErrInvalidEdge, fmt.Sprintf("Không thể chuyển %s → %s.", from, to)}
	}
	if !RoleAllowed(from, to, ctx.Role) {
		return Order{}, &TransitionError{ErrRBAC, fmt.Sprintf("Vai trò %s không được phép chuyển %s → %s.", ctx.Role, from, to)}
	}
	if strings.TrimSpace(ctx.ByUser) == "" {
		return Order{}, &TransitionError{ErrInvalidActor, "statusHistory cần byUser (người thực hiện) không rỗng."}
	}
	if !isISOUTC(ctx.At) {
		return Order{}, &TransitionError{ErrInvalidTimestamp, "statusHistory.at phải là ISO-8601 UTC (vd 2026-06-25T00:00:00.000Z)."}
	}
	if reasonRequired[to] && strings.TrimSpace(ctx.Reason) == "" { // #REASON
		return Order{}, &TransitionError{ErrReasonRequired, fmt.Sprintf("Chuyển sang %s cần lý do.", to)}
	}
	if to == Refunded && !isHTTPURL(ctx.RefundProofURL) {
		return Order{}, &TransitionError{ErrRefundProofRequired, "REFUNDED cần refundProofUrl hợp lệ (ảnh chuyển hoàn, http/https)."}
	}

	fromCopy := from
	event := StatusEvent{From: &fromCopy, To: to, At: ctx.At, ByUser: ctx.ByUser}
	if r := strings.TrimSpace(ctx.Reason); r != "" {
		event.Reason = r
	}
	if p := strings.TrimSpace(ctx.RefundProofURL); p != "" {
		event.RefundProofURL = p
	}
	// Fresh slice so the returned order never aliases the caller's history backing array.
	history := append(append([]StatusEvent{}, o.StatusHistory...), event) // #HISTORY
	return Order{Status: to, StatusHistory: history}, nil
}

// ReplayStatus replays a statusHistory chain back to a status, asserting every hop
// is contiguous (each From matches the previous To) and a valid edge.
func ReplayStatus(history []StatusEvent) (Status, error) {
	if len(history) == 0 {
		return "", &TransitionError{ErrInvalidEdge, "statusHistory rỗng."}
	}
	var prev *StatusEvent
	for i := range history {
		ev := history[i]
		if prev != nil && (ev.From == nil || *ev.From != prev.To) {
			return "", &TransitionError{ErrInvalidEdge, fmt.Sprintf("statusHistory đứt đoạn tại %s.", fromLabel(ev))}
		}
		if ev.From != nil && !IsAllowedEdge(*ev.From, ev.To) {
			return "", &TransitionError{ErrInvalidEdge, fmt.Sprintf("Cạnh không hợp lệ trong lịch sử: %s → %s.", *ev.From, ev.To)}
		}
		prev = &history[i]
	}
	return history[len(history)-1].To, nil
}

// fromLabel renders an event's From for error messages (nil → "null").
func fromLabel(ev StatusEvent) string {
	if ev.From == nil {
		return "null"
	}
	return string(*ev.From)
}
