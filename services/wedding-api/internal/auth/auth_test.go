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

func TestCheckEnvMaster(t *testing.T) {
	a := newTestAuth("s3cret")
	if !a.CheckEnvMaster("s3cret") {
		t.Error("correct password rejected")
	}
	if a.CheckEnvMaster("wrong") {
		t.Error("wrong password accepted")
	}
	if newTestAuth("").CheckEnvMaster("") {
		t.Error("empty configured password must disable login, not match empty input")
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

	// Issued cookie → 200.
	cookie, err := a.IssueCookie(ScopeAll)
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest("GET", "/api/admin/stats", nil)
	req.AddCookie(cookie)
	rec = httptest.NewRecorder()
	protected.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("valid cookie = %d, want 200", rec.Code)
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
