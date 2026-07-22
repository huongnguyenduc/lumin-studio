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

// Auth mints/verifies couple session cookies and holds the master secret.
//
// Master scope is NOT reachable from the browser any more: couple management
// (create/rename/password/delete couples, subdomain review) lives in the lumin
// admin, whose server-side BFF calls this API with `Authorization: Bearer
// <masterSecret>`. The masterSecret is the wedding ADMIN_PASSWORD env — reused
// as a server-to-server token, so no new secret. A couple logs in on its own
// subdomain and gets a cookie scoped to just its wedding.
type Auth struct {
	ja           *jwtauth.JWTAuth
	masterSecret string
	ttl          time.Duration
	secure       bool
}

func New(cfg config.Config) *Auth {
	return &Auth{
		ja:           jwtauth.New("HS256", []byte(cfg.JWTSecret), nil),
		masterSecret: cfg.AdminPassword,
		ttl:          cfg.JWTTTL,
		secure:       cfg.CookieSecure,
	}
}

// MasterEnabled reports whether a master secret is configured (ADMIN_PASSWORD).
func (a *Auth) MasterEnabled() bool { return a.masterSecret != "" }

// CheckMasterToken compares a bearer token against the master secret in constant
// time. Always false when unset — fail closed, never open.
func (a *Auth) CheckMasterToken(tok string) bool {
	if !a.MasterEnabled() {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(tok), []byte(a.masterSecret)) == 1
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

// Middleware authenticates /api/admin/* and stashes the session scope in the
// context. Two paths, master first:
//   - `Authorization: Bearer <masterSecret>` → master scope (ScopeAll). This is
//     the ONLY way to master scope — used by the lumin admin BFF server-side.
//   - a valid couple session cookie → the wedding slug in its "wed" claim.
//
// No valid credential → 401. SameSite=Strict on the cookie is the CSRF story;
// the bearer path is server-to-server only (never set by a browser here).
func (a *Auth) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if tok := bearerToken(r); tok != "" && a.CheckMasterToken(tok) {
			next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), ctxKey{}, ScopeAll)))
			return
		}
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
		// A couple cookie only ever carries its own slug; ignore a "*" claim so
		// the bearer stays the sole master path even against a stray token.
		scope := ""
		if v, ok := tok.Get("wed"); ok {
			if s, ok := v.(string); ok && s != "" && s != ScopeAll {
				scope = s
			}
		}
		if scope == "" {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), ctxKey{}, scope)))
	})
}

// bearerToken extracts the token from an `Authorization: Bearer <token>` header,
// or "" when absent/malformed.
func bearerToken(r *http.Request) string {
	const prefix = "Bearer "
	h := r.Header.Get("Authorization")
	if len(h) > len(prefix) && h[:len(prefix)] == prefix {
		return h[len(prefix):]
	}
	return ""
}
