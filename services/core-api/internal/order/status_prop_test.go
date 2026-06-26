package order

import (
	"testing"
	"testing/quick"
)

// Property (ADR-027 REC-E): replaying the statusHistory produced by a random valid
// walk reconstructs the final status, and the history length is exactly the number
// of hops plus the creation event. The walk is driven by the independently-
// transcribed validEdges table (not the implementation's allowedEdges), so this
// pins Transition + ReplayStatus as mutually consistent against the spec graph.
func TestReplayMatchesValidWalkProperty(t *testing.T) {
	adj := map[Status][]Status{}
	for _, from := range Statuses {
		for _, to := range Statuses {
			if validEdges[edge(from, to)] {
				adj[from] = append(adj[from], to)
			}
		}
	}

	f := func(choices []uint8) bool {
		o := Order{Status: PendingConfirm, StatusHistory: []StatusEvent{
			{From: nil, To: PendingConfirm, At: validAt, ByUser: "system"},
		}}
		hops := 0
		for _, c := range choices {
			nexts := adj[o.Status]
			if len(nexts) == 0 {
				break // terminal — no outgoing edge
			}
			to := nexts[int(c)%len(nexts)]
			// owner is allowed on every valid edge; reason + proof are supplied so the
			// CANCELLED/REFUNDED guards never reject a structurally valid hop.
			next, err := Transition(o, to, TransitionContext{
				Role:           RoleOwner,
				ByUser:         "owner",
				At:             validAt,
				Reason:         "r",
				RefundProofURL: "https://garage.local/refund.jpg",
			})
			if err != nil {
				return false
			}
			o = next
			hops++
		}
		final, err := ReplayStatus(o.StatusHistory)
		if err != nil {
			return false
		}
		return final == o.Status && len(o.StatusHistory) == hops+1
	}

	if err := quick.Check(f, &quick.Config{MaxCount: 500}); err != nil {
		t.Fatal(err)
	}
}
