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

// subdomainRe matches a single DNS label: lowercase letters/digits, hyphens allowed only between
// other characters, 1-63 chars (RFC 1035, tightened to lowercase-only — the admin form lowercases
// on submit, so an uppercase input is a client bug, not a normalization target here).
//
// Deliberately single-label (no dots): a multi-label name like "foo.bh.luminstudio.vn" resolves
// and routes correctly in-cluster, but Cloudflare's Universal SSL cert for luminstudio.vn only
// covers ONE wildcard level (SAN = luminstudio.vn + *.luminstudio.vn) — a deeper name fails the
// TLS handshake at Cloudflare's edge before ever reaching the cluster (confirmed live: box-verify
// 2026-07-17). Multi-label support was shipped and reverted the same day once this was found; see
// docs/active-context.md. Re-enabling it needs Cloudflare Advanced Certificate Manager (paid) or
// an explicit SAN for the deeper wildcard — an ops/billing decision, not a code change alone.
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
	d, err := s.kube.CreateIngress(ctx, sub, svc, port, actor.ByUser)
	if err != nil {
		return nil, err // kube.ErrAlreadyExists → 409 (mapError)
	}
	return api.CreateDomain201JSONResponse(domainDTO(d)), nil
}

// UpdateDomain handles PATCH /admin/domains/{subdomain} (owner-only). Repoints the domain at a
// different Service/port; if the body's subdomain differs from the path, also renames it (new
// Ingress created, old one deleted — kube.UpdateIngress). Unknown/unmanaged name → 404; renaming
// onto an already-provisioned name → 409 (kube.ErrAlreadyExists).
func (s *Server) UpdateDomain(ctx context.Context, req api.UpdateDomainRequestObject) (api.UpdateDomainResponseObject, error) {
	if err := assertOwner(ctx); err != nil {
		return nil, err
	}
	if s.kube == nil {
		return nil, errClusterUnavailable
	}
	if req.Body == nil {
		return api.UpdateDomain400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(envelope(codeValidation))}, nil
	}
	newSub, svc, port, fields := cleanDomainTargetInput(*req.Body)
	if len(fields) > 0 {
		env := envelope(codeValidation)
		env.Fields = &fields
		return api.UpdateDomain400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(env)}, nil
	}
	d, err := s.kube.UpdateIngress(ctx, req.Subdomain, newSub, svc, port)
	if err != nil {
		return nil, err // kube.ErrNotFound → 404, kube.ErrAlreadyExists → 409 (mapError)
	}
	return api.UpdateDomain200JSONResponse(domainDTO(d)), nil
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
// not a reserved name; targetService/targetPort are validated by cleanDomainTarget.
func cleanDomainInput(in api.DomainInput) (subdomain, targetService string, targetPort int32, fields map[string]string) {
	svc, port, fields := cleanDomainTarget(in.TargetService, in.TargetPort)
	sub, subFields := cleanSubdomain(in.Subdomain)
	for k, v := range subFields {
		fields[k] = v
	}
	if len(fields) > 0 {
		return "", "", 0, fields
	}
	return sub, svc, port, nil
}

// cleanDomainTargetInput trims + validates an update-domain body. `newSubdomain` is "" when the
// body omits `subdomain` or repeats the path value — the caller (kube.UpdateIngress) treats that
// as "no rename"; a non-empty, different value is validated with the same rules as create.
func cleanDomainTargetInput(in api.DomainTargetUpdate) (newSubdomain, targetService string, targetPort int32, fields map[string]string) {
	svc, port, fields := cleanDomainTarget(in.TargetService, in.TargetPort)
	if in.Subdomain != nil {
		sub, subFields := cleanSubdomain(*in.Subdomain)
		for k, v := range subFields {
			fields[k] = v
		}
		newSubdomain = sub
	}
	if len(fields) > 0 {
		return "", "", 0, fields
	}
	return newSubdomain, svc, port, nil
}

// cleanSubdomain trims + validates a subdomain label — a valid single DNS label, lowercase, not a
// reserved name. Shared by create and the optional rename field on update.
func cleanSubdomain(raw string) (sub string, fields map[string]string) {
	sub = strings.TrimSpace(raw)
	fields = map[string]string{}
	if !subdomainRe.MatchString(sub) {
		fields["subdomain"] = msgKey(codeValidation)
	} else if _, reserved := reservedSubdomains[sub]; reserved {
		fields["subdomain"] = msgKey(codeValidation)
	}
	return sub, fields
}

// cleanDomainTarget validates the service/port pair shared by create and update.
func cleanDomainTarget(targetService string, targetPort int) (svc string, port int32, fields map[string]string) {
	svc = strings.TrimSpace(targetService)
	fields = map[string]string{}
	if svc == "" {
		fields["targetService"] = msgKey(codeValidation)
	}
	if targetPort <= 0 || targetPort > 65535 {
		fields["targetPort"] = msgKey(codeValidation)
	}
	if len(fields) > 0 {
		return "", 0, fields
	}
	return svc, int32(targetPort), fields
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
