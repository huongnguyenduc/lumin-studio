package db

import "testing"

// TestHandleCandidates pins the vanity-handle try-order the activation dedup loop walks: the bare base
// first, then base-2…base-9 (nine candidates), before ResolveHandle falls through to a random suffix.
func TestHandleCandidates(t *testing.T) {
	got := handleCandidates("bo")
	want := []string{"bo", "bo-2", "bo-3", "bo-4", "bo-5", "bo-6", "bo-7", "bo-8", "bo-9"}
	if len(got) != len(want) {
		t.Fatalf("handleCandidates(bo) len = %d, want %d (%v)", len(got), len(want), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("candidate[%d] = %q, want %q", i, got[i], want[i])
		}
	}
}
