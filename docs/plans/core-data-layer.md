# Plan — Core slice 2 · Data layer (Go core-api: sqlc + migrations + outbox + pgx)

> Phase "Core · Data model + OrderStatus", slice 2 (slice 1 = pure-Go spine, **MERGED** PR #11 `10b31f6`).
> Sources of truth: `spec.md` §02 (data model) / §04 (state machine) · `conventions.md` (money/statusHistory/Scope&PR) ·
> `decisions.md` ADR-003/004/006/007/010/012/017/019/020 · reference impl `packages/core` (TS) · slice-1 Go
> (`services/core-api/internal/order` + `internal/money`).
> Branch: `feat/core-data-layer` off `main` (`10b31f6`). Built from planning workflow `wf_0952e60c-e3d`
> (8 readers → 3 design proposals → synthesis → completeness critique).

## 0. What this slice is

The Go data layer for `services/core-api`, **on top of** slice-1's pure-Go OrderStatus state machine + money calc
(NO DB in slice 1). It introduces:
- **golang-migrate** flat-numbered up/down SQL as the **single schema source** *(NEW ADR — see §6, decision D1)*.
- a **sqlc v2** (engine=postgresql, pgx/v5) codegen layer emitting into `internal/db/sqlc`.
- a **pgxpool** lifecycle wired `config → main → router`.
- the transactional **`outbox` table + a tx-insert helper** (publish-on-commit floor; the relay/NATS is **deferred
  to slice 3**).
- the new **`sqlc vet` + testcontainers** gates armed into `make verify-go` and asserted by an extended
  `guard.test.sh §ARM-GUARD` so the data gate cannot land no-op'd.

**Out of scope (slice 3):** the outbox relay/publisher loop, JetStream topology, HTTP endpoints (`POST /orders`,
transition endpoints), RBAC middleware, replacing the `apps/admin` demo-dashboard placeholder.

## 1. Decomposition — 7 sequential sub-PRs

The whole slice far exceeds the 1-axis/~400-line rule (`conventions §Scope&PR` / ADR-027), so it splits into seven
sequential sub-PRs. Outbox spine + gate machinery land **first** so the publish-on-commit contract and the
ARM-GUARD extension are provable in isolation; then one entity-axis per PR.

> Line budgets **exclude** committed generated `*.gen.go` (machine output) — note this in each PR body so the
> diff-size advisory isn't misread (critique fix, minor #8).

| PR | Axis | ~lines | depends on |
|---|---|---|---|
| **2a** | data-layer infra: golang-migrate + sqlc.yaml + pgxpool + config + **gate arming** (zero domain tables) | 380 | — |
| **2b** | **outbox table + tx-insert SEAM** (dual-write-avoidance spine) | 300 | 2a |
| **2c** | catalog: Product + Category + Color + Option + Review | 390 | 2a |
| **2d** | Customer + PDPL consent_grants + User | 380 | 2c |
| **2e** | Order + OrderItem + statusHistory persistence + order emit-seams | 400 | 2b, 2d |
| **2f** | AssetJob + PrintJob + AssetJob emit-seam | 360 | 2e |
| **2g** | ReplyTemplate + Setting + bank-account audit log | 380 | 2e |

### PR-2a — infra (the keystone)
1. Adopt **golang-migrate**: `db/migrations/NNNNNN_name.up.sql`/`.down.sql`; `make migrate` documented; migration
   `000001_enums` (all native enum types + `pgcrypto`) so later migrations reference shared types and the dir+tool
   are exercised.
2. `go get github.com/jackc/pgx/v5` (pulls pgxpool transitively) + `go mod tidy` → go.sum. **pgx/v5 is the sole new
   *runtime* require**; sqlc + golang-migrate CLIs are build/ops tools, not requires (see decision D4).
3. NEW `internal/db` package: `Open(ctx, cfg) (*pgxpool.Pool, error)` via `pgxpool.ParseConfig` + pool knobs + one
   Ping; `Close`; sentinel `ErrNotFound` wrapping `pgx.ErrNoRows` (`%w`, matches `money.go`/`order.go`).
4. `config.go` gains `DatabaseURL` (`DATABASE_URL`, localhost dev default so `verify-go` stays green env-less) +
   `DBMaxConns` (small default ~8 — all-home box contends with Blender, ADR-014) + `DBConnectTimeout`; tests assert
   default + override.
5. `main.go` opens pool after `config.Load` (fail-fast), `Close` in graceful-shutdown **after** `srv.Shutdown`;
   thread `*pgxpool.Pool` into `httpapi.NewRouter(logger, pool)`; `readyz` gains a `pool.Ping` check.
6. `sqlc.yaml` v2 (engine postgresql, sql_package pgx/v5, **schema = `db/migrations/*.up.sql`** — up-only glob, see
   §3 / critique BLOCKER; queries `db/queries`; out `internal/db/sqlc`) + one trivial `_ping.sql` so `sqlc vet` has
   content.
7. **ARM** `sqlc vet` into the `verify-go` recipe (between golangci-lint and `go test -race`) + **EXTEND**
   `tests/harness/guard.test.sh §ARM-GUARD` (today line ~364-367 only greps the `verify-go:` *target*, not its
   body): IF `sqlc.yaml` OR any `internal/db/sqlc/*.gen.go` exists THEN the recipe MUST contain `sqlc vet`; ELSE
   bad. + a testcontainers real-check (skip-always stub ⇒ bad, mirroring the `osm` real-check).
8. `make sqlc` codegen target + pin sqlc CLI version in README.
9. testcontainers **migration-reversibility** test (up → down → empty → up) — **moved to PR-2b**, see
   the as-built note.

> **As-built (PR-2a, 2026-06-26 — committed):** golang-migrate + `000001_enums` (10 native enums;
> `product_material` TEXT+CHECK deferred to catalog; `asset_job_*` deferred to jobs) + `sqlc.yaml`
> (up-only glob) + `db/queries/ping.sql` smoke query (no leading `_` — Go ignores those files) +
> generated `internal/db/sqlc` + pgx **v5.7.5** pool (`internal/db/pool.go`, kept Go 1.23 — v5.10
> forces Go 1.25) + config `DATABASE_URL`/`DB_MAX_CONNS`/`DBConnectTimeout` + `main` lifecycle +
> `NewRouter(logger, pool)` with a Postgres-pinging `/readyz`. **Gate = no-DB `sqlc vet` + `sqlc diff`**
> in `verify-go` (`sqlc/db-prepare` deferred to when CI provisions Postgres); ARM-GUARD greps
> `sqlc vet` in the recipe **body** + a testcontainers real-check (arm-when-land). **testcontainers +
> the migration-reversibility test moved to PR-2b** — no local Docker daemon, so this keeps PR-2a
> verifiable offline, and the first real integration test belongs with the outbox table anyway.
> `make verify-go` green (golangci 0, sqlc vet+diff clean, all packages); guard.test.sh 139→**141**;
> osm 22. sqlc CLI pinned v1.30.0 (CI install added to `harness.yml`).

### PR-2b — outbox seam
Migration `000002_outbox` (DDL §4). `db/queries/outbox.sql`: one `InsertOutbox` (first real sqlc query). Hand-written
`EnqueueOutbox(ctx, tx pgx.Tx, ev OutboxEvent) error` — **first arg `pgx.Tx`** (not the pool) so the type system
forces callers to enlist in their domain tx. **No relay, no NATS** — rows accumulate at `status='pending'`.
testcontainers test: rolled-back domain tx leaves **zero** outbox rows; committed leaves **exactly one**;
`UNIQUE(dedup_key)` rejects a duplicate logical event. **Invoke the `event-outbox` skill before writing the seam.**

> **As-built (PR-2b, 2026-06-26 — committed):** migration `000002_outbox` (table + partial
> `outbox_unpublished_idx`) + `db/queries/outbox.sql` `InsertOutbox` + `internal/db/outbox.go`
> `EnqueueOutbox(ctx, tx pgx.Tx, ev OutboxEvent)` — **tx first-arg** dual-write guard; validates id/keys/JSON
> payload before the round-trip. sqlc overrides added: `uuid` → `google/uuid.UUID`, `outbox.payload` →
> `json.RawMessage` (clean params + camelCase tags). **New deps:** google/uuid v1.6.0 (**runtime** — Go has no
> UUID generator) + testcontainers-go v0.34.0 + postgres module (**test-only**); go directive stays 1.23
> (corrects the earlier "pgx = sole new require" — now pgx + google/uuid runtime). The atomicity test
> (rollback→0 / commit→1 / dup dedup_key→reject) **and** the migration-reversibility test (moved from 2a) use
> testcontainers + an **in-test SQL applier** (reads `*.up.sql`/`*.down.sql`, no golang-migrate dep — decision
> D4); they **skip locally** (`SkipIfProviderIsNotHealthy` *panics* without Docker → recover-guarded `t.Skip`)
> and **run in CI** (ubuntu has Docker) under the same `make verify-go`. The pure `validate` unit test runs
> everywhere. `make verify-go` green (sqlc vet now validates `InsertOutbox` vs the outbox up-schema);
> guard.test.sh **141** (testcontainers real-check now ACTIVE — greps `postgres.Run`); osm 22. Relay/NATS
> publisher still deferred to slice 3.

### PR-2c — catalog
Migration `000003_catalog`: `categories` (minimal, to satisfy `products.category_id` FK — decision D5), `products`
(int8 `base_price` CHECK≥0, jsonb dimensions/images, `material` TEXT+CHECK, `product_status` enum, `rating_avg`
real NULL, `review_count` int default 0), `colors`/`options` (product_id-FK children, int8 price deltas, `options.
max_chars` int NULL), `reviews` (`rating` smallint CHECK 1..5, `customer_id` **nullable column here**, its FK to
`customers` ADDED forward-only in `000004`). Queries: `GetProductBySlug`, `ListProductsByStatus`,
`ListColorsByProduct`, `ListOptionsByProduct`, `InsertReview`.

### PR-2d — identity + privacy (vn-compliance territory)
Migration `000004_identity`: `customers` (name CHECK len 2..60, phone [VN regex app-side], email NULL,
`social_handle` NULL, **`addresses` jsonb** = province/ward/street + ward admin-code + name/phone, **NO district**
ADR-017, created_at), `consent_grants` (append-then-mark: `scope` enum, `channel` `consent_channel` enum
`{web,inbox,zalo,extension}` — the 4 Lumin surfaces, front-loaded to avoid later `ALTER TYPE` friction (ADR-028
rationale); granted_at, policy_version text, `withdrawn_at` NULL), `users` (email UNIQUE, `role` enum owner/staff — **no `system`**, active
bool default true). **Adds the deferred `reviews.customer_id` FK.** Queries: `InsertCustomer`, `GetCustomerByPhone`,
`InsertConsentGrant`, `WithdrawConsent`, `ListActiveConsents` (latest non-withdrawn per `(customer,scope,channel)`),
export/erase scaffold, `InsertUser`, `GetUserByEmail`. Optional partial unique index
`UNIQUE(customer_id,scope,channel) WHERE withdrawn_at IS NULL` (critique minor #5). **Invoke `vn-compliance` before
finalizing consent + address.** **Amend `plan.md` line 29 in this PR** (critique important #2): "zalo added to
`consent_channel` only; `Order.channel` stays web/inbox per status.go".

### PR-2e — order spine
Migration `000005_orders`: `orders` (`code` UNIQUE, `channel`/`status` native enums byte-identical to `status.go`,
`customer_id` FK, `shipping_address` jsonb no-district, `subtotal`/`shipping_fee`/`total` int8 NOT NULL CHECK≥0,
`payment_method` enum, `payment_proof_url`/`payment_confirmed_at`/`refund_proof_url`/`tracking_code`/`note` NULL,
**`status_history` jsonb NOT NULL DEFAULT '[]'** per ADR-004, created/updated_at), `order_items` (`option_ids` jsonb
default [], `personalization` jsonb NULL {text,zoneId}, `quantity` CHECK>0, `unit_price` int8 CHECK≥0). **sqlc
overrides** map `status_history` → `[]order.StatusEvent`, `shipping_address` → `Address`, `personalization` →
`*Personalization` (reuse slice-1 types so persistence can't drift). Queries: `CreateOrder` (channel →
`order.InitialStatusForChannel`), `GetOrderByCode/ID`, `ListOrdersByStatus`, `UpdateOrderStatus` (**single atomic
UPDATE**: flip status + jsonb-append one StatusEvent, inside caller tx, reusing `order.Transition` for the rule),
`InsertOrderItem`. **Emit-seams** (event-outbox): order-create commits `orders` row + `order.created` atomically;
reconcile→PAID commits status flip + statusHistory append + `order.paid` atomically — all via `EnqueueOutbox(tx,…)`.
**refundProofUrl consistency (critique important #1):** the REFUNDED transition writes `refund_proof_url` to **both**
the appended StatusEvent **and** the order-level column in the same atomic UPDATE (order-level = denormalized copy of
the latest REFUNDED event); add a test asserting they match.

### PR-2f — fulfillment/asset
Migration `000006_jobs`: `asset_jobs` (**shape INFERRED — decision D3, may defer**), `print_jobs` (`stage`
`print_stage` enum OR derived from `order.status` — decision D6). Third emit-seam: `CreateAssetJobTx(ctx, tx, …)`
inserts `asset_jobs(queued)` AND `EnqueueOutbox(tx,{event_type:'asset_job.created',…})` in one tx. **Payload must
carry the model source pointer (URL/version), not just product_id** (critique minor #6, ADR-006 reconstructability).
**Invoke `event-outbox` + `render-worker-gpu` skills; confirm AssetJob shape before freezing.**

### PR-2g — config/reference
Migration `000007_settings`: `reply_templates`, `settings` singleton (`refund_policy` **not** return_policy per
ADR-012, `bank_account` jsonb VietQR), `setting_bank_audit` (**append-only owner-only** money-out config lock,
conventions §57 — NO UPDATE/DELETE in the data path). **No e-invoice/tax columns** (compliance §5 deferred). Queries:
`GetSettings`, `UpdateSettings`, `InsertBankAudit`, `ListBankAudit`, `InsertReplyTemplate`, `ListReplyTemplates`.

## 2. Locked decisions (picked per conflict, not averaged)

1. **statusHistory = jsonb column on `orders`, NOT a child table** (ADR-004 locks "JSON column cho statusHistory/
   address/personalization"; do-not-relitigate). Dominant access = "show this order's timeline" at one-shop scale;
   sqlc override maps the jsonb to the existing `[]order.StatusEvent` so persistence can't drift from the slice-1
   guard. Append = **single atomic UPDATE** (flip status + jsonb-append in one statement inside the caller tx) to
   avoid lost-update races. Cross-order audit reporting → openQuestion, not built.
2. **Native Postgres ENUM** for closed contract sets, byte-identical to slice-1 `status.go` + `packages/core`:
   `order_status` 7 UPPERCASE incl double-L `CANCELLED` + `REFUNDED` (**`RETURNED` absent**, ADR-012),
   `order_channel` web/inbox, `user_role` owner/staff (**no `system`** — runtime actor only), `payment_method`
   bank_transfer, `product_status` active/draft/archived, `option_type` text/choice, `review_status`
   published/hidden, `print_stage` NEED_PRINT/PRINTING/PACKING/SHIPPED, `consent_scope`/`consent_channel`,
   `asset_job_*` (inferred). **EXCEPTION:** `product_material` is open-ended in spec (`PLA·PETG·recycled-PLA…`) so
   it is **TEXT+CHECK** (avoids `ALTER TYPE` friction) — the one place the enum bias yields. *(decision D2)*
3. **Money** = every money column `BIGINT NOT NULL CHECK(col>=0)` VND, never numeric/float. Server-computed via
   slice-1 `internal/money.CalcTotals`; client total never accepted (not even a create-input column). `sum(parts)
   ==total` enforced in Go + tests, not SQL.
4. **Address** = jsonb {province, ward, street, name, phone}, **no district key** (ADR-017); enforced in the Go
   struct + validation (jsonb sub-fields can't be Postgres-constrained).
5. **PDPL consent** = first-class **append-then-mark** child table `consent_grants` (one row per purpose), never a
   boolean, never pre-defaulted true, never gates checkout; withdrawal = set `withdrawn_at` (never hard-delete);
   `policy_version` plain string this slice.
6. **Outbox tx-insert helper** takes `pgx.Tx` as **first arg** (structural dual-write guard); `dedup_key` UNIQUE;
   `id` app-generated uuid (reusable as event id + `Nats-Msg-Id`); `event_type` stored as the dotted NATS subject so
   the slice-3 relay needs no lookup. Relay/NATS topology **explicitly deferred**; slice 2 leaves every row at
   `status='pending'`.

camelCase JSON tags hand-threaded via sqlc overrides to match OpenAPI/TS (`shippingAddress`, `paymentProofUrl`,
`paymentConfirmedAt`, `refundProofUrl`, `trackingCode`, `socialHandle`, `optionIds`, `zoneId`) even though columns
are snake_case (ADR-003, no ORM auto-map). All times timestamptz UTC; StatusEvent `at` serialized Z-only.

## 3. sqlc layout

`services/core-api/sqlc.yaml` v2, one sql block: engine postgresql · sql_package pgx/v5 · **`schema:
db/migrations/*.up.sql`** (up-only glob — see BLOCKER below) · `queries: db/queries/*.sql` (one file per axis) ·
`out: internal/db/sqlc` (package `sqlc`). gen: `emit_json_tags=true` (camelCase), `emit_pointers_for_null_types=true`,
`emit_interface=true` (testable Querier), `emit_prepared_queries=false` (pgx caches), `emit_exact_table_names=false`.

**`overrides` map jsonb / enum columns to EXISTING slice-1 Go types so persistence can't drift:**
- `orders.status_history` → `[]…/internal/order.StatusEvent`
- `orders.shipping_address` + `customers.addresses` → a shared `Address` struct
- `order_items.personalization` → `*Personalization {Text, ZoneID}`
- `outbox.payload` → `encoding/json.RawMessage`
- **`order_status`/`order_channel`/`user_role`/`payment_method` enums → the EXISTING `internal/order` types**
  (critique important #3 — avoids sqlc minting a second Go enum type; one type, asserted by a parity test as backup).

Hand-written thin repo wrappers (`internal/db/*.go`) wrap the generated Querier so httpapi handlers stay logic-free.
Generated `*.gen.go` must be gofmt/vet/golangci-clean or **path-excluded in `.golangci.yml` `exclusions.rules`** (not
linters disabled globally).

> **CRITIQUE BLOCKER (fixed here):** pointing sqlc's `schema` at the flat golang-migrate dir would glob the
> `.down.sql` DROP statements and leave sqlc with an empty/inconsistent schema → breaks codegen + the newly-armed
> `sqlc vet` gate. **Fix:** `schema: db/migrations/*.up.sql` (up-only glob). If the pinned sqlc version doesn't
> honor the glob cleanly, fall back to split `db/migrations/{up,down}/` dirs OR a consolidated `db/schema.sql` +
> a CI check that `schema.sql == concat(up migrations)`. **Decide concretely in PR-2a before any query lands.** The
> "drift impossible by construction" claim is dropped — drift is prevented by `sqlc vet` against the real up-schema,
> not by globbing.

## 4. Outbox DDL (migration `000002`, PR-2b) — APP Postgres only (never postgres-umami, ADR-004)

```sql
CREATE TABLE outbox (
  id             uuid        PRIMARY KEY,          -- app-generated in Go (event id + Nats-Msg-Id), NOT a DB default
  seq            bigserial   NOT NULL,             -- monotonic commit-order for the slice-3 relay
  aggregate_type text        NOT NULL,             -- 'order' | 'asset_job'
  aggregate_id   uuid        NOT NULL,
  event_type     text        NOT NULL,             -- canonical dotted NATS subject (== subject; relay needs no lookup)
  payload        jsonb       NOT NULL,             -- int VND only, no float; reconstructable from source, no blobs
  status         text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','published','failed')),
  dedup_key      text        NOT NULL,             -- idempotency key
  attempts       int         NOT NULL DEFAULT 0,   -- only the slice-3 relay mutates
  created_at     timestamptz NOT NULL DEFAULT now(),
  published_at   timestamptz,                      -- only the slice-3 relay sets
  CONSTRAINT outbox_dedup_key_uq UNIQUE (dedup_key)
);
CREATE INDEX outbox_unpublished_idx ON outbox (seq) WHERE status = 'pending';
```

**Seam:** `EnqueueOutbox(ctx, tx pgx.Tx, ev OutboxEvent) error` — row + domain mutation commit/rollback together
(one commit; a crash between is impossible). **dedup_key:** singleton events (one `order.paid` per order) →
`aggregate_type:aggregate_id:event_type` (UNIQUE rejects a buggy double-insert); legitimately-repeatable events
(re-triggered render) → the row uuid. **Deferred to slice 3:** the relay loop, JetStream stream/consumer, ack-wait
+ heartbeat, consumer-side dedup.

## 5. pgx pool · gates · tests

- **pgx pool** (`internal/db/pool.go`): `Open(ctx, cfg)` via `pgxpool.ParseConfig` + knobs + Ping; lifecycle in
  `main.go` mirroring config→main→server, `Close` after `srv.Shutdown`; threaded into `NewRouter(logger, pool)`;
  `readyz` Pings. Repos accept either the pool or a `pgx.Tx` so order-create/reconcile run domain row + statusHistory
  append + outbox insert in **one** `pool.BeginTx`. Connects **only** to the compose `postgres` service.
- **ARM gates:** arm `sqlc vet` into the `verify-go` recipe (clears the active-context "sqlc vet DEFERRED" note);
  **extend `guard.test.sh §ARM-GUARD`** to grep `sqlc vet` is *inside* the recipe (not just that the target exists)
  + a testcontainers real-check (skip-always ⇒ bad). CI `harness.yml services-gates` already runs `make verify-go`
  on `services/**` — **ensure the CI lane provisions a Docker daemon** for sqlc/db-prepare + testcontainers
  (openQuestion: testcontainers vs compose-ephemeral). Tick `docs/plan.md` ARM checklist (+ new line for
  sqlc-vet-in-recipe + migration-reversibility).
- **Test strategy:** testcontainers-go (postgres module) inside `go test -race` per package, applying the **real**
  `db/migrations/*.up.sql` (not a hand-rolled schema); `t.Skip` cleanly without Docker. `sqlc vet` PREPAREs every
  query against real Postgres (co-validates migrations + queries). Migration-reversibility (up→down→empty→up).
  Outbox atomicity (rollback=0 / commit=1 / dedup rejects). Emit-seam (domain row + event vanish together on
  rollback). statusHistory atomic append + `ReplayStatus==status` + reason/refundProofUrl guards at the Go layer.
  Money int8 round-trip + CHECK≥0 + `sum(parts)==total` via CalcTotals. Enum parity (byte-identical to slice-1).
  Address no-district. Consent append-then-mark / withdrawn excluded / never pre-defaulted. property test
  (`testing/quick`, no new dep) for replay over random valid walks.

## 6. Decisions to confirm before PR-2a

These are the genuinely-open calls (recommendations in **bold**); the rest of the openQuestions resolve to the
locked defaults in §2 and are recorded for later PRs.

- **D1 — Migration tool (NEW ADR, gates everything).** `operations.md`/`architecture.md` name no tool.
  **Recommend golang-migrate** (native pgx/v5 driver, single static binary, plain numbered up/down SQL that doubles
  as sqlc's up-schema source, fits the gated one-shot deploy job in `operations.md §4`). Alt: goose. Avoid ORM
  auto-migrate (GORM rejected in ADR-004). → write **ADR-028**.
- **D2 — Enum representation.** **Recommend native Postgres ENUM for closed sets + TEXT+CHECK for the open-ended
  `product_material`** (§2.2). Fold into ADR-028 or a sibling ADR.
- **D3 — AssetJob (PR-2f).** Spec §02 has **no** field table — all columns inferred from architecture. **Recommend
  sequencing 2f after the order spine and confirming the shape via `render-worker-gpu` before freezing the
  migration; defer `asset_jobs` to its own PR if still unconfirmed** (the emit-seam can wait — slice 2 has no relay).
- **D4 — testcontainers migration applier.** To keep "pgx/v5 = sole new *runtime* require" true, **recommend a tiny
  in-test SQL applier** (read `*.up.sql`, exec in order) needing no new dep, rather than importing golang-migrate
  into `go test`. *(critique important #4)*
- **D5 — Category.** **Recommend a minimal `categories` table** (id/slug/name) to satisfy `products.category_id` FK
  (alt: nullable FK, no table).
- **D6 — PrintJob.stage.** Stored `print_stage` enum vs purely derived from `order.status` (§04 "ánh xạ từ order
  status"). **Recommend deciding in PR-2f** alongside the AssetJob shape.

## 7. Done (this slice)

All 7 sub-PRs merged: `make verify-go` green with `sqlc vet` + testcontainers armed; `guard.test.sh §ARM-GUARD`
asserts the recipe body (gate can't no-op); all 12 in-scope entities + enums + outbox in real Postgres; statusHistory
persisted as jsonb reusing slice-1 types; money int8 server-authoritative; address province→ward→street; PDPL
consent append-then-mark; the three emit-seams write publish-on-commit rows atomically (relay deferred to slice 3).
