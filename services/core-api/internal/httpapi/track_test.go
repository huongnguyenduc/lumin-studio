package httpapi

import "testing"

// The tracking token is the ENTIRE authorization for GET /orders/track (P2-i, D-P2-8), so its signer
// is unit-tested Docker-free — this runs in every `make verify-go`, not only CI-with-Docker. It must be
// deterministic, keyed by the secret, stable across the code normalization the DB match uses, and
// reject any tampered/foreign token. The constant-time compare (hmac.Equal) is a property of valid()'s
// implementation; the guard ARM pins its presence in prod source.
func TestTrackingSignerRoundTrip(t *testing.T) {
	s := newTrackingSigner("test-tracking-secret")
	const code = "#LMN-1000"
	tok := s.token(code)

	if tok == "" {
		t.Fatal("token is empty")
	}
	if !s.valid(code, tok) {
		t.Fatal("valid(code, correct token) = false")
	}
	if s.token(code) != tok {
		t.Fatal("token is not deterministic")
	}
	// Stable across the same normalization the DB match / limiter key use (normalizeLookupCode), so a
	// token minted from the canonical code still verifies a differently-cased/spaced client input.
	if !s.valid("  #lmn-1000 ", tok) {
		t.Fatal("token not stable across normalizeLookupCode")
	}
	// Any tampered, truncated or empty token is rejected.
	for _, bad := range []string{"", tok + "x", tok[:len(tok)-1], "AAAA"} {
		if s.valid(code, bad) {
			t.Errorf("valid(code, %q) = true, want false (tampered token accepted)", bad)
		}
	}
	// A different code yields a different token, and cross-verifying fails — a token is bound to ONE
	// order, so leaking one link never grants another (blast radius = 1, plan §7).
	other := s.token("#LMN-1001")
	if other == tok {
		t.Fatal("distinct codes produced the same token")
	}
	if s.valid(code, other) {
		t.Fatal("a token for a different code verified (capability is not code-bound)")
	}
	// The secret actually keys the MAC: a different secret over the same code is a different token —
	// this is what makes a forgeable TRACKING_SECRET (guarded by main.go fail-fast) the whole risk.
	if newTrackingSigner("other-secret").token(code) == tok {
		t.Fatal("token is independent of the secret (forgeable)")
	}
}
