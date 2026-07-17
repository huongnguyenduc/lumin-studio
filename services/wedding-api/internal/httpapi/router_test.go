package httpapi

import (
	"net/http/httptest"
	"testing"
)

func TestHealthz(t *testing.T) {
	h := New(nil) // /healthz never touches the pool
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/healthz", nil))
	if rec.Code != 200 {
		t.Fatalf("GET /healthz = %d, want 200", rec.Code)
	}
}
