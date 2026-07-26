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

// Đổi tab đám = đổi subdomain; cookie phải scope theo root domain thì cặp đôi
// mới không phải đăng nhập lại (host-only cookie sẽ chết ngay khi hop host).
func TestCookieScopedToRootDomain(t *testing.T) {
	a := New(config.Config{JWTSecret: "test-secret", JWTTTL: time.Hour, RootDomain: "luminstudio.vn"})
	c, err := a.IssueCookie("giang-hieu")
	if err != nil {
		t.Fatal(err)
	}
	if c.Domain != "luminstudio.vn" {
		t.Errorf("session cookie Domain = %q, muốn root domain", c.Domain)
	}
	if a.Clear().Domain != "luminstudio.vn" {
		t.Error("logout phải xoá đúng cookie đó (cùng Domain), nếu không sẽ xoá hụt")
	}
	// dev/localhost: không có root domain → host-only như cũ
	dev := New(config.Config{JWTSecret: "test-secret", JWTTTL: time.Hour})
	if c, _ := dev.IssueCookie("giang-hieu"); c.Domain != "" {
		t.Errorf("dev cookie Domain = %q, muốn rỗng", c.Domain)
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
