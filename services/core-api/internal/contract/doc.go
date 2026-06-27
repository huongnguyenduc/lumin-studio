// Package contract holds the wire-contract guardian: the 4-way enum parity test
// (parity_test.go) that keeps services/core-api/openapi.yaml byte-identical to the
// three other enum sources — internal/order constants, packages/core Zod, and the
// Postgres native enums (ADR-031). It has no runtime code; the hand-authored
// openapi.yaml is THE contract, and oapi-codegen / openapi-typescript generate from
// it (PR-3c-2). This package exists so a hand-edit that drifts one enum from the
// other three fails `make verify-go` instead of silently shipping a divergent client.
package contract
