package httpapi

import (
	"context"
	"regexp"
	"strings"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/kube"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/order"
)

// domains.go — the admin surface to provision/deprovision customer-site subdomains
// (*.luminstudio.vn) as traefik Ingresses in the k3s prod namespace. There is deliberately no
// database table (ponytail: DB-less) — the cluster's Ingress objects ARE the list; s.kube (nil
// off a non-in-cluster boot) is the only dependency. Every operation is owner-only
// (classify → authOwnerOnly, middleware_auth.go): this is infrastructure, not shop config.

// subdomainRe matches a valid single DNS label: lowercase letters/digits, hyphens allowed only
// between other characters, 1-63 chars (RFC 1035, tightened to lowercase-only — the admin form
// lowercases on submit, so an uppercase input is a client bug, not a normalization target here).
var subdomainRe = regexp.MustCompile(`^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$`)

// reservedSubdomains are hosts already served by an existing manifest (infra/k8s/*.yaml) or that
// would otherwise be confusing/dangerous to hand out — creating a domain with one of these names
// must never shadow or collide with the real service.
var reservedSubdomains = map[string]struct{}{
	"www": {}, "admin": {}, "api": {}, "s3": {}, "assets": {},
	"wedding-assets": {}, "giangvahieu": {}, "traefik": {}, "mail": {},
}

// ListDomains handles GET /admin/domains (owner-only read).
func (s *Server) ListDomains(ctx context.Context, _ api.ListDomainsRequestObject) (api.ListDomainsResponseObject, error) {
	if err := assertOwner(ctx); err != nil {
		return nil, err
	}
	if s.kube == nil {
		return nil, errClusterUnavailable
	}
	rows, err := s.kube.ListIngresses(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]api.Domain, len(rows))
	for i, d := range rows {
		out[i] = domainDTO(d)
	}
	return api.ListDomains200JSONResponse(out), nil
}

// ListDomainTargets handles GET /admin/domains/targets (owner-only read) — the Service picker
// for the create-domain form.
func (s *Server) ListDomainTargets(ctx context.Context, _ api.ListDomainTargetsRequestObject) (api.ListDomainTargetsResponseObject, error) {
	if err := assertOwner(ctx); err != nil {
		return nil, err
	}
	if s.kube == nil {
		return nil, errClusterUnavailable
	}
	rows, err := s.kube.ListServices(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]api.DomainTarget, len(rows))
	for i, t := range rows {
		ports := make([]int, len(t.Ports))
		for j, p := range t.Ports {
			ports[j] = int(p)
		}
		out[i] = api.DomainTarget{Name: t.Name, Ports: ports}
	}
	return api.ListDomainTargets200JSONResponse(out), nil
}

// CreateDomain handles POST /admin/domains (owner-only). Validates the subdomain shape + reserved
// list server-side (trust boundary — the form is not the only caller of this endpoint); an
// already-provisioned subdomain is a 409, not a silent overwrite.
func (s *Server) CreateDomain(ctx context.Context, req api.CreateDomainRequestObject) (api.CreateDomainResponseObject, error) {
	actor, ok := actorFrom(ctx)
	if !ok {
		return nil, errUnauthenticated
	}
	if actor.Role != order.RoleOwner {
		return nil, errForbidden
	}
	if s.kube == nil {
		return nil, errClusterUnavailable
	}
	if req.Body == nil {
		return api.CreateDomain400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(envelope(codeValidation))}, nil
	}
	sub, svc, port, fields := cleanDomainInput(*req.Body)
	if len(fields) > 0 {
		env := envelope(codeValidation)
		env.Fields = &fields
		return api.CreateDomain400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(env)}, nil
	}
	if err := s.kube.CreateIngress(ctx, sub, svc, port, actor.ByUser); err != nil {
		return nil, err // kube.ErrAlreadyExists → 409 (mapError)
	}
	return api.CreateDomain201JSONResponse(api.Domain{
		Subdomain:     sub,
		TargetService: svc,
		TargetPort:    int(port),
		CreatedBy:     actor.ByUser,
	}), nil
}

// DeleteDomain handles DELETE /admin/domains/{subdomain} (owner-only). Unknown/unmanaged name →
// 404 (kube.DeleteIngress never deletes an Ingress it didn't create).
func (s *Server) DeleteDomain(ctx context.Context, req api.DeleteDomainRequestObject) (api.DeleteDomainResponseObject, error) {
	if err := assertOwner(ctx); err != nil {
		return nil, err
	}
	if s.kube == nil {
		return nil, errClusterUnavailable
	}
	if err := s.kube.DeleteIngress(ctx, req.Subdomain); err != nil {
		return nil, err // kube.ErrNotFound → 404 (mapError)
	}
	return api.DeleteDomain204Response{}, nil
}

// cleanDomainInput trims + validates a create-domain body and returns the cleaned fields plus a
// per-field error map (empty ⇒ valid). subdomain must be a valid single DNS label, lowercase, and
// not a reserved name; targetPort must be a valid TCP port.
func cleanDomainInput(in api.DomainInput) (subdomain, targetService string, targetPort int32, fields map[string]string) {
	sub := strings.TrimSpace(in.Subdomain)
	svc := strings.TrimSpace(in.TargetService)
	fields = map[string]string{}
	if !subdomainRe.MatchString(sub) {
		fields["subdomain"] = msgKey(codeValidation)
	} else if _, reserved := reservedSubdomains[sub]; reserved {
		fields["subdomain"] = msgKey(codeValidation)
	}
	if svc == "" {
		fields["targetService"] = msgKey(codeValidation)
	}
	if in.TargetPort <= 0 || in.TargetPort > 65535 {
		fields["targetPort"] = msgKey(codeValidation)
	}
	if len(fields) > 0 {
		return "", "", 0, fields
	}
	return sub, svc, int32(in.TargetPort), nil
}

// domainDTO maps one kube.Domain to its wire shape.
func domainDTO(d kube.Domain) api.Domain {
	return api.Domain{
		Subdomain:     d.Subdomain,
		TargetService: d.TargetService,
		TargetPort:    int(d.TargetPort),
		CreatedBy:     d.CreatedBy,
		CreatedAt:     d.CreatedAt.Time,
	}
}
