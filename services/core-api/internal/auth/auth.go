// Package auth is core-api's self-issued session layer (ADR-030): it mints the signed JWT
// that the admin SPA carries in an httpOnly cookie, and verifies passwords with bcrypt.
// core-api OWNS authentication — it does not delegate to a Cloudflare-Access edge assertion.
//
// This slice (PR-3e-1) is the ISSUE side: `POST /auth/login` verifies a credential and calls
// Issue; `POST /auth/logout` calls Clear. The VERIFY side — the JWT-checking middleware on the
// admin group and the actor injection — lands in PR-3e-2 and reuses Verifier() so the signing
// key is plumbed in exactly one place.
package auth

import (
	"net/http"
	"time"

	"github.com/go-chi/jwtauth/v5"
	"golang.org/x/crypto/bcrypt"
)

// SessionCookieName is the name of the httpOnly session cookie carrying the JWT. Kept plain
// (not a __Host- prefix) so it also works over local plain-http dev; the Secure flag is
// config-driven (CookieSecure). The prod hardening to __Host- can follow with the HTTPS edge.
const SessionCookieName = "lumin_session"

// signingAlg is the JWT signature algorithm. HS256 (symmetric) suits a single self-issuing
// service — one secret signs and verifies; there is no third party that needs a public key.
const signingAlg = "HS256"

// Issuer mints and clears the session cookie. It is safe for concurrent use.
type Issuer struct {
	ja     *jwtauth.JWTAuth
	ttl    time.Duration
	secure bool
}

// NewIssuer builds an Issuer over the HS256 signing secret. ttl is the token lifetime; secure
// sets the cookie Secure flag (true in prod behind the HTTPS edge, false for local http dev).
func NewIssuer(secret string, ttl time.Duration, secure bool) *Issuer {
	return &Issuer{
		ja:     jwtauth.New(signingAlg, []byte(secret), nil),
		ttl:    ttl,
		secure: secure,
	}
}

// Verifier exposes the underlying JWTAuth so the PR-3e-2 verify middleware validates cookies
// with the same key/alg this Issuer signs with — the secret is configured in exactly one place.
func (is *Issuer) Verifier() *jwtauth.JWTAuth { return is.ja }

// Issue mints a signed JWT for the authenticated user and returns the Set-Cookie to write.
// Claims: sub=users.id, role (owner|staff), iat, exp. `now` is the server clock (injected so
// the mint is deterministic in tests). The token is carried ONLY in the returned cookie — never
// in the response body — so it stays out of JS-readable storage (blunts XSS token theft, ADR-030).
func (is *Issuer) Issue(subject, role string, now time.Time) (*http.Cookie, error) {
	claims := map[string]any{"sub": subject, "role": role}
	jwtauth.SetIssuedAt(claims, now)
	jwtauth.SetExpiry(claims, now.Add(is.ttl))
	_, token, err := is.ja.Encode(claims)
	if err != nil {
		return nil, err
	}
	return is.cookie(token, now.Add(is.ttl), int(is.ttl.Seconds())), nil
}

// Clear returns a cookie that immediately expires the session cookie (logout). Its Path/
// HttpOnly/Secure/SameSite must match Issue's so the browser targets the same cookie for deletion.
func (is *Issuer) Clear() *http.Cookie {
	return is.cookie("", time.Unix(0, 0), -1)
}

// cookie assembles the session cookie with the fixed security attributes (ADR-030):
// httpOnly (no JS access), Secure (config), SameSite=Strict (an admin-only first-party SPA
// needs no cross-site cookie delivery — the strongest CSRF posture for the state-changing
// admin surface PR-3e-2/3h/3k build on top).
func (is *Issuer) cookie(value string, expires time.Time, maxAge int) *http.Cookie {
	return &http.Cookie{
		Name:     SessionCookieName,
		Value:    value,
		Path:     "/",
		HttpOnly: true,
		Secure:   is.secure,
		SameSite: http.SameSiteStrictMode,
		Expires:  expires,
		MaxAge:   maxAge,
	}
}

// dummyHash is a valid bcrypt hash of a throwaway string, computed once. VerifyPassword runs a
// compare against it when the user has no stored hash, so the "no credential" path costs the
// same as a real comparison — an attacker can't distinguish unknown-email from wrong-password
// by timing (no user enumeration). It is not a secret; it never matches a real password.
var dummyHash, _ = bcrypt.GenerateFromPassword([]byte("lumin-timing-equalizer"), bcrypt.DefaultCost)

// VerifyPassword reports whether password matches the stored bcrypt hash. A nil/empty hash
// (a user row with no login credential) always fails, but still burns one bcrypt comparison
// against dummyHash so the timing is indistinguishable from a wrong-password attempt.
func VerifyPassword(hash *string, password string) bool {
	compareTo := dummyHash
	hasHash := hash != nil && *hash != ""
	if hasHash {
		compareTo = []byte(*hash)
	}
	err := bcrypt.CompareHashAndPassword(compareTo, []byte(password))
	return hasHash && err == nil
}

// HashPassword bcrypt-hashes a plaintext password (used by `make seed-owner`). DefaultCost
// matches dummyHash so the login timing-equalizer stays representative.
func HashPassword(password string) (string, error) {
	h, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return "", err
	}
	return string(h), nil
}
