package kube

import (
	"context"
	"sort"
)

// Fake is an in-memory Client for tests — no real cluster required. Exported (not test-only)
// so both internal/kube and internal/httpapi tests can share it.
type Fake struct {
	Domains  map[string]Domain
	Services []ServiceTarget
	// Err, if set, is returned by every method — used to exercise the 500 path.
	Err error
}

// NewFake returns an empty Fake ready to use.
func NewFake() *Fake {
	return &Fake{Domains: map[string]Domain{}}
}

func (f *Fake) ListIngresses(_ context.Context) ([]Domain, error) {
	if f.Err != nil {
		return nil, f.Err
	}
	out := make([]Domain, 0, len(f.Domains))
	for _, d := range f.Domains {
		out = append(out, d)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Subdomain < out[j].Subdomain })
	return out, nil
}

func (f *Fake) CreateIngress(_ context.Context, subdomain, targetService string, targetPort int32, createdBy string) error {
	if f.Err != nil {
		return f.Err
	}
	if _, exists := f.Domains[subdomain]; exists {
		return ErrAlreadyExists
	}
	f.Domains[subdomain] = Domain{
		Subdomain:     subdomain,
		TargetService: targetService,
		TargetPort:    targetPort,
		CreatedBy:     createdBy,
	}
	return nil
}

func (f *Fake) DeleteIngress(_ context.Context, subdomain string) error {
	if f.Err != nil {
		return f.Err
	}
	if _, exists := f.Domains[subdomain]; !exists {
		return ErrNotFound
	}
	delete(f.Domains, subdomain)
	return nil
}

func (f *Fake) ListServices(_ context.Context) ([]ServiceTarget, error) {
	if f.Err != nil {
		return nil, f.Err
	}
	return f.Services, nil
}
