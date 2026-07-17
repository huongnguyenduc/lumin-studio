# wedding-api

Backend for the "Giang & Hiếu" wedding invitation site — spec in
[`design_handoff_wedding_invitation/HANDOFF.md`](../../design_handoff_wedding_invitation/HANDOFF.md)
(§4 data model, §5 API surface, §6 auth & deployment). Frontend: `apps/wedding-web`.

Go + Chi + pgx, same layout as `services/core-api` but deliberately lean: no
NATS/outbox (no events), no oapi-codegen/sqlc (a dozen hand-written endpoints).
Own Postgres database `wedding` on the shared cluster instance; uploads go to a
dedicated `wedding-assets` Garage bucket (presign pattern reused from core-api,
lands in step 3).

## Database

Migrations live in `db/migrations/` (golang-migrate, same tooling as core-api):

```sh
DATABASE_URL='postgres://…/wedding?sslmode=disable' make migrate-wedding   # repo root
```

`000001_init` creates guests / wishes / groups (seeded with the 6 defaults) /
settings (single JSONB row). Wish text (non-blank, ≤500) and the 4 preset card
colors are CHECK constraints. Guest ids are slugs from `internal/slug`
(label → diacritics stripped → kebab-case, `-2`/`-3` on collision, immutable).

## Run locally

```sh
DATABASE_URL=postgres://postgres:postgres@localhost:5432/wedding?sslmode=disable \
  go run ./cmd/wedding-api
# defaults: PORT=8081 — probes: GET /healthz (liveness), GET /readyz (db ping)
```

## Gates

`make verify-go` at the repo root covers this service (gofmt + go vet +
golangci-lint + `go test -race`), same as core-api.
