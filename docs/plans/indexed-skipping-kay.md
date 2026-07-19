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
