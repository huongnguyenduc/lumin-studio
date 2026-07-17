# Native-service gates for Lumin Studio.
#
# The JS workspace verifies via `pnpm verify`; these targets cover the services
# that live OUTSIDE it (Go core-api, Rust asset-worker). The harness arms them
# the moment service code lands — tests/harness/guard.test.sh §ARM-GUARD fails
# if a *.go exists under services/ without a `verify-go` target (or *.rs without
# `verify-rs`), and — once sqlc.yaml/generated code lands — if the `verify-go`
# recipe does not actually run `sqlc vet` (and, once openapi.yaml + *.gen.go land,
# the oapi-codegen stale-check), so a silently-skipped gate cannot masquerade as a
# passing one. The Stop hook (.claude/hooks/verify-before-stop.sh) runs
# `make verify-go` / `make verify-rs` when the matching files change.
#
# Recipes target GNU Make 3.81 (macOS default): no .ONESHELL, so each target is
# a single backslash-continued shell line.

.PHONY: verify verify-go verify-rs sqlc oapi migrate seed-owner

## verify: run every native-service gate
verify: verify-go verify-rs

## verify-go: gofmt-check + go vet + golangci-lint v2 + sqlc vet/diff + oapi stale-check + go test -race
## Covers BOTH Go services: wedding-api (lean — no codegen) then core-api (full: sqlc + oapi gates).
verify-go:
	cd services/wedding-api && \
	  { unformatted="$$(gofmt -l .)"; [ -z "$$unformatted" ] || { echo "gofmt needed on:"; echo "$$unformatted"; exit 1; }; } && \
	  go vet ./... && \
	  golangci-lint run && \
	  go test -race ./...
	cd services/core-api && \
	  { unformatted="$$(gofmt -l .)"; [ -z "$$unformatted" ] || { echo "gofmt needed on:"; echo "$$unformatted"; exit 1; }; } && \
	  go vet ./... && \
	  golangci-lint run && \
	  sqlc vet && \
	  sqlc diff && \
	  go generate ./internal/api/... && \
	  { git diff --exit-code -- internal/api/api.gen.go || { echo "api.gen.go is stale vs openapi.yaml — run 'make oapi' and commit the regen"; exit 1; }; } && \
	  go test -race ./...

## verify-rs: cargo fmt --check + clippy -D warnings + cargo test (services/asset-worker)
verify-rs:
	cd services/asset-worker && \
	  cargo fmt --all --check && \
	  cargo clippy --all-targets -- -D warnings && \
	  cargo test

## sqlc: regenerate the typed query layer (needs sqlc v1.30.0 — see core-api/README)
sqlc:
	cd services/core-api && sqlc generate

## oapi: regenerate the OpenAPI server contract (internal/api/api.gen.go) from openapi.yaml
## — oapi-codegen v2.5.1 is pinned in the //go:generate directive (internal/api/gen.go)
oapi:
	cd services/core-api && go generate ./internal/api/...

## migrate: apply pending up migrations (needs DATABASE_URL + golang-migrate, ADR-028)
migrate:
	cd services/core-api && migrate -path db/migrations -database "$$DATABASE_URL" up

## seed-owner: create/rotate the first owner login credential (ADR-030 self-issued auth).
## Needs OWNER_EMAIL + OWNER_PASSWORD (OWNER_NAME optional) + DATABASE_URL. Idempotent on email.
seed-owner:
	cd services/core-api && go run ./cmd/seed-owner
