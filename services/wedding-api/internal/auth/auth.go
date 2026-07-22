// Package auth implements the admin session (HANDOFF §6, extended for
// multi-couple): POST /api/admin/login verifies a password (master or a
// couple's own — checked in httpapi against the DB), then issues an HS256
// session JWT in an httpOnly cookie carrying its scope; middleware guards
// /api/admin/*. Lean sibling of core-api's ADR-030 self-issued auth.
package auth

import (
	"context"
	"crypto/subtle"
	"net/http"
	"time"

	"github.com/go-chi/jwtauth/v5"

	"github.com/huongnguyenduc/lumin-studio/services/wedding-api/internal/config"
)

// CookieName scopes the session to this app (the lumin admin uses lumin_session).
const CookieName = "wedding_session"

// ScopeAll marks a master session (sees every wedding); any other scope value
// is a wedding slug the session is confined to.
const ScopeAll = "*"

type ctxKey struct{}

// Scope returns the session scope set by Middleware ("" outside it).
func Scope(ctx context.Context) string {
	s, _ := ctx.Value(ctxKey{}).(string)
	return s
}

// Auth mints/verifies session cookies and holds the env master password.
type Auth struct {
	ja          *jwtauth.JWTAuth
	envPassword string
	ttl         time.Duration
	secure      bool
}

func New(cfg config.Config) *Auth {
	return &Auth{
		ja:          jwtauth.New("HS256", []byte(cfg.JWTSecret), nil),
		envPassword: cfg.AdminPassword,
		ttl:         cfg.JWTTTL,
		secure:      cfg.CookieSecure,
	}
}

// EnvMasterEnabled reports whether the ADMIN_PASSWORD env bootstrap is set.
func (a *Auth) EnvMasterEnabled() bool { return a.envPassword != "" }

// CheckEnvMaster compares against the env bootstrap password in constant time.
// Always false when unset — fail closed, never open.
func (a *Auth) CheckEnvMaster(pw string) bool {
	if !a.EnvMasterEnabled() {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(pw), []byte(a.envPassword)) == 1
}

// IssueCookie mints the session JWT for the given scope (ScopeAll or a wedding
// slug) wrapped in an httpOnly cookie.
func (a *Auth) IssueCookie(scope string) (*http.Cookie, error) {
	now := time.Now()
	_, tok, err := a.ja.Encode(map[string]any{
		"sub": "admin",
		"wed": scope,
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

// Middleware rejects requests without a valid session JWT (401) and stashes the
// session scope in the context. Pre-multi-couple tokens have no "wed" claim and
// default to master — they were minted by the shared master password.
// SameSite=Strict on the cookie is the CSRF story.
func (a *Auth) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := r.Cookie(CookieName)
		if err != nil {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		tok, err := jwtauth.VerifyToken(a.ja, c.Value)
		if err != nil {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		scope := ScopeAll
		if v, ok := tok.Get("wed"); ok {
			if s, ok := v.(string); ok && s != "" {
				scope = s
			}
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), ctxKey{}, scope)))
	})
}
