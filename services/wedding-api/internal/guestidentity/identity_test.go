package guestidentity

import (
	"bytes"
	"testing"
)

func TestBuildStableAndScoped(t *testing.T) {
	signals := Signals{
		UserAgent:   "Mozilla/5.0 (iPhone) AppleWebKit Safari/604.1",
		ScreenWidth: 390, ScreenHeight: 844, DevicePixelRatio: "3",
		Timezone: "Asia/Ho_Chi_Minh", Language: "vi-VN", Platform: "iPhone",
		TouchPoints: 5,
	}
	a := Build("secret", "couple-a", "token", "203.0.113.9", signals)
	b := Build("secret", "couple-a", "token", "203.0.113.99", signals)
	if !bytes.Equal(a.Token, b.Token) || !bytes.Equal(a.Fingerprint, b.Fingerprint) {
		t.Fatal("same token/device and /24 network must resolve stably")
	}
	c := Build("secret", "couple-b", "token", "203.0.113.9", signals)
	if bytes.Equal(a.Token, c.Token) || bytes.Equal(a.Fingerprint, c.Fingerprint) {
		t.Fatal("HMACs must not correlate identities across weddings")
	}
	if a.Browser != "safari" || a.Device != "iphone" {
		t.Fatalf("device codes = %q/%q", a.Browser, a.Device)
	}
}

func TestNewTokenIsRandom(t *testing.T) {
	a, err := NewToken()
	if err != nil {
		t.Fatal(err)
	}
	b, err := NewToken()
	if err != nil {
		t.Fatal(err)
	}
	if len(a) < 40 || a == b {
		t.Fatalf("tokens are not suitably random: %q %q", a, b)
	}
}
