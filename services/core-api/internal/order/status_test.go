package order

import (
	"errors"
	"testing"
)

const validAt = "2026-06-25T00:00:00.000Z"

// validEdges is the spec.md §04 transition table, independently transcribed here so
// the test pins the table rather than echoing the implementation's allowedEdges.
var validEdges = map[string]bool{
	"PENDING_CONFIRM>PAID":      true,
	"PENDING_CONFIRM>CANCELLED": true,
	"PAID>PRINTING":             true,
	"PAID>CANCELLED":            true,
	"PAID>REFUNDED":             true,
	"PRINTING>SHIPPING":         true,
	"PRINTING>CANCELLED":        true,
	"PRINTING>REFUNDED":         true,
	"SHIPPING>COMPLETED":        true,
	"SHIPPING>CANCELLED":        true,
	"SHIPPING>REFUNDED":         true,
}

// ownerOnly is the independently-transcribed set of money-in/out edges (ADR-010).
var ownerOnly = map[string]bool{
	"PENDING_CONFIRM>PAID": true,
	"PAID>REFUNDED":        true,
	"PRINTING>REFUNDED":    true,
	"SHIPPING>REFUNDED":    true,
}

func edge(from, to Status) string { return string(from) + ">" + string(to) }

func ptr(s Status) *Status { return &s }

func wantCode(t *testing.T, err error, code ErrorCode) {
	t.Helper()
	var te *TransitionError
	if !errors.As(err, &te) {
		t.Fatalf("err = %v, want *TransitionError", err)
	}
	if te.Code != code {
		t.Fatalf("err code = %q, want %q", te.Code, code)
	}
}

// OSM-01 — every from×to pair goes through the guard; only spec edges are allowed,
// and backward / skip / terminal-escape moves are rejected.
func TestOSM01TransitionTable(t *testing.T) {
	for _, from := range Statuses {
		for _, to := range Statuses {
			want := validEdges[edge(from, to)]
			if got := IsAllowedEdge(from, to); got != want {
				t.Errorf("IsAllowedEdge(%s, %s) = %v, want %v", from, to, got, want)
			}
		}
	}

	// Spot-check the forbidden classes called out in spec.md §04.
	for _, c := range []struct {
		name     string
		from, to Status
	}{
		{"backward", Printing, Paid},
		{"skip", Paid, Shipping},
		{"skip-2", PendingConfirm, Printing},
		{"terminal-completed", Completed, Cancelled},
		{"terminal-cancelled", Cancelled, Paid},
		{"terminal-refunded", Refunded, Paid},
		{"refund-from-pending", PendingConfirm, Refunded},
		{"refund-from-completed", Completed, Refunded},
		{"self-loop", Paid, Paid},
	} {
		if IsAllowedEdge(c.from, c.to) {
			t.Errorf("%s: %s → %s must be rejected", c.name, c.from, c.to)
		}
	}
}

// OSM-02 — a valid transition appends exactly one statusHistory record and never
// mutates the input order.
func TestOSM02AppendsStatusHistory(t *testing.T) {
	start := Order{Status: PendingConfirm, StatusHistory: []StatusEvent{}}
	got, err := Transition(start, Paid, TransitionContext{Role: RoleOwner, ByUser: "owner-1", At: validAt})
	if err != nil {
		t.Fatalf("valid transition errored: %v", err)
	}
	if got.Status != Paid {
		t.Fatalf("status = %s, want PAID", got.Status)
	}
	if len(got.StatusHistory) != 1 {
		t.Fatalf("history len = %d, want exactly 1", len(got.StatusHistory))
	}
	ev := got.StatusHistory[0]
	if ev.From == nil || *ev.From != PendingConfirm || ev.To != Paid || ev.At != validAt || ev.ByUser != "owner-1" {
		t.Fatalf("event = %+v, want {from:PENDING_CONFIRM to:PAID at:%s byUser:owner-1}", ev, validAt)
	}
	if len(start.StatusHistory) != 0 {
		t.Fatalf("input order was mutated: history len = %d, want 0", len(start.StatusHistory))
	}

	// A second hop appends a second record onto a fresh slice without touching the first.
	got2, err := Transition(got, Printing, TransitionContext{Role: RoleStaff, ByUser: "staff-1", At: validAt})
	if err != nil {
		t.Fatalf("second transition errored: %v", err)
	}
	if len(got2.StatusHistory) != 2 || len(got.StatusHistory) != 1 {
		t.Fatalf("history lens = (%d, %d), want (2, 1)", len(got2.StatusHistory), len(got.StatusHistory))
	}
}

// OSM-03 — CANCELLED and REFUNDED require a non-empty reason; REFUNDED additionally
// requires a valid refundProofUrl.
func TestOSM03ReasonAndRefundProof(t *testing.T) {
	paid := Order{Status: Paid, StatusHistory: []StatusEvent{}}

	if _, err := Transition(paid, Cancelled, TransitionContext{Role: RoleOwner, ByUser: "u", At: validAt}); err == nil {
		t.Fatal("CANCELLED without reason must be rejected")
	} else {
		wantCode(t, err, ErrReasonRequired)
	}

	if _, err := Transition(paid, Cancelled, TransitionContext{Role: RoleOwner, ByUser: "u", At: validAt, Reason: "khách bỏ"}); err != nil {
		t.Fatalf("CANCELLED with reason should pass: %v", err)
	}

	if _, err := Transition(paid, Refunded, TransitionContext{Role: RoleOwner, ByUser: "u", At: validAt}); err == nil {
		t.Fatal("REFUNDED without reason must be rejected")
	} else {
		wantCode(t, err, ErrReasonRequired)
	}

	if _, err := Transition(paid, Refunded, TransitionContext{Role: RoleOwner, ByUser: "u", At: validAt, Reason: "lỗi shop"}); err == nil {
		t.Fatal("REFUNDED without refundProofUrl must be rejected")
	} else {
		wantCode(t, err, ErrRefundProofRequired)
	}

	for _, bad := range []string{"not-a-url", "ftp://x/y", "  ", "http://"} {
		if _, err := Transition(paid, Refunded, TransitionContext{Role: RoleOwner, ByUser: "u", At: validAt, Reason: "lỗi shop", RefundProofURL: bad}); err == nil {
			t.Fatalf("REFUNDED with invalid proof %q must be rejected", bad)
		}
	}

	got, err := Transition(paid, Refunded, TransitionContext{Role: RoleOwner, ByUser: "u", At: validAt, Reason: "lỗi shop", RefundProofURL: "https://garage.local/refund/1.jpg"})
	if err != nil {
		t.Fatalf("REFUNDED with reason + proof should pass: %v", err)
	}
	ev := got.StatusHistory[len(got.StatusHistory)-1]
	if ev.Reason != "lỗi shop" || ev.RefundProofURL != "https://garage.local/refund/1.jpg" {
		t.Fatalf("event reason/proof not recorded: %+v", ev)
	}
}

// OSM-04 — staff cannot reconcile → PAID (web) nor refund; both are owner-only.
func TestOSM04ReconcileAndRefundOwnerOnly(t *testing.T) {
	pending := Order{Status: PendingConfirm, StatusHistory: []StatusEvent{}}
	if _, err := Transition(pending, Paid, TransitionContext{Role: RoleStaff, ByUser: "staff-1", At: validAt}); err == nil {
		t.Fatal("staff reconcile → PAID must be rejected")
	} else {
		wantCode(t, err, ErrRBAC)
	}
	if _, err := Transition(pending, Paid, TransitionContext{Role: RoleOwner, ByUser: "owner-1", At: validAt}); err != nil {
		t.Fatalf("owner reconcile → PAID should pass: %v", err)
	}

	paid := Order{Status: Paid, StatusHistory: []StatusEvent{}}
	if _, err := Transition(paid, Refunded, TransitionContext{Role: RoleStaff, ByUser: "staff-1", At: validAt, Reason: "x", RefundProofURL: "https://x/y.jpg"}); err == nil {
		t.Fatal("staff → REFUNDED must be rejected")
	} else {
		wantCode(t, err, ErrRBAC)
	}
}

// OSM-05 — full RBAC matrix over every valid edge × role.
func TestOSM05RBACMatrix(t *testing.T) {
	for e := range validEdges {
		var from, to Status
		for i := 0; i < len(e); i++ {
			if e[i] == '>' {
				from, to = Status(e[:i]), Status(e[i+1:])
				break
			}
		}
		owner := ownerOnly[e]

		// owner may always take a valid edge.
		if !RoleAllowed(from, to, RoleOwner) {
			t.Errorf("owner should be allowed on %s", e)
		}
		// staff may take any valid edge that is not owner-only.
		if got := RoleAllowed(from, to, RoleStaff); got == owner {
			t.Errorf("staff allowed on %s = %v, want %v (owner-only=%v)", e, got, !owner, owner)
		}
		// system may take only SHIPPING → COMPLETED.
		wantSystem := from == Shipping && to == Completed
		if got := RoleAllowed(from, to, RoleSystem); got != wantSystem {
			t.Errorf("system allowed on %s = %v, want %v", e, got, wantSystem)
		}
		// CanTransition agrees with RoleAllowed on a structurally valid edge.
		if CanTransition(from, to, RoleOwner) != RoleAllowed(from, to, RoleOwner) {
			t.Errorf("CanTransition disagrees with RoleAllowed on %s", e)
		}
	}
}

func TestInitialStatusForChannel(t *testing.T) {
	if _, err := InitialStatusForChannel(ChannelWeb, false); err == nil {
		t.Fatal("web without payment proof must be rejected")
	} else {
		wantCode(t, err, ErrProofRequired)
	}
	if s, err := InitialStatusForChannel(ChannelWeb, true); err != nil || s != PendingConfirm {
		t.Fatalf("web with proof = (%s, %v), want (PENDING_CONFIRM, nil)", s, err)
	}
	if s, err := InitialStatusForChannel(ChannelInbox, false); err != nil || s != Paid {
		t.Fatalf("inbox = (%s, %v), want (PAID, nil)", s, err)
	}
}

func TestTransitionActorAndTimestampValidation(t *testing.T) {
	paid := Order{Status: PendingConfirm, StatusHistory: []StatusEvent{}}
	if _, err := Transition(paid, Paid, TransitionContext{Role: RoleOwner, ByUser: "  ", At: validAt}); err == nil {
		t.Fatal("empty byUser must be rejected")
	} else {
		wantCode(t, err, ErrInvalidActor)
	}
	// The last three are regex-valid but calendar-impossible — they exercise the
	// time.Parse backstop in isISOUTC (the server rejects what TS's Date.parse rolls
	// forward), so dropping that backstop would turn this RED.
	for _, bad := range []string{
		"", "2026-06-25", "2026-06-25T00:00:00+07:00", "not-a-time",
		"2026-13-99T00:00:00Z", "2026-02-30T00:00:00.000Z", "2026-06-25T24:00:00Z",
	} {
		if _, err := Transition(paid, Paid, TransitionContext{Role: RoleOwner, ByUser: "u", At: bad}); err == nil {
			t.Fatalf("invalid timestamp %q must be rejected", bad)
		} else {
			wantCode(t, err, ErrInvalidTimestamp)
		}
	}
}

func TestReplayStatus(t *testing.T) {
	valid := []StatusEvent{
		{From: nil, To: PendingConfirm, At: validAt, ByUser: "system"},
		{From: ptr(PendingConfirm), To: Paid, At: validAt, ByUser: "owner"},
		{From: ptr(Paid), To: Printing, At: validAt, ByUser: "staff"},
	}
	if s, err := ReplayStatus(valid); err != nil || s != Printing {
		t.Fatalf("replay valid = (%s, %v), want (PRINTING, nil)", s, err)
	}

	if _, err := ReplayStatus(nil); err == nil {
		t.Fatal("empty history must error")
	} else {
		wantCode(t, err, ErrInvalidEdge)
	}

	broken := []StatusEvent{
		{From: ptr(PendingConfirm), To: Paid, At: validAt, ByUser: "owner"},
		{From: ptr(Printing), To: Shipping, At: validAt, ByUser: "staff"}, // From != prev.To
	}
	if _, err := ReplayStatus(broken); err == nil {
		t.Fatal("non-contiguous history must error")
	}

	illegal := []StatusEvent{
		{From: ptr(Paid), To: Shipping, At: validAt, ByUser: "staff"}, // not a valid edge
	}
	if _, err := ReplayStatus(illegal); err == nil {
		t.Fatal("illegal-edge history must error")
	}
}

func TestIsTerminal(t *testing.T) {
	for _, s := range []Status{Completed, Cancelled, Refunded} {
		if !IsTerminal(s) {
			t.Errorf("%s should be terminal", s)
		}
	}
	for _, s := range []Status{PendingConfirm, Paid, Printing, Shipping} {
		if IsTerminal(s) {
			t.Errorf("%s should not be terminal", s)
		}
	}
}
