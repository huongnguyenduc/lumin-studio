// Package auth implements the shared-password admin login (HANDOFF §6, user
// decision): POST /api/admin/login checks the single ADMIN_PASSWORD, then issues
// an HS256 session JWT in an httpOnly cookie; middleware guards /api/admin/*.
// Lean sibling of core-api's ADR-030 self-issued auth — no roles, no users table.
package auth

import (
	"crypto/subtle"
	"net/http"
	"time"

	"github.com/go-chi/jwtauth/v5"

	"github.com/huongnguyenduc/lumin-studio/services/wedding-api/internal/config"
)

// CookieName scopes the session to this app (the lumin admin uses lumin_session).
const CookieName = "wedding_session"

// Auth checks the shared password and mints/verifies session cookies.
type Auth struct {
	ja       *jwtauth.JWTAuth
	password string
	ttl      time.Duration
	secure   bool
}

func New(cfg config.Config) *Auth {
	return &Auth{
		ja:       jwtauth.New("HS256", []byte(cfg.JWTSecret), nil),
		password: cfg.AdminPassword,
		ttl:      cfg.JWTTTL,
		secure:   cfg.CookieSecure,
	}
}

// Enabled reports whether login is possible at all. An empty ADMIN_PASSWORD
// disables login (503) — fail closed, never open.
func (a *Auth) Enabled() bool { return a.password != "" }

// CheckPassword compares in constant time. Always false when login is disabled.
func (a *Auth) CheckPassword(pw string) bool {
	if !a.Enabled() {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(pw), []byte(a.password)) == 1
}

// IssueCookie mints the session JWT wrapped in an httpOnly cookie.
func (a *Auth) IssueCookie() (*http.Cookie, error) {
	now := time.Now()
	_, tok, err := a.ja.Encode(map[string]any{
		"sub": "admin",
		"iat": now.Unix(),
		"exp": now.Add(a.ttl).Unix(),
	})
	if err != nil {
		return nil, err
	}
	return &http.Cookie{
		Name:     CookieName,
		Value:    tok,
		Path:     "/",
		MaxAge:   int(a.ttl.Seconds()),
		HttpOnly: true,
		Secure:   a.secure,
		SameSite: http.SameSiteStrictMode,
	}, nil
}

// Clear expires the session cookie (logout).
func (a *Auth) Clear() *http.Cookie {
	return &http.Cookie{
		Name:     CookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   a.secure,
		SameSite: http.SameSiteStrictMode,
	}
}

// Middleware rejects requests without a valid session JWT (401). SameSite=Strict
// on the cookie is the CSRF story — no cross-site request carries it.
func (a *Auth) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := r.Cookie(CookieName)
		if err != nil {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		if _, err := jwtauth.VerifyToken(a.ja, c.Value); err != nil {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}
