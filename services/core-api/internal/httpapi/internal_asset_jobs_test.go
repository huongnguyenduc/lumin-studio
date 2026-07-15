package httpapi

import (
	"errors"
	"testing"
)

// The render callback (ReportAssetJobResult, ADR-045) is gated by the authService class: a static worker
// Bearer, NOT a user session. These prove the gate Docker-free — a matching token passes WITHOUT injecting
// an actor (the worker has no identity), a wrong/absent token is rejected, and — the subtle one — an UNSET
// server token fails closed (a constant-time compare of "" vs "" must NOT authenticate).
func TestReportAssetJobResultAuthService(t *testing.T) {
	const secret = "s3cr3t-worker-callback-token"

	srv := serverWithUsers(fakeUsers{})
	srv.workerCallbackToken = secret

	// matching token → reaches the handler, no actor injected
	next, _, err := callAuthMWBearer(srv, "ReportAssetJobResult", secret)
	if err != nil {
		t.Fatalf("matching worker token must authenticate, got %v", err)
	}
	if !next.called {
		t.Fatal("matching worker token must reach the handler")
	}
	if next.hasAct {
		t.Fatal("authService must NOT inject a user actor (the worker has no identity)")
	}

	// wrong token → 401, handler not reached
	next, _, err = callAuthMWBearer(srv, "ReportAssetJobResult", secret+"x")
	if !errors.Is(err, errUnauthenticated) {
		t.Fatalf("wrong worker token must be errUnauthenticated, got %v", err)
	}
	if next.called {
		t.Fatal("handler must not run for a wrong worker token")
	}

	// absent token → 401
	if _, _, err := callAuthMWBearer(srv, "ReportAssetJobResult", ""); !errors.Is(err, errUnauthenticated) {
		t.Fatalf("absent worker token must be errUnauthenticated, got %v", err)
	}

	// fail-closed: an UNSET server token rejects an empty presented token (the ""=="" trap) AND any token.
	blank := serverWithUsers(fakeUsers{}) // workerCallbackToken defaults to ""
	if _, _, err := callAuthMWBearer(blank, "ReportAssetJobResult", ""); !errors.Is(err, errUnauthenticated) {
		t.Fatalf("unset worker token must fail closed for an empty credential, got %v", err)
	}
	if _, _, err := callAuthMWBearer(blank, "ReportAssetJobResult", secret); !errors.Is(err, errUnauthenticated) {
		t.Fatalf("unset worker token must reject any presented token, got %v", err)
	}
}
