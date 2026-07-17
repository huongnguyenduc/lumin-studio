package httpapi

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/kube"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/order"
)

// --- Docker-free unit tests — no Postgres, no cluster; kube.Fake stands in for the k8s API. ---

func newOwnerCtx() context.Context {
	return withActor(context.Background(), Actor{ByUser: uuid.NewString(), Role: order.RoleOwner, At: time.Now().UTC()})
}

func newStaffCtx() context.Context {
	return withActor(context.Background(), Actor{ByUser: uuid.NewString(), Role: order.RoleStaff, At: time.Now().UTC()})
}

func newDomainsServer(fake kube.Client) *Server {
	return NewServer(slog.New(slog.NewTextHandler(io.Discard, nil)), nil, nil, nil, WithKubeClient(fake))
}

func TestCreateDomainHappyPath(t *testing.T) {
	srv := newDomainsServer(kube.NewFake())
	resp, err := srv.CreateDomain(newOwnerCtx(), api.CreateDomainRequestObject{
		Body: &api.DomainInput{Subdomain: "test-web", TargetService: "wedding-web", TargetPort: 3000},
	})
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	created, ok := resp.(api.CreateDomain201JSONResponse)
	if !ok {
		t.Fatalf("wrong response type: %T", resp)
	}
	if created.Subdomain != "test-web" || created.TargetService != "wedding-web" || created.TargetPort != 3000 {
		t.Fatalf("wrong body: %+v", created)
	}
}

func TestCreateDomainRejectsReservedName(t *testing.T) {
	srv := newDomainsServer(kube.NewFake())
	resp, err := srv.CreateDomain(newOwnerCtx(), api.CreateDomainRequestObject{
		Body: &api.DomainInput{Subdomain: "admin", TargetService: "core-api", TargetPort: 8080},
	})
	if err != nil {
		t.Fatalf("unexpected transport err: %v", err)
	}
	bad, ok := resp.(api.CreateDomain400JSONResponse)
	if !ok {
		t.Fatalf("wrong response type: %T", resp)
	}
	if bad.Fields == nil || (*bad.Fields)["subdomain"] == "" {
		t.Fatalf("expected subdomain field error, got %+v", bad)
	}
}

func TestCreateDomainRejectsInvalidShape(t *testing.T) {
	srv := newDomainsServer(kube.NewFake())
	cases := map[string]api.DomainInput{
		"uppercase":       {Subdomain: "Test-Web", TargetService: "svc", TargetPort: 80},
		"leading hyphen":  {Subdomain: "-test", TargetService: "svc", TargetPort: 80},
		"trailing hyphen": {Subdomain: "test-", TargetService: "svc", TargetPort: 80},
		"empty":           {Subdomain: "", TargetService: "svc", TargetPort: 80},
		"bad port":        {Subdomain: "test", TargetService: "svc", TargetPort: 0},
		"port too big":    {Subdomain: "test", TargetService: "svc", TargetPort: 70000},
		// Dots are rejected outright — Cloudflare's Universal SSL wildcard only covers one
		// subdomain level, so a multi-label name would create a domain unreachable over HTTPS
		// (box-verified 2026-07-17: TLS handshake_failure at Cloudflare's edge).
		"contains a dot": {Subdomain: "gianghieu.bh", TargetService: "svc", TargetPort: 80},
		"too long":       {Subdomain: strings.Repeat("a", 64), TargetService: "svc", TargetPort: 80},
	}
	for name, in := range cases {
		t.Run(name, func(t *testing.T) {
			resp, err := srv.CreateDomain(newOwnerCtx(), api.CreateDomainRequestObject{Body: &in})
			if err != nil {
				t.Fatalf("unexpected transport err: %v", err)
			}
			if _, ok := resp.(api.CreateDomain400JSONResponse); !ok {
				t.Fatalf("%s: wrong response type: %T", name, resp)
			}
		})
	}
}

func TestCreateDomainDuplicateConflicts(t *testing.T) {
	srv := newDomainsServer(kube.NewFake())
	body := &api.DomainInput{Subdomain: "test-web", TargetService: "wedding-web", TargetPort: 3000}
	if _, err := srv.CreateDomain(newOwnerCtx(), api.CreateDomainRequestObject{Body: body}); err != nil {
		t.Fatalf("first create: unexpected err: %v", err)
	}
	_, err := srv.CreateDomain(newOwnerCtx(), api.CreateDomainRequestObject{Body: body})
	if !errors.Is(err, kube.ErrAlreadyExists) {
		t.Fatalf("second create: err = %v, want kube.ErrAlreadyExists", err)
	}
}

func TestUpdateDomainHappyPath(t *testing.T) {
	srv := newDomainsServer(kube.NewFake())
	if _, err := srv.CreateDomain(newOwnerCtx(), api.CreateDomainRequestObject{
		Body: &api.DomainInput{Subdomain: "test-web", TargetService: "wedding-web", TargetPort: 3000},
	}); err != nil {
		t.Fatalf("create: unexpected err: %v", err)
	}
	resp, err := srv.UpdateDomain(newOwnerCtx(), api.UpdateDomainRequestObject{
		Subdomain: "test-web",
		Body:      &api.DomainTargetUpdate{TargetService: "storefront", TargetPort: 3000},
	})
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	updated, ok := resp.(api.UpdateDomain200JSONResponse)
	if !ok {
		t.Fatalf("wrong response type: %T", resp)
	}
	if updated.Subdomain != "test-web" || updated.TargetService != "storefront" {
		t.Fatalf("wrong body: %+v", updated)
	}
}

func strPtr(s string) *string { return &s }

func TestUpdateDomainRenameHappyPath(t *testing.T) {
	srv := newDomainsServer(kube.NewFake())
	if _, err := srv.CreateDomain(newOwnerCtx(), api.CreateDomainRequestObject{
		Body: &api.DomainInput{Subdomain: "test-web", TargetService: "wedding-web", TargetPort: 3000},
	}); err != nil {
		t.Fatalf("create: unexpected err: %v", err)
	}
	resp, err := srv.UpdateDomain(newOwnerCtx(), api.UpdateDomainRequestObject{
		Subdomain: "test-web",
		Body: &api.DomainTargetUpdate{
			Subdomain: strPtr("test-web-2"), TargetService: "wedding-web", TargetPort: 3000,
		},
	})
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	renamed, ok := resp.(api.UpdateDomain200JSONResponse)
	if !ok {
		t.Fatalf("wrong response type: %T", resp)
	}
	if renamed.Subdomain != "test-web-2" {
		t.Fatalf("wrong body: %+v", renamed)
	}
	// The old name must no longer resolve — rename deletes the old Ingress.
	if _, err := srv.DeleteDomain(newOwnerCtx(), api.DeleteDomainRequestObject{Subdomain: "test-web"}); !errors.Is(err, kube.ErrNotFound) {
		t.Fatalf("old subdomain still present after rename: err = %v", err)
	}
	if _, err := srv.DeleteDomain(newOwnerCtx(), api.DeleteDomainRequestObject{Subdomain: "test-web-2"}); err != nil {
		t.Fatalf("new subdomain missing after rename: err = %v", err)
	}
}

func TestUpdateDomainRenameOntoExistingConflicts(t *testing.T) {
	srv := newDomainsServer(kube.NewFake())
	if _, err := srv.CreateDomain(newOwnerCtx(), api.CreateDomainRequestObject{
		Body: &api.DomainInput{Subdomain: "test-web", TargetService: "wedding-web", TargetPort: 3000},
	}); err != nil {
		t.Fatalf("create test-web: unexpected err: %v", err)
	}
	if _, err := srv.CreateDomain(newOwnerCtx(), api.CreateDomainRequestObject{
		Body: &api.DomainInput{Subdomain: "taken", TargetService: "storefront", TargetPort: 3000},
	}); err != nil {
		t.Fatalf("create taken: unexpected err: %v", err)
	}
	_, err := srv.UpdateDomain(newOwnerCtx(), api.UpdateDomainRequestObject{
		Subdomain: "test-web",
		Body: &api.DomainTargetUpdate{
			Subdomain: strPtr("taken"), TargetService: "wedding-web", TargetPort: 3000,
		},
	})
	if !errors.Is(err, kube.ErrAlreadyExists) {
		t.Fatalf("err = %v, want kube.ErrAlreadyExists", err)
	}
}

func TestUpdateDomainRenameRejectsReservedName(t *testing.T) {
	srv := newDomainsServer(kube.NewFake())
	if _, err := srv.CreateDomain(newOwnerCtx(), api.CreateDomainRequestObject{
		Body: &api.DomainInput{Subdomain: "test-web", TargetService: "wedding-web", TargetPort: 3000},
	}); err != nil {
		t.Fatalf("create: unexpected err: %v", err)
	}
	resp, err := srv.UpdateDomain(newOwnerCtx(), api.UpdateDomainRequestObject{
		Subdomain: "test-web",
		Body: &api.DomainTargetUpdate{
			Subdomain: strPtr("admin"), TargetService: "wedding-web", TargetPort: 3000,
		},
	})
	if err != nil {
		t.Fatalf("unexpected transport err: %v", err)
	}
	bad, ok := resp.(api.UpdateDomain400JSONResponse)
	if !ok {
		t.Fatalf("wrong response type: %T", resp)
	}
	if bad.Fields == nil || (*bad.Fields)["subdomain"] == "" {
		t.Fatalf("expected subdomain field error, got %+v", bad)
	}
}

func TestUpdateDomainUnmanagedRefused(t *testing.T) {
	srv := newDomainsServer(kube.NewFake())
	_, err := srv.UpdateDomain(newOwnerCtx(), api.UpdateDomainRequestObject{
		Subdomain: "never-created",
		Body:      &api.DomainTargetUpdate{TargetService: "svc", TargetPort: 80},
	})
	if !errors.Is(err, kube.ErrNotFound) {
		t.Fatalf("err = %v, want kube.ErrNotFound", err)
	}
}

func TestUpdateDomainRejectsInvalidShape(t *testing.T) {
	srv := newDomainsServer(kube.NewFake())
	if _, err := srv.CreateDomain(newOwnerCtx(), api.CreateDomainRequestObject{
		Body: &api.DomainInput{Subdomain: "test-web", TargetService: "wedding-web", TargetPort: 3000},
	}); err != nil {
		t.Fatalf("create: unexpected err: %v", err)
	}
	resp, err := srv.UpdateDomain(newOwnerCtx(), api.UpdateDomainRequestObject{
		Subdomain: "test-web",
		Body:      &api.DomainTargetUpdate{TargetService: "", TargetPort: 3000},
	})
	if err != nil {
		t.Fatalf("unexpected transport err: %v", err)
	}
	if _, ok := resp.(api.UpdateDomain400JSONResponse); !ok {
		t.Fatalf("wrong response type: %T", resp)
	}
}

func TestDeleteDomainUnmanagedRefused(t *testing.T) {
	srv := newDomainsServer(kube.NewFake())
	_, err := srv.DeleteDomain(newOwnerCtx(), api.DeleteDomainRequestObject{Subdomain: "never-created"})
	if !errors.Is(err, kube.ErrNotFound) {
		t.Fatalf("err = %v, want kube.ErrNotFound", err)
	}
}

func TestDomainsNilClusterUnavailable(t *testing.T) {
	srv := newDomainsServer(nil)
	ctx := newOwnerCtx()

	if _, err := srv.ListDomains(ctx, api.ListDomainsRequestObject{}); !errors.Is(err, errClusterUnavailable) {
		t.Fatalf("ListDomains: err = %v, want errClusterUnavailable", err)
	}
	if _, err := srv.ListDomainTargets(ctx, api.ListDomainTargetsRequestObject{}); !errors.Is(err, errClusterUnavailable) {
		t.Fatalf("ListDomainTargets: err = %v, want errClusterUnavailable", err)
	}
	if _, err := srv.CreateDomain(ctx, api.CreateDomainRequestObject{
		Body: &api.DomainInput{Subdomain: "x", TargetService: "y", TargetPort: 80},
	}); !errors.Is(err, errClusterUnavailable) {
		t.Fatalf("CreateDomain: err = %v, want errClusterUnavailable", err)
	}
	if _, err := srv.UpdateDomain(ctx, api.UpdateDomainRequestObject{
		Subdomain: "x", Body: &api.DomainTargetUpdate{TargetService: "y", TargetPort: 80},
	}); !errors.Is(err, errClusterUnavailable) {
		t.Fatalf("UpdateDomain: err = %v, want errClusterUnavailable", err)
	}
	if _, err := srv.DeleteDomain(ctx, api.DeleteDomainRequestObject{Subdomain: "x"}); !errors.Is(err, errClusterUnavailable) {
		t.Fatalf("DeleteDomain: err = %v, want errClusterUnavailable", err)
	}
}

func TestDomainsStaffForbidden(t *testing.T) {
	srv := newDomainsServer(kube.NewFake())
	ctx := newStaffCtx()

	if _, err := srv.ListDomains(ctx, api.ListDomainsRequestObject{}); !errors.Is(err, errForbidden) {
		t.Fatalf("ListDomains: err = %v, want errForbidden", err)
	}
	if _, err := srv.CreateDomain(ctx, api.CreateDomainRequestObject{
		Body: &api.DomainInput{Subdomain: "x", TargetService: "y", TargetPort: 80},
	}); !errors.Is(err, errForbidden) {
		t.Fatalf("CreateDomain: err = %v, want errForbidden", err)
	}
	if _, err := srv.UpdateDomain(ctx, api.UpdateDomainRequestObject{
		Subdomain: "x", Body: &api.DomainTargetUpdate{TargetService: "y", TargetPort: 80},
	}); !errors.Is(err, errForbidden) {
		t.Fatalf("UpdateDomain: err = %v, want errForbidden", err)
	}
	if _, err := srv.DeleteDomain(ctx, api.DeleteDomainRequestObject{Subdomain: "x"}); !errors.Is(err, errForbidden) {
		t.Fatalf("DeleteDomain: err = %v, want errForbidden", err)
	}
}

func TestListDomainTargetsReturnsServices(t *testing.T) {
	fake := kube.NewFake()
	fake.Services = []kube.ServiceTarget{{Name: "wedding-web", Ports: []int32{3000}}}
	srv := newDomainsServer(fake)
	resp, err := srv.ListDomainTargets(newOwnerCtx(), api.ListDomainTargetsRequestObject{})
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	list, ok := resp.(api.ListDomainTargets200JSONResponse)
	if !ok {
		t.Fatalf("wrong response type: %T", resp)
	}
	if len(list) != 1 || list[0].Name != "wedding-web" || len(list[0].Ports) != 1 || list[0].Ports[0] != 3000 {
		t.Fatalf("wrong body: %+v", list)
	}
}
