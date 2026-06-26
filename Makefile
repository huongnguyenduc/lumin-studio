# Native-service gates for Lumin Studio.
#
# The JS workspace verifies via `pnpm verify`; these targets cover the services
# that live OUTSIDE it (Go core-api, Rust asset-worker). The harness arms them
# the moment service code lands — tests/harness/guard.test.sh §ARM-GUARD fails
# if a *.go exists under services/ without a `verify-go` target (or *.rs without
# `verify-rs`), so a silently-skipped gate cannot masquerade as a passing one.
# The Stop hook (.claude/hooks/verify-before-stop.sh) runs `make verify-go` /
# `make verify-rs` when the matching files change.
#
# Recipes target GNU Make 3.81 (macOS default): no .ONESHELL, so each target is
# a single backslash-continued shell line.

.PHONY: verify verify-go verify-rs

## verify: run every native-service gate
verify: verify-go verify-rs

## verify-go: gofmt-check + go vet + golangci-lint v2 + go test -race (services/core-api)
verify-go:
	cd services/core-api && \
	  { unformatted="$$(gofmt -l .)"; [ -z "$$unformatted" ] || { echo "gofmt needed on:"; echo "$$unformatted"; exit 1; }; } && \
	  go vet ./... && \
	  golangci-lint run && \
	  go test -race ./...

## verify-rs: cargo fmt --check + clippy -D warnings + cargo test (services/asset-worker)
verify-rs:
	cd services/asset-worker && \
	  cargo fmt --all --check && \
	  cargo clippy --all-targets -- -D warnings && \
	  cargo test
