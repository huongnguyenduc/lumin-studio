# core-api — Lumin Studio BFF (Go + Chi v5)

The backend-for-frontend for all four surfaces (storefront, admin, admin mobile,
extension). It owns auth + RBAC, the OrderStatus state machine, **server-side
money**, the outbox→NATS publisher and SSE progress. See
[`docs/architecture.md`](../../docs/architecture.md) §3 and
[`spec.md`](../../spec.md) §04.

## Status

**Phase 0 scaffold.** HTTP server boot only: a Chi router with the baseline
middleware stack, `GET /healthz` + `GET /readyz` probes, structured slog
logging, env config, and graceful shutdown. No DB, NATS or domain routes yet —
those land in the Core data-model phase.

## Layout

```
cmd/core-api/      main: load config → build router → serve → graceful shutdown
internal/config/   env-driven runtime config (PORT, timeouts)
internal/httpapi/  chi router, middleware, health/readiness handlers
```

## Run & verify

```bash
# from this directory
PORT=8080 go run ./cmd/core-api      # boot the server
go test ./...                        # unit tests

# from the repo root — the gate the harness arms when *.go lands
make verify-go                       # gofmt-check + go vet + golangci-lint + go test
```

Listens on `:8080` by default (override with `PORT`), matching the Caddy
reverse-proxy and the `core-api` compose service.
