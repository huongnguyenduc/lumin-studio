package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/huongnguyenduc/lumin-studio/services/wedding-api/internal/auth"
	"github.com/huongnguyenduc/lumin-studio/services/wedding-api/internal/config"
)

func newTestRouter() http.Handler {
	a := auth.New(config.Config{AdminPassword: "pw", JWTSecret: "t", JWTTTL: time.Hour})
	return New(nil, a, nil) // routes under test never touch the pool
}

func TestHealthz(t *testing.T) {
	rec := httptest.NewRecorder()
	newTestRouter().ServeHTTP(rec, httptest.NewRequest("GET", "/healthz", nil))
	if rec.Code != 200 {
		t.Fatalf("GET /healthz = %d, want 200", rec.Code)
	}
}

func TestAdminRoutesRequireAuth(t *testing.T) {
	h := newTestRouter()
	for _, path := range []string{"/api/admin/guests", "/api/admin/overview", "/api/admin/settings"} {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest("GET", path, nil))
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("GET %s without cookie = %d, want 401", path, rec.Code)
		}
	}
}

func TestPresignDisabledWithoutConfig(t *testing.T) {
	a := auth.New(config.Config{AdminPassword: "pw", JWTSecret: "t", JWTTTL: time.Hour})
	h := New(nil, a, nil)
	cookie, _ := a.IssueCookie(auth.ScopeAll)
	req := httptest.NewRequest("POST", "/api/admin/uploads/presign", nil)
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("presign without upload config = %d, want 503", rec.Code)
	}
}

func TestWishNameTooLong(t *testing.T) {
	h := newTestRouter()
	long := strings.Repeat("ă", 101) // 101 runes — must 400 before any DB work (pool is nil)
	body := strings.NewReader(`{"name":"` + long + `","text":"chúc mừng"}`)
	req := httptest.NewRequest("POST", "/api/wishes", body)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("wish with 101-rune name = %d, want 400", rec.Code)
	}
}

func TestLoginBadPassword(t *testing.T) {
	h := newTestRouter()
	req := httptest.NewRequest("POST", "/api/admin/login", nil)
	req.Body = http.NoBody
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest { // empty body = bad JSON
		t.Fatalf("login empty body = %d, want 400", rec.Code)
	}
}
