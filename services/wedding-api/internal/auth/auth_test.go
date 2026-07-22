package auth

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/huongnguyenduc/lumin-studio/services/wedding-api/internal/config"
)

func newTestAuth(password string) *Auth {
	return New(config.Config{
		AdminPassword: password,
		JWTSecret:     "test-secret",
		JWTTTL:        time.Hour,
	})
}

func TestCheckMasterToken(t *testing.T) {
	a := newTestAuth("s3cret")
	if !a.CheckMasterToken("s3cret") {
		t.Error("correct token rejected")
	}
	if a.CheckMasterToken("wrong") {
		t.Error("wrong token accepted")
	}
	if newTestAuth("").CheckMasterToken("") {
		t.Error("empty master secret must disable the bearer, not match empty input")
	}
}

func TestMiddlewareRoundTrip(t *testing.T) {
	a := newTestAuth("pw")
	protected := a.Middleware(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	// No cookie → 401.
	rec := httptest.NewRecorder()
	protected.ServeHTTP(rec, httptest.NewRequest("GET", "/api/admin/stats", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("no cookie = %d, want 401", rec.Code)
	}

	// A couple-scope cookie → 200.
	cookie, err := a.IssueCookie("giang-hieu")
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest("GET", "/api/admin/stats", nil)
	req.AddCookie(cookie)
	rec = httptest.NewRecorder()
	protected.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("valid couple cookie = %d, want 200", rec.Code)
	}

	// A "*" (master) cookie is IGNORED — master scope is bearer-only, so a stray
	// master cookie must not authenticate.
	masterCookie, _ := a.IssueCookie(ScopeAll)
	req = httptest.NewRequest("GET", "/api/admin/stats", nil)
	req.AddCookie(masterCookie)
	rec = httptest.NewRecorder()
	protected.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("master cookie = %d, want 401 (bearer-only master)", rec.Code)
	}

	// The bearer with the master secret → 200.
	req = httptest.NewRequest("GET", "/api/admin/stats", nil)
	req.Header.Set("Authorization", "Bearer pw")
	rec = httptest.NewRecorder()
	protected.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("master bearer = %d, want 200", rec.Code)
	}

	// Tampered token → 401.
	req = httptest.NewRequest("GET", "/api/admin/stats", nil)
	req.AddCookie(&http.Cookie{Name: CookieName, Value: cookie.Value + "x"})
	rec = httptest.NewRecorder()
	protected.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("tampered cookie = %d, want 401", rec.Code)
	}
}
