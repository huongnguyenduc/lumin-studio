# Admin-editable wedding name + subdomain (self-serve, no redeploy)

## Context

Follow-up to the multi-event feature below: the couple can now create a
second wedding event in `/admin`, but there's no way to (a) rename an event
after creation, or (b) give it its own live subdomain — today the "active
event" a `wedding-web` deployment serves is picked once via a
`WEDDING_EVENT_SLUG` env var baked into the k8s manifest, so a new subdomain
would need a second `wedding-web` Deployment + Ingress rule + PR every time.

User confirmed (via AskUserQuestion) they want this fully self-serve: admin
types a subdomain in the UI and it works immediately, no deploy needed. This
is achievable because (a) Cloudflare DNS is already wildcard
(`*.luminstudio.vn` → the tunnel → Traefik, confirmed working, "needed
NOTHING for new subdomains" per prior ops work) and (b) Kubernetes' `Ingress`
resource natively supports a wildcard `host: "*.luminstudio.vn"` rule that
Traefik will only fall through to when no more-specific exact-host rule
matches (the existing `www`/`admin`/`api`/`assets`/`s3`/`wedding-assets`
rules in `infra/k8s/ingress.yaml`/`wedding.yaml` stay untouched and keep
priority). So the only structural change is teaching the single `wedding-web`
deployment to resolve which event to serve **from the incoming request's
Host header** instead of a fixed env var, and storing each event's
subdomain in the DB so admin edits take effect on the next request — no
redeploy.

## Data model

New migration `000004_event_subdomain.up.sql`:
```sql
ALTER TABLE events ADD COLUMN subdomain TEXT UNIQUE;
-- Backfill the live domain onto the pre-existing event so nothing breaks.
UPDATE events SET subdomain = 'giangvahieu.luminstudio.vn' WHERE slug = 'dam-cuoi-1';
```
Down: `ALTER TABLE events DROP COLUMN subdomain;`

`subdomain` stores the **full hostname** (e.g. `damcuoisg.luminstudio.vn`),
nullable (a brand-new event has none until admin sets it, and just won't be
reachable by host yet — falls back same as today).

## wedding-api changes

- **`internal/httpapi/admin_events.go`**: `eventRow` gains `Subdomain
  *string`. `patchEvent` accepts an optional top-level `subdomain` field
  (alongside the existing `name`), normalizes the admin's typed label into
  `<label>.luminstudio.vn` (reuse `internal/slug.Make` for sanitizing the
  label, same as guest/event slugs), and on the DB `UNIQUE` violation reuses
  the existing `isUniqueViolation`/409 pattern from `admin_groups.go`
  (`createGroup`) → `SUBDOMAIN_TAKEN`.
- **`public.go` `getEvents`**: include `subdomain` in the response (already
  a generic `SELECT *`-ish struct scan — just add the column).
- No new endpoint needed — resolution-by-host happens in wedding-web using
  the same public `GET /api/events` list it already fetches.

## wedding-web changes

- **`src/lib/api.ts`**: `getActiveEvent()` takes an optional `host: string`
  param. Match `host` (lowercased, port stripped) against `events[].subdomain`
  first; if none match, keep the existing fallback chain
  (`WEDDING_EVENT_SLUG` env, then first by `sortOrder`) — preserves local
  dev (host is `localhost`, never matches a DB subdomain) and acts as a
  safety net for a not-yet-configured event.
- **`src/app/page.tsx`** / **`src/app/i/[slug]/page.tsx`**: read the request
  Host via `headers()` from `next/headers` (Server Component, no new
  plumbing needed) and pass it to `getActiveEvent(host)`.
- **`src/lib/admin-api.ts`**: `patchEvent` body type gains `subdomain?:
  string`.
- **`src/components/admin/event-panel.tsx`**: add two fields at the top of
  the panel (outside the existing `data` JSONB fields, since name/subdomain
  are their own columns): "Tên đám cưới" (`name`) and "Subdomain" (label-only
  input, e.g. `damcuoisg`, with `.luminstudio.vn` shown as a suffix
  affix next to the input so the admin only types the label). Both submit
  through `adminApi.patchEvent(slug, { name, subdomain })` on the same "Lưu"
  button as the venue/timeline fields (draft/save pattern already there).
  Surface `SUBDOMAIN_TAKEN`/`BAD_NAME` errors inline via the existing
  `onError` toast callback.
- **`src/messages/vi.ts`**: add `admin.eventPanel.field.name`/`.subdomain`
  + placeholder/error copy under the same `admin.eventPanel` block already
  added for venue/timeline.

## Infra (k8s)

- **`infra/k8s/wedding.yaml`**: replace the wedding-web Ingress rule's fixed
  `host: giangvahieu.luminstudio.vn` with `host: "*.luminstudio.vn"` (one
  rule, all current and future wedding subdomains) pointing at the same
  `wedding-web` Service. Kubernetes `Ingress` wildcard hosts match exactly
  one label and Traefik prefers the existing exact-host rules in
  `infra/k8s/ingress.yaml` (`www`/`admin`/`api`/`assets`/`s3`) and the
  `wedding-assets.luminstudio.vn` rule already in this same file, so no
  collision risk with other services.
- `WEDDING_EVENT_SLUG` env var on the `wedding-api`/`wedding-web`
  Deployments becomes unused going forward but is left in place (harmless,
  no-op fallback) rather than ripped out — smallest safe diff.

## Verification

- Go: `go build/vet/test`, `golangci-lint run`; extend
  `TestEventScoping` (or a new test) in `integration_test.go` against real
  Postgres: patch an event's `subdomain`, confirm it round-trips via
  `GET /api/events`; create a second event and try to reuse the same
  subdomain → expect 409.
- wedding-web: `typecheck`/`lint`/`test`.
- Manual: after merge+deploy, in `/admin` set "Đám cưới SG"'s subdomain to
  e.g. `damcuoisg`, save, then `curl -s -o /dev/null -w '%{http_code}\n'
  https://damcuoisg.luminstudio.vn/` should return `200` and render that
  event's venue/timeline — with **no further deploy or DNS step**. Also
  re-confirm `giangvahieu.luminstudio.vn` still serves event 1 unchanged.

---

# Multi-event wedding admin (venue + schedule + guest list per wedding)

## Context

`wedding-web`/`wedding-api` is currently a single-tenant app for exactly one
wedding: one `settings` row, one flat `guests`/`groups` table, and the venue
name/address and timeline times are **hardcoded strings** in
`src/messages/vi.ts` (not settings-driven at all — confirmed by reading
`letter.tsx` and `events.tsx`, which only call `t('venue')` etc.).

The couple will later hold a **second wedding** with a different venue,
schedule, and guest list. Per user decisions:
- Each wedding gets its **own subdomain** (separate `wedding-web` deployment
  pointed at the same `wedding-api`/DB, pinned to one event via env var).
- Guest lists are **fully separate** per wedding (no shared guests).
- Only **venue + schedule** (and the guests/groups that go with them) are
  split per event. Hero image, gallery, music, site title/description,
  OG/favicon stay a single shared `settings` row, unchanged.

This plan adds an `events` table the admin can create/edit (name, date,
venue, timeline, ceremony details), scopes `guests`/`groups` to an event, and
wires the public site + admin dashboard to read/write per-event data instead
of hardcoded copy. Wishes stay a single shared wall (not mentioned as
needing separation, no schema change).

## Data model

New migration `000003_events.up.sql` in `services/wedding-api/db/migrations/`:

```sql
CREATE TABLE events (
  slug       TEXT PRIMARY KEY,   -- immutable, like guests.id
  name       TEXT NOT NULL,       -- admin label, e.g. "Đám cưới 1 — Đồng Nai"
  sort_order INT NOT NULL DEFAULT 0,
  data       JSONB NOT NULL DEFAULT '{}'::jsonb  -- venue/timeline fields, shallow-merge like `settings`
);

INSERT INTO events (slug, name, sort_order, data) VALUES
  ('dam-cuoi-1', 'Đám cưới 1', 1, '{}'::jsonb);  -- seed so existing data has a home

ALTER TABLE guests ADD COLUMN event_slug TEXT NOT NULL DEFAULT 'dam-cuoi-1'
  REFERENCES events(slug);
ALTER TABLE guests ALTER COLUMN event_slug DROP DEFAULT;

ALTER TABLE groups DROP CONSTRAINT groups_pkey;
ALTER TABLE groups ADD COLUMN event_slug TEXT NOT NULL DEFAULT 'dam-cuoi-1'
  REFERENCES events(slug);
ALTER TABLE groups ALTER COLUMN event_slug DROP DEFAULT;
ALTER TABLE groups ADD PRIMARY KEY (event_slug, name);
```

`data` JSONB keeps the same **fixed field shape** the current design already
has (Letter renders exactly one venue block + 2 timeline stops; Events
renders exactly 2 ceremony tickets — matching that shape avoids a layout
rewrite): `date, weekday, lunarDate, time, venueName, venueHall,
venueAddress, mapUrl, mapsUrl, timelineWelcomeTime, timelineWelcome,
timelinePartyTime, timelineParty, vuQuyTime, vuQuyPlace, vuQuyAddress,
thanhHonTime, thanhHonPlace, thanhHonAddress, ceremonyDate,
ceremonyLunarDate`. No new validation table/enum — reuse the exact
shallow-merge-JSONB pattern already proven in `patchSettings`
([admin_misc.go:113](../../services/wedding-api/internal/httpapi/admin_misc.go)).

Down migration reverses cleanly (drop columns, drop table).

## wedding-api changes

- **New `internal/httpapi/admin_events.go`**: `listEvents`, `createEvent`
  (name → slug via existing [`internal/slug`](../../services/wedding-api/internal/slug/slug.go)
  package, same collision-probe pattern as `createGuest`), `patchEvent`
  (shallow JSONB merge, copy `patchSettings`'s merge SQL keyed by slug
  instead of the singleton row; also allows renaming `name`).
- **New public handler** `getEvents` in `public.go`: `GET /api/events`
  returns `{items: [{slug, name, sortOrder, data}]}`, unauthenticated —
  mirrors `getSettings`. This is how each subdomain deployment resolves its
  "active" event.
- **`admin_guests.go`**: `listGuests`/`createGuest` take `?event=` query
  param / `eventSlug` body field; `guestSelect` query filters
  `WHERE g.event_slug = $1`. Slug-collision probe stays global (guest ids
  remain a single namespace across events, unaffected).
- **`admin_groups.go`**: same — `listGroups`/`createGroup` scoped by
  `?event=`/body `eventSlug`; `renameGroup`/`deleteGroup` route params gain
  the event slug (`/groups/{event}/{name}`) since the PK is now composite.
- **`router.go`**: register `GET /api/events` (public group), and
  `/api/admin/events` (list/create) + `/api/admin/events/{slug}` (patch)
  under the existing authed admin group. Update the `/groups/*` routes to
  the new `{event}/{name}` param shape.
- Wishes/`public.go` RSVP/invite handlers: **no changes** — guest lookup by
  id is already global, and wishes stay a shared wall.
- Extend `internal/httpapi/integration_test.go` / `router_test.go` with
  cases for: create event → create guest in it → list scoped by event →
  guest from event A not visible when listing event B; patch event data
  round-trips.

## wedding-web changes

- **`src/lib/api.ts`** (SSR/server-only): add `getEvents()` (calls
  `GET /api/events`) and `getActiveEvent()` — picks
  `process.env.WEDDING_EVENT_SLUG` if set, else the first item by
  `sortOrder` (keeps today's single-deployment setup working with no env
  change needed).
- **`src/lib/site-settings.ts`**: add `asEventData(raw)` narrowing helper
  next to `asSiteSettings`, same shape as the pattern already there.
- **`src/lib/types.ts`**: add `EventSummary`/`EventData` types.
- **`src/app/page.tsx`** and **`src/app/i/[slug]/page.tsx`**: fetch
  `getActiveEvent()` alongside `getSettings()`/`getWishes()`, pass the event
  data down to `InvitationCard` → `Letter`/`Events`.
- **`src/components/invitation/letter.tsx`**: replace the hardcoded
  `t('venue')`, `t('venueHall')`, `t('venueAddress')`, `t('time')`,
  `t('weekday')`, `t('date')`, `t('lunarDate')`, `t('timelineWelcomeTime')`,
  etc. calls with props from the event, falling back to the existing `vi.ts`
  strings when a field is empty (covers a freshly-created event with no data
  filled in yet).
- **`src/components/invitation/events.tsx`**: same treatment for
  `vuQuy*`/`thanhHon*`/`ceremonyDate`/`ceremonyLunarDate`, props with
  `vi.ts` fallback.
- **`src/lib/admin-api.ts`**: add `events()`, `createEvent(name)`,
  `patchEvent(slug, patch)`; thread an `event: string` param through
  `guests()`, `createGuest()`, `groups()`, `createGroup()`,
  `renameGroup()`, `deleteGroup()` (query string / body field, matching the
  Go route changes above).
- **`src/components/admin/dashboard.tsx`**: add `events` + `selectedEvent`
  state, load via `adminApi.events()` in `reload()`, render a small tab/pill
  switcher (reuse `pillSolid`/`pillGhost` from `ui.ts`) plus a "+ thêm đám
  cưới" inline input (mirrors the existing inline group-create UX in
  `quick-add.tsx`). All guest/group calls in `reload()`/`run()` pass
  `selectedEvent`.
- **New `src/components/admin/event-panel.tsx`**: a collapsible panel
  (copy `settings-panel.tsx`'s open/close + `patch`/`save` pattern) with
  labeled inputs for the venue/timeline/ceremony fields listed above,
  PATCHing `adminApi.patchEvent(selectedEvent, draft)`.
- **`src/messages/vi.ts`**: keep existing `letter.*`/`events.*` keys as the
  fallback copy (used when a field is blank); add new `admin.events.*` keys
  for the switcher and the new panel's field labels/placeholders.
- Update `test/messages.test.ts` if it snapshots/enumerates the full key
  set.

## Verification

- Go: `cd services/wedding-api && go test ./...` (existing + new event
  scoping tests); `golangci-lint run` per repo convention.
- wedding-web: `pnpm --filter wedding-web typecheck && pnpm --filter
  wedding-web test && pnpm --filter wedding-web lint`.
- Manual: run `wedding-api` + `wedding-web` locally (Postgres via the
  existing local-smoke-stack pattern), open `/admin`, create a second event,
  fill in its venue/timeline, add a guest to it, confirm the guest list for
  event 1 is unaffected; set `WEDDING_EVENT_SLUG` to the new event's slug
  and confirm the public page renders its venue/timeline instead of event
  1's.
