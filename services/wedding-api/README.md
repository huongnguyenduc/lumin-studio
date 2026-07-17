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

## API (HANDOFF §5)

Public, per-IP rate-limited (`CF-Connecting-IP`, fallback RemoteAddr):
`GET /api/invite/{guestId}` (fires write-once `opened_at`) · `POST …/rsvp` (upsert) ·
`POST /api/wishes` · `GET /api/wishes?limit&offset`.

Admin, behind the shared-password JWT cookie (`wedding_session`, SameSite=Strict):
`POST /api/admin/login|logout` (login rate-limited hard) · guests CRUD +
`bulk-delete` (id = immutable slug) · wishes list/delete/`bulk-delete` · groups
CRUD (rename cascades; delete reassigns members to "Khác") · `stats` ·
`settings` GET/PATCH (shallow JSONB merge, `null` deletes a key) ·
`uploads/presign` (presigned POST to Garage `wedding-assets`, MIME/size enforced
in the signed policy; unconfigured → 503). Excel export is client-side (§3.8) —
no server endpoint.

## Run locally

```sh
DATABASE_URL=postgres://postgres:postgres@localhost:5432/wedding?sslmode=disable \
ALLOW_DEV_JWT_SECRET=true ADMIN_PASSWORD=dev COOKIE_SECURE=false \
  go run ./cmd/wedding-api
# defaults: PORT=8081 — probes: GET /healthz (liveness), GET /readyz (db ping)
# production REQUIRES JWT_SECRET; ADMIN_PASSWORD unset → login disabled (503);
# UPLOAD_S3_{ENDPOINT,ACCESS_KEY_ID,SECRET_ACCESS_KEY} + UPLOAD_PUBLIC_BASE_URL
# unset → uploads disabled (503), rest of the API serves.
```

Integration test (real Postgres, skipped without the env):

```sh
WEDDING_TEST_DATABASE_URL='postgres://postgres:pg@localhost:5434/wedding?sslmode=disable' \
  go test ./internal/httpapi/
```

## Gates

`make verify-go` at the repo root covers this service (gofmt + go vet +
golangci-lint + `go test -race`), same as core-api.
