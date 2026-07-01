// Package api holds the OpenAPI-generated server contract for core-api.
//
// api.gen.go is generated FROM services/core-api/openapi.yaml — the single source of
// truth (ADR-031) — by oapi-codegen in strict-server mode (§6 D8). Never hand-edit
// api.gen.go; edit openapi.yaml and re-run `make oapi` (also enforced by the
// `make verify-go` stale-check, which regenerates and diffs). The generator version is
// pinned in the directive below so the committed output is byte-reproducible in CI.
package api

//go:generate go run github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen@v2.5.1 -config oapi-codegen.yaml ../../openapi.yaml
