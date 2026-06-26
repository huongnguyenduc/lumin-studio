# core-api — Lumin Studio BFF (Go + Chi v5)

The backend-for-frontend for all four surfaces (storefront, admin, admin mobile,
extension). It owns auth + RBAC, the OrderStatus state machine, **server-side
money**, the outbox→NATS publisher and SSE progress. See
[`docs/architecture.md`](../../docs/architecture.md) §3 and
[`spec.md`](../../spec.md) §04.

## Status

**Core data-layer slice (PR-2a — infra).** On top of the Phase-0 HTTP scaffold and
the slice-1 pure-Go spine (`internal/order` state machine + `internal/money`), this
adds the data-layer foundation: golang-migrate migrations, a sqlc-generated typed
query layer, and a pgx connection pool wired into the server with a Postgres
readiness probe. No domain tables/queries yet — those land per axis in PR-2b+
(see [`docs/plans/core-data-layer.md`](../../docs/plans/core-data-layer.md)).

## Layout

```
cmd/core-api/      main: load config -> open pool -> build router -> serve -> drain
internal/config/   env-driven runtime config (PORT, timeouts, DATABASE_URL, pool knobs)
internal/db/       pgx pool (Open/Ping) + sqlc-generated query layer (internal/db/sqlc)
internal/httpapi/  chi router, middleware, health/readiness handlers
internal/money/    server-authoritative CalcTotals (int VND)
internal/order/    OrderStatus state machine (transition guard, statusHistory, RBAC)
db/migrations/     golang-migrate NNNNNN_name.up.sql/.down.sql (ADR-028)
db/queries/        sqlc query sources (*.sql)
sqlc.yaml          sqlc v2 codegen config (schema = db/migrations/*.up.sql, up-only)
```

## Toolchain (pinned)

- **Go 1.23** · **golangci-lint v2.12.2** (ADR-020).
- **sqlc v1.30.0** — `make verify-go` runs `sqlc vet` + `sqlc diff`, so the committed
  `internal/db/sqlc` must match. Install the pinned release binary
  (https://github.com/sqlc-dev/sqlc/releases) or
  `go install github.com/sqlc-dev/sqlc/cmd/sqlc@v1.30.0`.
- **golang-migrate** — for `make migrate` (ADR-028).
- **pgx v5.7.5** — pinned to keep the Go 1.23 toolchain (v5.10+ requires Go 1.25).

## Run & verify

```
# from this directory
PORT=8080 go run ./cmd/core-api      # boot the server (/readyz needs a reachable Postgres)
go test ./...                        # unit tests

# from the repo root — the gate the harness arms when *.go / sqlc land
make verify-go                       # gofmt + vet + golangci-lint + sqlc vet + sqlc diff + go test -race
make sqlc                            # regenerate internal/db/sqlc after editing migrations/queries
DATABASE_URL=... make migrate        # apply pending up migrations (golang-migrate)
```

Listens on `:8080` by default (override with `PORT`), matching the Caddy
reverse-proxy and the `core-api` compose service. `DATABASE_URL` defaults to a
localhost Postgres so build/test stay green with no env set.
