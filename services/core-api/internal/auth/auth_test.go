package auth

import (
	"net/http"
	"testing"
	"time"
)

func TestIssueSetsSecureHttpOnlyCookie(t *testing.T) {
	is := NewIssuer("test-secret", time.Hour, true)
	cookie, err := is.Issue("user-1", "owner", time.Now().UTC())
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}
	if cookie.Name != SessionCookieName {
		t.Fatalf("cookie name = %q, want %q", cookie.Name, SessionCookieName)
	}
	if !cookie.HttpOnly {
		t.Fatal("session cookie must be HttpOnly (out of JS reach — XSS token-theft mitigation, ADR-030)")
	}
	if !cookie.Secure {
		t.Fatal("session cookie must be Secure when the issuer is configured secure")
	}
	if cookie.SameSite != http.SameSiteStrictMode {
		t.Fatalf("cookie SameSite = %v, want Strict", cookie.SameSite)
	}
	if cookie.Path != "/" {
		t.Fatalf("cookie path = %q, want /", cookie.Path)
	}
	if cookie.Value == "" || cookie.MaxAge <= 0 {
		t.Fatalf("cookie value/maxAge = %q/%d, want non-empty value + positive maxAge", cookie.Value, cookie.MaxAge)
	}
}

func TestIssueInsecureCookieForLocalHTTP(t *testing.T) {
	is := NewIssuer("s", time.Hour, false)
	cookie, err := is.Issue("u", "staff", time.Now().UTC())
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}
	if cookie.Secure {
		t.Fatal("cookie must NOT be Secure when secure=false (local plain-http dev)")
	}
}

func TestIssuedTokenCarriesClaims(t *testing.T) {
	const ttl = 12 * time.Hour
	is := NewIssuer("test-secret", ttl, true)
	now := time.Now().UTC()
	cookie, err := is.Issue("user-42", "owner", now)
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}

	tok, err := is.Verifier().Decode(cookie.Value)
	if err != nil {
		t.Fatalf("Decode: %v", err)
	}
	if sub, ok := tok.Subject(); !ok || sub != "user-42" {
		t.Fatalf("sub = %q (ok %v), want user-42", sub, ok)
	}
	var role string
	if err := tok.Get("role", &role); err != nil || role != "owner" {
		t.Fatalf("role = %q (err %v), want owner", role, err)
	}
	exp, ok := tok.Expiration()
	if !ok {
		t.Fatal("token must carry an expiry")
	}
	if want := now.Add(ttl); exp.Before(want.Add(-2*time.Second)) || exp.After(want.Add(2*time.Second)) {
		t.Fatalf("exp = %v, want ≈ %v (now+ttl)", exp, want)
	}
}

// A token signed with a different secret must NOT verify — the signature is the whole point.
func TestForeignSecretTokenRejected(t *testing.T) {
	minted := NewIssuer("secret-A", time.Hour, true)
	other := NewIssuer("secret-B", time.Hour, true)
	cookie, err := minted.Issue("u", "owner", time.Now().UTC())
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}
	if _, err := other.Verifier().Decode(cookie.Value); err == nil {
		t.Fatal("a token signed with a different secret must fail verification")
	}
}

func TestClearExpiresCookie(t *testing.T) {
	is := NewIssuer("s", time.Hour, true)
	c := is.Clear()
	if c.Name != SessionCookieName || c.Value != "" || c.MaxAge >= 0 {
		t.Fatalf("clear cookie = %+v, want empty value + negative MaxAge", c)
	}
	if !c.HttpOnly || c.SameSite != http.SameSiteStrictMode || c.Path != "/" {
		t.Fatal("clear cookie must keep Path/HttpOnly/SameSite so the browser matches and deletes the session cookie")
	}
}

func TestVerifyPassword(t *testing.T) {
	hash, err := HashPassword("correct horse battery staple")
	if err != nil {
		t.Fatalf("HashPassword: %v", err)
	}
	if !VerifyPassword(&hash, "correct horse battery staple") {
		t.Fatal("the correct password must verify")
	}
	if VerifyPassword(&hash, "wrong") {
		t.Fatal("a wrong password must not verify")
	}
	if VerifyPassword(nil, "anything") {
		t.Fatal("a nil hash (user with no credential) must never verify")
	}
	empty := ""
	if VerifyPassword(&empty, "anything") {
		t.Fatal("an empty hash must never verify")
	}
}
