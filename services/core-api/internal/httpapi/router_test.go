package httpapi

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// newTestRouter builds a router with a nil pool, nil NATS, and nil auth issuer — readiness
// degrades to liveness, so the smoke probes return 200 without those deps (the dead-dep and
// login paths are covered separately; auth is not exercised here).
func newTestRouter() http.Handler {
	return NewRouter(slog.New(slog.NewTextHandler(io.Discard, nil)), nil, nil, nil)
}

// fakeNATS is a stub NATSStatus for the readiness branch tests (no real broker).
type fakeNATS struct{ reachable bool }

func (f fakeNATS) Reachable() bool { return f.reachable }

func TestHealthzOK(t *testing.T) {
	rec := httptest.NewRecorder()
	newTestRouter().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/healthz", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("GET /healthz status = %d, want 200", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
		t.Fatalf("Content-Type = %q, want application/json", ct)
	}
	if body := rec.Body.String(); !strings.Contains(body, `"status":"ok"`) {
		t.Fatalf("body = %q, want it to contain status ok", body)
	}
}

func TestReadyzOKWithoutPool(t *testing.T) {
	rec := httptest.NewRecorder()
	newTestRouter().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/readyz", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /readyz (nil pool) status = %d, want 200", rec.Code)
	}
}

// With a pool pointed at an unreachable database, readiness must report 503 so the
// instance is drained. Exercises the Ping-failure branch without a live database.
func TestReadyzUnavailableWhenDBDown(t *testing.T) {
	pool, err := pgxpool.New(context.Background(), "postgres://u:p@127.0.0.1:1/none?sslmode=disable")
	if err != nil {
		t.Fatalf("build pool: %v", err)
	}
	defer pool.Close()

	r := NewRouter(slog.New(slog.NewTextHandler(io.Discard, nil)), pool, nil, nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/readyz", nil))
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("GET /readyz with dead DB = %d, want 503", rec.Code)
	}
}

// With a NATS handle that reports unreachable (nil pool so the DB check is skipped),
// readiness must report 503 and name nats as the failing dep.
func TestReadyzUnavailableWhenNATSDown(t *testing.T) {
	r := NewRouter(slog.New(slog.NewTextHandler(io.Discard, nil)), nil, fakeNATS{reachable: false}, nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/readyz", nil))
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("GET /readyz with NATS down = %d, want 503", rec.Code)
	}
	if body := rec.Body.String(); !strings.Contains(body, `"dep":"nats"`) {
		t.Fatalf("body = %q, want it to name nats as the failing dep", body)
	}
}

// A reachable NATS handle (nil pool) keeps readiness at 200.
func TestReadyzOKWhenNATSReachable(t *testing.T) {
	r := NewRouter(slog.New(slog.NewTextHandler(io.Discard, nil)), nil, fakeNATS{reachable: true}, nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/readyz", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /readyz with NATS reachable = %d, want 200", rec.Code)
	}
}

func TestUnknownRouteIs404(t *testing.T) {
	rec := httptest.NewRecorder()
	newTestRouter().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/nope", nil))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("unknown route status = %d, want 404", rec.Code)
	}
}
