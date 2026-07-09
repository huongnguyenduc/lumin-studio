package proofstore

import "testing"

// TestOwnsURLResistsBypass hardens the host-pin against URLs that look plausible but are not an object
// this store issued: host confusion (userinfo, explicit port, trailing dot), percent-encoding, NUL,
// dot-segments, and non-canonical UUID/extension/date forms. Only the exact scheme+host+base-path with a
// <prefix>/YYYY/MM/DD/<canonical-uuid>.<ext> key the signer mints may be owned.
func TestOwnsURLResistsBypass(t *testing.T) {
	store := mustStore(t) // base https://assets.example.test/private/receipts, prefix "proofs"
	const validKey = "proofs/2026/07/06/11111111-2222-3333-4444-555555555555.jpg"
	valid := "https://assets.example.test/private/receipts/" + validKey
	if !store.OwnsURL(valid) {
		t.Fatal("sanity: the canonical minted URL must be owned")
	}
	for name, tc := range map[string]struct {
		raw  string
		owns bool
	}{
		"uppercase-host":     {"https://ASSETS.EXAMPLE.TEST/private/receipts/" + validKey, true},            // host compare is case-insensitive
		"userinfo-real-host": {"https://evil.test@assets.example.test/private/receipts/" + validKey, true},  // host IS assets.example.test
		"userinfo-evil-host": {"https://assets.example.test@evil.test/private/receipts/" + validKey, false}, // host is evil.test
		"explicit-443":       {"https://assets.example.test:443/private/receipts/" + validKey, false},       // safe false-negative (host carries :443)
		"trailing-dot-host":  {"https://assets.example.test./private/receipts/" + validKey, false},          // safe false-negative
		"pct-encoded-name":   {"https://assets.example.test/private/receipts/proofs/2026/07/06/%31%31%31%31%31%31%31%31-2222-3333-4444-555555555555.jpg", false},
		"pct-encoded-slash":  {"https://assets.example.test/private/receipts/proofs/2026%2F07%2F06/11111111-2222-3333-4444-555555555555.jpg", false},
		"trailing-nul":       {valid + "\x00", false},
		"dotdot-segment":     {"https://assets.example.test/private/receipts/../receipts/" + validKey, false},
		"uuid-urn":           {"https://assets.example.test/private/receipts/proofs/2026/07/06/urn:uuid:11111111-2222-3333-4444-555555555555.jpg", false},
		"uuid-braces":        {"https://assets.example.test/private/receipts/proofs/2026/07/06/{11111111-2222-3333-4444-555555555555}.jpg", false},
		"double-ext":         {"https://assets.example.test/private/receipts/proofs/2026/07/06/11111111-2222-3333-4444-555555555555.php.jpg", false},
		"invalid-leap":       {"https://assets.example.test/private/receipts/proofs/2027/02/29/11111111-2222-3333-4444-555555555555.jpg", false}, // 2027 is not a leap year
		"month-13":           {"https://assets.example.test/private/receipts/proofs/2026/13/06/11111111-2222-3333-4444-555555555555.jpg", false},
	} {
		t.Run(name, func(t *testing.T) {
			if got := store.OwnsURL(tc.raw); got != tc.owns {
				t.Fatalf("OwnsURL(%q) = %v, want %v", tc.raw, got, tc.owns)
			}
		})
	}
}

// TestOwnsURLEmptyBasePath: a public base with no path still requires the full key shape — it does not
// let an arbitrary object under the host be owned.
func TestOwnsURLEmptyBasePath(t *testing.T) {
	cfg := validConfig()
	cfg.PublicBaseURL = "https://assets.example.test"
	store, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	if !store.OwnsURL("https://assets.example.test/proofs/2026/07/06/11111111-2222-3333-4444-555555555555.jpg") {
		t.Fatal("empty base path should still own a well-shaped key")
	}
	if store.OwnsURL("https://assets.example.test/etc/passwd") {
		t.Fatal("empty base path must NOT own an arbitrary key")
	}
}

// TestOwnsObjectKeyRejectsOverflowDates: the date segment uses a strict layout, so calendar-invalid
// dates (non-leap Feb 29, month 13) are not silently normalized into a valid-looking key.
func TestOwnsObjectKeyRejectsOverflowDates(t *testing.T) {
	store := mustStore(t)
	for _, key := range []string{
		"proofs/2027/02/29/11111111-2222-3333-4444-555555555555.jpg",
		"proofs/2026/13/06/11111111-2222-3333-4444-555555555555.jpg",
	} {
		if store.ownsObjectKey(key) {
			t.Errorf("ownsObjectKey(%q) = true, want false (overflow date)", key)
		}
	}
	if !store.ownsObjectKey("proofs/2026/07/06/11111111-2222-3333-4444-555555555555.jpg") {
		t.Error("legit date rejected")
	}
}
