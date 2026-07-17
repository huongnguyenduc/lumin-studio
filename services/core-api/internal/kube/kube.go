// Package kube provisions per-domain traefik Ingress objects in the k3s prod namespace for
// customer-site subdomains (*.luminstudio.vn). Ingress objects ARE the source of truth — no
// database table (ponytail: DB-less; add one only if history/soft-delete is ever needed) — so
// list/create/delete talk to the k8s API directly. Client is nil when core-api is not running
// in-cluster (local dev); callers must treat a nil Client as "feature unavailable", not a crash.
package kube

import (
	"context"
	"fmt"
	"sort"

	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
)

// Namespace is the single k3s namespace lumin runs in (infra/k8s/*.yaml). Not configurable —
// the cluster has exactly one prod namespace today.
const Namespace = "prod"

// managedByLabel marks every Ingress this package owns, so ListIngresses/DeleteIngress never
// touch an Ingress created by another manifest (wedding.yaml, ingress.yaml).
const (
	managedByLabelKey = "app.kubernetes.io/managed-by"
	managedByLabelVal = "lumin-core-api"
	createdByAnnoKey  = "luminstudio.vn/created-by"
	ingressNamePrefix = "lumin-domain-"
	hostSuffix        = ".luminstudio.vn"
	ingressClass      = "traefik"
)

// ErrNotFound is returned by DeleteIngress when the named domain has no managed Ingress (either
// never created, or not one this package owns).
var ErrNotFound = fmt.Errorf("kube: domain not found")

// Domain is one provisioned subdomain, projected from its backing Ingress object.
type Domain struct {
	Subdomain     string // e.g. "test-web" (not the full host)
	TargetService string
	TargetPort    int32
	CreatedBy     string
	CreatedAt     metav1.Time
}

// ServiceTarget is a candidate backend for a new domain — a Service in Namespace with its
// container ports, used to populate the admin target picker.
type ServiceTarget struct {
	Name  string
	Ports []int32
}

// Client is the seam the httpapi domains handlers depend on. The real implementation wraps
// kubernetes.Interface; tests use a fake (kube_fake.go, same package... see domains_test.go in
// httpapi which defines its own fake against this interface — kept minimal on purpose).
type Client interface {
	ListIngresses(ctx context.Context) ([]Domain, error)
	CreateIngress(ctx context.Context, subdomain, targetService string, targetPort int32, createdBy string) error
	UpdateIngress(ctx context.Context, subdomain, targetService string, targetPort int32) (Domain, error)
	DeleteIngress(ctx context.Context, subdomain string) error
	ListServices(ctx context.Context) ([]ServiceTarget, error)
}

// client is the real, in-cluster Client implementation.
type client struct {
	cs kubernetes.Interface
}

// NewInCluster builds a Client from the pod's in-cluster service-account config. Returns a nil
// Client (not an error the caller must propagate) when not running in a cluster — core-api still
// boots for local dev; the domains endpoints then fail closed with 503 (see httpapi/domains.go).
func NewInCluster() Client {
	cfg, err := rest.InClusterConfig()
	if err != nil {
		return nil
	}
	cs, err := kubernetes.NewForConfig(cfg)
	if err != nil {
		return nil
	}
	return &client{cs: cs}
}

func ingressName(subdomain string) string { return ingressNamePrefix + subdomain }

func (c *client) ListIngresses(ctx context.Context) ([]Domain, error) {
	list, err := c.cs.NetworkingV1().Ingresses(Namespace).List(ctx, metav1.ListOptions{
		LabelSelector: managedByLabelKey + "=" + managedByLabelVal,
	})
	if err != nil {
		return nil, fmt.Errorf("kube: list ingresses: %w", err)
	}
	out := make([]Domain, 0, len(list.Items))
	for _, ing := range list.Items {
		d, ok := domainFromIngress(&ing)
		if !ok {
			continue
		}
		out = append(out, d)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Subdomain < out[j].Subdomain })
	return out, nil
}

func domainFromIngress(ing *networkingv1.Ingress) (Domain, bool) {
	if len(ing.Spec.Rules) == 0 || ing.Spec.Rules[0].HTTP == nil || len(ing.Spec.Rules[0].HTTP.Paths) == 0 {
		return Domain{}, false
	}
	host := ing.Spec.Rules[0].Host
	sub, ok := trimHostSuffix(host)
	if !ok {
		return Domain{}, false
	}
	backend := ing.Spec.Rules[0].HTTP.Paths[0].Backend.Service
	if backend == nil {
		return Domain{}, false
	}
	return Domain{
		Subdomain:     sub,
		TargetService: backend.Name,
		TargetPort:    backend.Port.Number,
		CreatedBy:     ing.Annotations[createdByAnnoKey],
		CreatedAt:     ing.CreationTimestamp,
	}, true
}

func trimHostSuffix(host string) (string, bool) {
	if len(host) <= len(hostSuffix) || host[len(host)-len(hostSuffix):] != hostSuffix {
		return "", false
	}
	return host[:len(host)-len(hostSuffix)], true
}

func (c *client) CreateIngress(ctx context.Context, subdomain, targetService string, targetPort int32, createdBy string) error {
	pathType := networkingv1.PathTypePrefix
	ing := &networkingv1.Ingress{
		ObjectMeta: metav1.ObjectMeta{
			Name:      ingressName(subdomain),
			Namespace: Namespace,
			Labels:    map[string]string{managedByLabelKey: managedByLabelVal},
			Annotations: map[string]string{
				"traefik.ingress.kubernetes.io/router.entrypoints": "web",
				createdByAnnoKey: createdBy,
			},
		},
		Spec: networkingv1.IngressSpec{
			IngressClassName: strPtr(ingressClass),
			Rules: []networkingv1.IngressRule{{
				Host: subdomain + hostSuffix,
				IngressRuleValue: networkingv1.IngressRuleValue{
					HTTP: &networkingv1.HTTPIngressRuleValue{
						Paths: []networkingv1.HTTPIngressPath{{
							Path:     "/",
							PathType: &pathType,
							Backend: networkingv1.IngressBackend{
								Service: &networkingv1.IngressServiceBackend{
									Name: targetService,
									Port: networkingv1.ServiceBackendPort{Number: targetPort},
								},
							},
						}},
					},
				},
			}},
		},
	}
	_, err := c.cs.NetworkingV1().Ingresses(Namespace).Create(ctx, ing, metav1.CreateOptions{})
	if apierrors.IsAlreadyExists(err) {
		return fmt.Errorf("%w: domain already exists", ErrAlreadyExists)
	}
	if err != nil {
		return fmt.Errorf("kube: create ingress: %w", err)
	}
	return nil
}

// ErrAlreadyExists is returned by CreateIngress when the subdomain is already provisioned.
var ErrAlreadyExists = fmt.Errorf("kube: domain already exists")

// UpdateIngress repoints an existing managed Ingress at a different Service/port — the subdomain
// (host) itself is not renamed; a rename is delete + recreate. Refuses (ErrNotFound) an Ingress
// that isn't managed by this package, mirroring DeleteIngress.
func (c *client) UpdateIngress(ctx context.Context, subdomain, targetService string, targetPort int32) (Domain, error) {
	name := ingressName(subdomain)
	ing, err := c.cs.NetworkingV1().Ingresses(Namespace).Get(ctx, name, metav1.GetOptions{})
	if apierrors.IsNotFound(err) {
		return Domain{}, ErrNotFound
	}
	if err != nil {
		return Domain{}, fmt.Errorf("kube: get ingress: %w", err)
	}
	if ing.Labels[managedByLabelKey] != managedByLabelVal {
		return Domain{}, ErrNotFound
	}
	if len(ing.Spec.Rules) == 0 || ing.Spec.Rules[0].HTTP == nil || len(ing.Spec.Rules[0].HTTP.Paths) == 0 {
		return Domain{}, ErrNotFound
	}
	ing.Spec.Rules[0].HTTP.Paths[0].Backend.Service = &networkingv1.IngressServiceBackend{
		Name: targetService,
		Port: networkingv1.ServiceBackendPort{Number: targetPort},
	}
	updated, err := c.cs.NetworkingV1().Ingresses(Namespace).Update(ctx, ing, metav1.UpdateOptions{})
	if err != nil {
		return Domain{}, fmt.Errorf("kube: update ingress: %w", err)
	}
	d, ok := domainFromIngress(updated)
	if !ok {
		return Domain{}, fmt.Errorf("kube: update ingress: unexpected shape after update")
	}
	return d, nil
}

func (c *client) DeleteIngress(ctx context.Context, subdomain string) error {
	name := ingressName(subdomain)
	ing, err := c.cs.NetworkingV1().Ingresses(Namespace).Get(ctx, name, metav1.GetOptions{})
	if apierrors.IsNotFound(err) {
		return ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("kube: get ingress: %w", err)
	}
	if ing.Labels[managedByLabelKey] != managedByLabelVal {
		// Never delete an Ingress this package didn't create (e.g. `wedding`), even if its name
		// happened to collide with the lumin-domain- prefix.
		return ErrNotFound
	}
	if err := c.cs.NetworkingV1().Ingresses(Namespace).Delete(ctx, name, metav1.DeleteOptions{}); err != nil {
		if apierrors.IsNotFound(err) {
			return ErrNotFound
		}
		return fmt.Errorf("kube: delete ingress: %w", err)
	}
	return nil
}

func (c *client) ListServices(ctx context.Context) ([]ServiceTarget, error) {
	list, err := c.cs.CoreV1().Services(Namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("kube: list services: %w", err)
	}
	out := make([]ServiceTarget, 0, len(list.Items))
	for _, svc := range list.Items {
		out = append(out, serviceTarget(&svc))
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

func serviceTarget(svc *corev1.Service) ServiceTarget {
	ports := make([]int32, 0, len(svc.Spec.Ports))
	for _, p := range svc.Spec.Ports {
		ports = append(ports, p.Port)
	}
	return ServiceTarget{Name: svc.Name, Ports: ports}
}

func strPtr(s string) *string { return &s }
