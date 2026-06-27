# Plan — Core slice 3 · HTTP wiring + outbox→NATS relay (Go core-api: routes + auth/RBAC + relay + OpenAPI)

> Phase "Core · HTTP surface + event relay", slice 3 (slice 1 = pure-Go spine **MERGED** `10b31f6`;
> slice 2 = data layer **MERGED** PR-2a..2g → `main` `ffab5f8`).
> Sources of truth: `spec.md` §01/§03/§04/§05/§08 (flows · states · state machine · validation · auth) ·
> `conventions.md` (money/statusHistory/Realtime/Scope&PR/Bảo mật) · `decisions.md`
> ADR-003 (OpenAPI/jwtauth) / 004 / 006 (outbox publish-on-commit) / 007 (worker) / 008 (SSE) /
> 009 (all-home, accept-downtime) / 010 / 012 (RBAC money-in vs money-out) / 017 / 019 / 027 (PR hygiene) /
> 028 (data layer) · reference impl `packages/core` (TS: `order-state.ts`, `schemas.ts`, `money.ts`) ·
> slice-1/2 **as-built** Go (`internal/order`, `internal/money`, `internal/db` tx seams, `internal/httpapi/router.go`,
> `db/migrations 000001-000007`, `db/queries/outbox.sql`).
> Branch: `feat/core-http-relay` off `main` (`ffab5f8`). Built from a planning workflow (8 readers → 3 design
> proposals → 3 judge lenses → this synthesis). **Backbone = the MINIMAL-FIRST proposal** (thinnest correct slice,
> in-process relay, defer everything legitimately deferrable — best honors ADR-009 + the 4 always-must + one-shop
> scale); **grafted** the relay failure-policy fix + the error-envelope mapping table + the 4-way enum parity test
> from CONTRACT-FIRST, and the late-seq regression test + panic-recovery wrapper from ROBUSTNESS-FIRST, while
> **rejecting** that proposal's advisory-lock singleton (ADR-009 forbids coordination). Decomposition discipline
> (split HTTP-foundation from auth, split pricing-helpers from the checkout handler, split the relay into
> substrate + drain-loop) is grafted because the judges flagged the backbone's two fused mega-PRs as its one real weakness.

## The 4 always-must rules (bind EVERY sub-PR — `CLAUDE.md §6`, `domain-core.md`)

1. **statusHistory** `{from,to,at,byUser,reason?}` appended on **every** transition **and** on creation (genesis
   `from=nil`) — **only** via `order.Transition`/`order.GenesisEvent` through the tx seams; handlers NEVER hand-build
   a `StatusEvent` or write `status`/`status_history` directly. `reason` mandatory for `CANCELLED`/`REFUNDED`;
   `refundProofUrl` mandatory for `REFUNDED`. `byUser`/`role`/`at` come from the **auth context + server clock**, never the body.
2. **Money = int VND**, server-authoritative: totals via `money.CalcTotals`; the client total/subtotal is never
   accepted (not even an input field); `UnitPrice` is re-derived server-side from the catalog. The single display
   formatter lives in `packages/core` — core-api emits raw int VND (no Go formatter this slice; see §6 D6).
3. **i18n keys, no hard-coded UI strings** (next-intl ICU, default `vi`). The domain's Vietnamese
   `TransitionError.Message` is **server-internal** — the HTTP edge maps it to a stable code / i18n key, never forwards the prose.
4. **`prefers-reduced-motion` + WCAG 2.2 AA** on every UI surface (only the one frontend PR, 3j, has an a11y surface).

## 0. What this slice is

The HTTP surface for `services/core-api` **on top of** the merged slice-2 data layer (12 entities + enums + outbox +
3 tx emit-seams, all in real Postgres). Handlers stay **thin**: decode → resolve actor → `pool.BeginTx` → call the
existing `CreateOrderTx` / `ConfirmPaymentTx` / `AdvanceStatusTx` / `UpdateBankAccountTx` seams → commit → assemble
the nested API DTO. All money/state/RBAC math stays in `internal/order` + `internal/money`; SQL stays in
`internal/db`. It introduces:

- the **outbox→NATS JetStream relay** — the deferred publish-side drainer of the `pending` rows slice-2 accumulates
  (an in-process goroutine; *NEW ADR — see §6 D1*).
- the **OpenAPI Go↔TS contract** + codegen (`oapi-codegen` Go, `openapi-typescript`/`openapi-fetch` TS) and a new
  `packages/api-client` — the contract layer ADR-003 mandates (*NEW ADR — see §6 D3*).
- **Self-issued JWT auth (email+password login + the owner/staff RBAC middleware boundary)** (*NEW ADR — see §6 D2*).
- a standardized **HTTP error envelope** + the domain-error→status/i18n-key mapping (*candidate ADR — see §6 D4*).
- **`POST /orders`** — `channel=web` → `PENDING_CONFIRM` (requires a payment-proof URL), public; `channel=inbox` →
  `PAID` **but staff/owner-authenticated only** (the inbox branch mints a born-`PAID` order with no payment record,
  so it is a money-creation primitive — conventions §17 / ADR-012 §49 staff-create; *see the BLOCKER fix at §1 PR-3g*) +
  the **transition endpoint** (`POST /orders/{id}/transitions`, owner/staff RBAC-gated, reconcile→PAID routed through `ConfirmPaymentTx`).
- the **owner-only settings/bank-account (STK) endpoint** (`PATCH /admin/settings/bank-account` over the slice-2
  `UpdateBankAccountTx` audit-on-commit seam, conventions §57) + reply-template admin reads — the surface the data
  layer deferred "to the slice-3 RBAC middleware" (`§1 PR-3k`).
- the **admin dashboard aggregate endpoint** + the frontend wiring that replaces `apps/admin/.../demo-dashboard.ts`.
- the **NATS reachability gate** on `/readyz` + the relay invariants ARMed into `tests/harness/guard.test.sh`.

### Out of scope (later)

- **SSE** (print-queue + AssetJob progress, ADR-008). Not in the enumerated slice-3 scope; the fallback (short
  polling of a status endpoint) is the slice-3 stopgap. Deferred to a follow-on slice. *(confirm §6 D7.)*
- **Worker-callback endpoint** (`POST` worker → `Jobs.MarkAssetJob`): the Rust worker is a phase-0 scaffold with no
  consumer, so the callback has no caller yet — deferred with SSE. *(§6 D7.)*
- **Storefront customer accounts** (Google/email login, order history) + the Pet Tag `Account` entity — a different
  identity domain from the staff `users` table; Phase-1 storefront, not slice-3. *(§6 D2.)*
- **Guest order-lookup** (code + phone, constant-time + lockout) — storefront-facing; defer unless cheaply bundled.
- **Consumer-side WorkQueue durable consumer + DLQ stream + MaxDeliver/AckWait tuning** — the Rust worker's concern
  (`conventions §Queue`, ADR-007); the relay only *provisions the stream* to support them (§4).
- **`print_jobs` fan-out on PAID**, full `shipping_rules` engine, e-invoice/tax — deferred or minimal-stub (§6 D10/D11).
  **`tracking_code` on SHIPPING is NOT deferred** — it gets a concrete in-tx write path this slice (§1 PR-3h / §6 D12).
- The **QC packing-photo gate** on `PRINTING→SHIPPING` (spec §04 requires *ảnh QC + mã vận chuyển*): no `qc_photo`
  column / no upload surface exists, so the photo half is **deferred with the presigned-upload surface**; slice-3
  enforces only the `trackingCode` half (§6 D12).
- **Presigned-PUT receipt/model upload to Garage** (ADR-005, S3 multipart, <100MB). Deferred → **`POST /orders` (web)
  accepts a pre-validated `paymentProofUrl` but does NOT mint it**; the upload endpoint that produces that URL lands
  with the storefront-checkout surface, so a full browser→upload→order flow is **not** exercised this slice (§6 D5,
  §7). The same gap means **`asset_job.created` has no slice-3 producer** — its relay path is proven by tests via the
  `CreateAssetJobTx` seam, not a live catalog model-upload handler (§7).
- **Catalog read DTOs / GET catalog handlers + a storefront client** — the storefront surface is Phase-1, so the
  slice-3 OpenAPI contract is trimmed to what core-api actually serves now (§1 PR-3c-1). The *internal* by-id catalog
  sqlc reads the create handler needs still land in 3f.
- A **Go `formatVnd`** — no slice-3 endpoint renders money to *text* (money crosses the wire as int-VND JSON; email
  is Phase 5; the OG card is Phase-1 storefront TS; the static VietQR render is deferred with the checkout-display
  surface and is amount-less per conventions §57, so it needs no money text either). Deferred. *(§6 D6.)*
- `Read/Write/Idle` socket timeouts on `http.Server` (Phase-1 TODO in `main.go`); `CF-Connecting-IP` real-IP wiring
  (edge phase); rate-limiting (Cloudflare WAF) — all unchanged from today.

## 1. Decomposition — 13 sub-PRs

Slice 3 far exceeds the 1-axis/~400-line rule (`conventions §Scope&PR` / ADR-027), so it splits into thirteen sub-PRs on
**two independent tracks** that can land in parallel: the **relay track** (`3a→3b`) and the **contract/HTTP track**
(`3c-1→3c-2→3d→3e-1→3e-2→{3g,3h,3i,3k}→3j`), with `3f` (pricing helpers) an independent node feeding checkout. The OpenAPI
keystone is split **contract-authoring (`3c-1`) ↔ codegen+package-scaffolding (`3c-2`)** (a budget fix — hand-authoring
the full YAML *and* wiring two codegen toolchains + a new `packages/api-client` is two axes well over 400 lines); **auth
splits self-issued-login (`3e-1`) ↔ verify+RBAC (`3e-2`)** (the self-issued JWT decision — D2 — adds a credential
migration + `POST /auth/login` + bcrypt, pushing the single auth PR over budget); and a 13th PR (`3k`) builds the
owner-only settings/STK surface the data layer explicitly handed to slice-3. Generated code
(`*.gen.go`, `openapi-typescript` output) is **excluded** from each line budget **and path-excluded in
`.golangci.yml exclusions.rules`** (oapi-codegen output trips golangci-lint v2's zero-issue gate otherwise — mirror the
data-layer's gen-exclude, `core-data-layer.md §3`); note both in every PR body so the diff-size advisory isn't misread.

| PR | Axis | ~lines | depends on |
|---|---|---|---|
| **3a** | relay substrate: `nats.go` dep + config knobs + `internal/nats` connect/reconnect + `ensureTopology` + `main.go` lifecycle + `/readyz` NATS check | 360 | — |
| **3b** | relay **drain loop**: 4 new outbox sqlc queries + poll→publish→PubAck→mark + transient-vs-poison policy + panic-recovery + ARM + EARS `REL-01/02` | 400 | 3a |
| **3c-1** | **OpenAPI contract authoring** (hand-author `openapi.yaml`, slice-3 surfaces only — no catalog read DTOs) + 4-way enum parity test + Review `text`→`body` spec-sync | 300 | — |
| **3c-2** | **codegen + scaffolding**: `oapi-codegen` (Go) + `openapi-typescript`/`openapi-fetch` → NEW `packages/api-client` + Turborepo + `*.gen.go` `.golangci` exclude + `acceptance.ledger.test.ts` (D13) | 280 | 3c-1 |
| **3d** | HTTP foundation: error envelope + domain-error→status mapping + `Server` struct + `withTx` + JSON decode + route-group skeleton | 340 | 3c-2 |
| **3e-1** | auth: **self-issued** login — `POST /auth/login` + `bcrypt` + JWT issue (httpOnly cookie) + `go-chi/jwtauth` dep + credential migration `000009_user_credentials` + owner-seed | 320 | 3d |
| **3e-2** | auth: JWT-verify middleware + RBAC (owner/staff) + `requireOwner` + **optional-auth** middleware + actor injection + EARS `RBA-01` | 360 | 3e-1 |
| **3f** | order-intake prerequisites: by-id catalog sqlc queries + pricing/shipping/code/customer helpers (+ property tests) + migration `000008_order_code_seq` | 410 | — |
| **3g** | **`POST /orders`** (public web + **staff-gated inbox**) + guest-genesis `ByUser` sentinel (idempotency DEFERRED, §6 D5) + EARS `CHK-04/05` | 340 | 3d, 3e-2, 3f |
| **3h** | **transition endpoints** (`POST /orders/{id}/transitions`, RBAC-gated, footgun-safe dispatch) + `tracking_code`-on-SHIPPING + EARS `PAY-01/SHP-01` | 390 | 3d, 3e-2 |
| **3i** | admin dashboard **aggregate** endpoint (Go read) + new aggregate sqlc + migration `000010_dashboard_idx` (2 indexes) | 340 | 3d, 3e-2 |
| **3j** | admin dashboard **frontend** — replace `demo-dashboard.ts` with the generated client | 300 | 3c-2, 3i |
| **3k** | **admin settings/STK**: `GET /admin/settings` + owner-only `PATCH /admin/settings/bank-account` (`UpdateBankAccountTx`) + reply-template reads + EARS `STK-01` | 320 | 3d, 3e-2 |

> **Why split where the backbone fused.** The minimal proposal bundled (a) HTTP-foundation **with** auth (login + JWT
> verify) + RBAC into one 560-line PR, and (b) all of checkout's pricing/shipping/code/customer helpers **with** the
> `POST /orders` handler into one 580-line PR. The judges flagged exactly these two as the backbone's weakest
> reviewability points — they are the most security-critical and most invariant-dense code, so they most need
> isolated review + independent test surfaces. We split foundation↔auth (`3d`/`3e-1`/`3e-2`) and helpers↔handler (`3f`/`3g`),
> and split the highest-risk axis (the relay) into substrate↔drain-loop (`3a`/`3b`). The completeness critique added
> two more: the OpenAPI keystone splits contract-authoring↔codegen+scaffolding (`3c-1`/`3c-2`) — hand-authoring the
> full YAML *and* wiring two codegen toolchains + a new package is two axes well over budget — and the owner-only
> settings/STK surface the data layer handed to slice-3 becomes its own `3k` (without it `requireOwner` cites a route
> nothing builds). We did **not** adopt the robustness proposal's 3-way relay split or its advisory-lock PR — that
> extra surface is the over-engineering ADR-009 rejects.

> **Dependency note (grafted fix):** `3h` (transitions) depends on `3d`+`3e` **only**, NOT on `3g` (checkout) — a
> transition operates on an order that test setup mints directly via the `CreateOrderTx` seam, so it needs no create
> *endpoint*. The contract-first proposal's `3f→3e` edge was over-tight and needlessly serialized the order track.

### PR-3a — relay substrate (the relay keystone)
1. `go get github.com/nats-io/nats.go` (the official Go JetStream client; pin like ADR-028 pins pgx/sqlc) + `go mod tidy`.
2. `config.go` gains `NATSURL` (`NATS_URL`, default `nats://127.0.0.1:4222` — matches `infra/docker-compose.yml`),
   `RelayPollInterval` (default ~1s), `RelayBatchSize` (default ~100), `RelayMaxAttempts`, `RelayDupWindow`
   (default ~2m) — all via the existing `getenv`/`getenvInt` twelve-factor pattern with safe defaults so `verify-go`
   stays green env-less.
3. NEW `internal/nats` package: `Connect(ctx, cfg)` with reconnect/backoff options + a JetStream context; an
   **idempotent `ensureTopology()`** (`CreateOrUpdateStream`) provisioning **two** streams so a publish never hits a
   no-responders error (§4): `ORDERS` (`subjects=[order.>]`, `Limits` retention) and `ASSET_JOBS`
   (`subjects=[asset_job.>]`, `WorkQueue` retention), `DuplicateWindow` ~2m on both. **The relay provisions streams
   only — it does NOT create the worker's durable consumer** (that config is worker-domain knowledge; §4, ADR-007).
4. `main.go`: connect to NATS **after** `db.Open` (one shared `nats.Conn`), wire `Close`/drain into the existing
   `signal`/`Shutdown` sequence **before** `pool.Close()`. A NATS connect failure must NOT be fail-fast (mirror the
   lazy pool — readiness reports it).
5. `/readyz` gains a NATS reachability check alongside the existing `pool.Ping` (router.go:39-42 TODO: "NATS/Garage
   join it once they are wired"). `NewRouter` signature grows to carry the NATS handle (or a `Server` struct — §3).
6. **No drain loop yet** — this PR is provably testable in isolation: `ensureTopology` idempotency (run twice → no
   error, streams converge), `/readyz` flips on NATS down. **ARM** the NATS-readiness + topology checks into
   `guard.test.sh` the moment they land. **Invoke the `event-outbox` skill before writing any publish code.**

> **As-built (PR-3a, 2026-06-27 — committed):** `internal/natsx` (package `natsx`, NOT `nats` — avoids colliding
> with the upstream `nats.go` import it wraps) = `Connect` (non-fail-fast: `RetryOnFailedConnect` + `MaxReconnects(-1)`,
> errors only on a malformed URL) + `EnsureTopology` (idempotent `CreateOrUpdateStream`: `ORDERS`/`order.>`/Limits +
> `ASSET_JOBS`/`asset_job.>`/WorkQueue, `DuplicateWindow` from cfg) + `Reachable()` + `Close()` (FlushTimeout→Close,
> synchronous for shutdown ordering). `config.go` gains `NATSURL` + `RelayPollInterval`/`RelayBatchSize`/
> `RelayMaxAttempts`/`RelayDupWindow` (+ a `getenvDuration` helper). `main.go` connects NATS after the pool,
> best-effort `EnsureTopology` at boot (NATS-down → log + continue, non-fatal, ADR-009), `nc.Close()` before
> `pool.Close()` on every exit path. `/readyz` gains a NATS `Reachable()` check via a router-local `NATSStatus`
> interface (httpapi stays decoupled from the nats client + unit-testable with a fake; a 503 names the failing `dep`).
> **Dep pin: `nats.go` v1.48.0** (v1.52 forces go 1.25 — pinned down like pgx v5.7.5/ADR-028 to keep `go 1.23`;
> +nkeys/nuid indirect). **No drain loop** (PR-3b). **Verified:** `make verify-go` green (golangci 0, sqlc vet+diff
> clean, `go test -race`); **2 natsx integration tests RAN vs real NATS+JetStream (colima, not just CI)** —
> EnsureTopology idempotency (2× run, streams converge; subjects/retention/dup asserted) + publish-lands-in-stream
> (order.created→ORDERS, asset_job.created→ASSET_JOBS); `/readyz` flips 503 on NATS-down (fake). **ARM:** `guard.test.sh`
> greps `nats.Reachable` in router + `EnsureTopology` in natsx — **proven binding** (dropped the readiness check →
> guard RED 141/1 → restored). guard.test.sh **142** (+1), osm 22. **CI NATS lane = self-contained** — the natsx test
> brings its own NATS via testcontainers `GenericContainer`, so it runs on the existing Docker-enabled `services-gates`
> lane with **no compose service / no `harness.yml` change** (cleaner than the §6-D7 "add a NATS service" sketch).
> **Deviation:** package named `natsx` not the plan's `nats` (upstream import collision) — documented.
>
> **Adversarial review (wf_adea04ba, 4 lenses → per-finding refute-verify): 14 raw → 5 confirmed (0 BLOCKER), all fixed.**
> (1 IMPORTANT) the keystone non-fail-fast boot contract was asserted only in prose — every natsx test routed through the
> Docker-only `startNATS`, so it never ran on the home box → added **Docker-free** unit tests (Connect-down → nil err +
> `Reachable()==false` · EnsureTopology-down → error · malformed-URL → error · nil/zero-`Conn` safety) that now execute
> everywhere. (4 NOTE) idempotency test now proves **convergence** (provision 1m → re-ensure 2m → assert 2m, not just a
> no-error re-run); the `main.go` comment was corrected (substrate provisions at boot **only** — reconnect re-ensure
> handed to PR-3b §1 with a no-stream-publish = *transient* rule); config tests assert exact defaults + the 2 missing env
> knobs. Refuted (kept as-is, sound): ORDERS-stream-unbounded (one-shop low-volume, an ops-tuning concern not a 3a defect)
> · `IsConnected`-not-JetStream-aware readiness (substrate-appropriate) · ARM brittle-to-the-PR-3d-`Server`-refactor
> (expected to update in 3d) · relay-knobs-accept-zero (no clamp, defaults safe).

### PR-3b — relay drain loop (publish-on-commit, the correctness PR)
1. `db/queries/outbox.sql` gains 4 queries (regenerate via `sqlc generate`, commit the `*.sql.go`):
   `SelectPendingOutbox` (`SELECT id, event_type, payload FROM outbox WHERE status='pending' ORDER BY seq LIMIT $1` —
   uses `outbox_unpublished_idx`, **the pending SET, never a `seq>watermark` cursor**, never `FOR UPDATE SKIP
   LOCKED`), `MarkOutboxPublished` (`status='published', published_at=now()`), `IncrementOutboxAttempts`,
   `MarkOutboxFailed`.
2. `internal/relay`: the poll loop. Each tick: `SelectPendingOutbox` → per row `js.PublishMsg(subject=event_type,
   Nats-Msg-Id=id, data=payload verbatim, ctx-bound)` → **await PubAck** → `MarkOutboxPublished`. Order is
   inviolate: **publish → PubAck → mark, never mark-then-publish**.
3. **Failure policy (grafted from CONTRACT-FIRST — fixes the backbone's bug):** distinguish a **transient connection
   failure** (NATS unreachable / no-responders at the connection level → leave the whole batch `pending`, do **NOT**
   increment `attempts`, back off) from a **per-message PubAck rejection** (a poison/malformed row →
   `IncrementOutboxAttempts`; after `RelayMaxAttempts` → `MarkOutboxFailed` so the poison row stops re-poisoning the
   `seq` scan, surfaced in a future Admin "failed events" view). Without this split, a NATS outage — the exact
   accept-downtime case — would wrongly quarantine every good money event as `failed`.
4. **Panic-recovery wrapper (grafted from ROBUSTNESS-FIRST):** `recover()`+log+continue around the loop so a relay
   bug can never crash the shared `core-api` process / HTTP server (chi's `Recoverer` does not cover this goroutine).
   **We deliberately do NOT add the advisory-lock singleton latch / auto-restart supervisor** — ADR-009 (single box,
   one-shot deploy, accept-downtime) makes multi-instance coordination over-engineering, and an overlapping-deploy
   double-publish is already collapsed by `Nats-Msg-Id` dedup.
5. `main.go` launches the relay goroutine (between connect and serve) and joins it on shutdown before `pool.Close()`.
   **Topology re-ensure (carried from the PR-3a review — the substrate provisions streams at boot ONLY, never on
   reconnect):** the relay MUST re-ensure topology on a NATS reconnect (register a `nats.ConnectHandler` +
   `ReconnectHandler` re-running `EnsureTopology`) AND treat a no-stream publish error (`ErrNoResponders` /
   stream-not-found) as **transient** (leave the row `pending`, re-ensure, retry) — NOT poison — so the
   NATS-down-at-boot-then-recovers case (the exact accept-downtime scenario, ADR-009) drains on recovery instead of
   quarantining good money events as `failed`.
6. **Tests (testcontainers Postgres + NATS):** `pending→published`; `Nats-Msg-Id` is set; **the late-committing-low-seq
   regression** (a tx with a *lower* `seq` that commits *after* a higher-`seq` row is still drained — the #1 silent-loss
   hazard, see §4); crash-after-PubAck-before-mark → republish deduped within the window; NATS-down → rows stay
   `pending`, no `attempts` burn, drain on recovery; poison row → `failed` without blocking later rows. **ARM** these
   invariants + an **`ARM-GUARD` comment locking the scan-the-pending-SET rule** so no future `seq>cursor`
   "optimization" can silently reintroduce loss. Append **`REL-01`** (publish-on-commit / scan-the-pending-SET, no
   loss) + **`REL-02`** (NATS-down accumulates `pending` without burning `attempts`) to `docs/acceptance.md` in this
   PR (§5 / §6 D13). **Invoke `event-outbox` before writing the publish path.**

### PR-3c-1 — OpenAPI contract authoring (the wire source of truth)
1. Hand-author **`services/core-api/openapi.yaml`** as the single wire source of truth (server owns the contract,
   ADR-003): the **nested** `Order` DTO (`customer{…}`, `items[]{…}`, `statusHistory[]` inline — NOT the flat
   `sqlc.Order`; handlers assemble it), `CreateWebOrderInput` + `CreateInboxOrderInput` (**no** `subtotal`/`total`;
   the `personalizationAck`/`engraveEchoConfirmed` refinements), `TransitionRequest {to, reason?, refundProofUrl?,
   trackingCode?}` (`trackingCode` carried for the SHIPPING edge — §6 D12), the `ErrorEnvelope` (§3d),
   `DashboardSnapshot`, the **settings/`bankAccount` DTOs** (PR-3k), and `securitySchemes` (public storefront vs
   JWT-cookie-gated admin). **Catalog read DTOs are OUT** — no GET catalog handler/consumer lands this slice (the
   storefront is Phase-1); the contract is trimmed to what core-api serves now (§0 Out of scope). camelCase property
   names matching `sqlc.yaml json_tags_case_style:camel` + the existing hand DTOs (`byUser`/`refundProofUrl`/`zoneId`/
   `orderId`/`paidAt`). Money = `integer, format:int64`.
2. Enums **byte-identical** to `internal/order` + `packages/core` + the PG enums (ADR-028): `OrderStatus` (7),
   `channel` (web|inbox), `role` (owner|staff|system). `statusHistory` entries reproduce
   `{from(nullable), to, at, byUser, reason?, refundProofUrl?}` field-for-field.
3. **Parity test (grafted, load-bearing):** assert the OpenAPI enum sets == `internal/order` constants ==
   `packages/core` Zod == PG enums (4-way) so the hand-authored OpenAPI cannot drift from the de-facto Zod contract.
4. **Resolve the Review `text`↔`body` drift:** the public API field is `body` (DB/Go already use `body`); fix
   `spec.md §02 Review.text`→`body` **in this PR** (spec-sync, `conventions §Scope&PR`). Keep it distinct from
   `Personalization.text` (engraving). The OpenAPI file is a **contract file** → expect the harness `guard-files`
   ask-gate (ADR-021/022) when editing it. The hand-authored YAML **counts against the line budget**.

### PR-3c-2 — codegen + `packages/api-client` scaffolding
1. Wire **`oapi-codegen`** (Go types; **consider `strict-server`** for compile-time handler↔contract conformance —
   §6 D8) → committed `*.gen.go`; **`openapi-typescript` + `openapi-fetch`** → a NEW `packages/api-client` (Turborepo
   wiring). Hook codegen + a `sqlc diff`-style stale check into `make verify-go` / the TS verify lane.
2. **Generated-file lint exclusion (NOTE fix):** path-exclude `*.gen.go` in `.golangci.yml exclusions.rules` (NOT
   linters disabled globally) — oapi-codegen output routinely trips golangci-lint v2's zero-issue gate; mirror the
   data-layer's gen-exclude (`core-data-layer.md §3`). The generated TS is `.eslintignore`'d / `tsc`-checked only.
   Generated code is excluded from the line budget (machine output).
3. **Land the Phase-0 `acceptance.ledger.test.ts` parser here (D13):** now that `packages/core` is stable and this PR
   already scaffolds the TS package, add the long-open `docs/plan.md` ARM item — the `packages/core` test that parses
   `docs/acceptance.md` and **fails** if a `[x]` row's test id does not resolve / does not pass — closing the Phase-0
   TODO and turning the ledger into a real gate for the TS-resolvable EARS rows.

### PR-3d — HTTP foundation (error envelope + Server struct + tx runner)
1. A standardized **`ErrorEnvelope {code, messageKey, fields?}`** (in the contract) emitted by a `writeError` sibling
   of `writeJSON` that **keeps the marshal-into-buffer-first contract** (an encode error becomes a 500, not a
   truncated 200). Today there is only `writeJSON` + an ad-hoc `{"error":"internal"}` string.
2. The central **domain-error → status/i18n-key mapper** (grafted explicit table from CONTRACT-FIRST):
   `db.ErrNotFound`→**404**; `db.ErrNoItems`→**422**; `db.ErrInvalidEvent`/`ErrInvalidAssetJob`/`ErrInvalidBankChange`
   + `money.ErrInvalidAmount`→**400/422**; `*order.TransitionError` switched on `.Code`:
   `INVALID_EDGE`→**409**, `RBAC`→**403**, `REASON_REQUIRED`/`REFUND_PROOF_REQUIRED`/`PROOF_REQUIRED`→**422**,
   `INVALID_ACTOR`/`INVALID_TIMESTAMP`→**400**. The Vietnamese `.Message` is mapped to a stable code / next-intl key,
   never forwarded (always-must #3).
3. Grow `NewRouter` into a **`Server struct { logger; pool; nats; queries; authVerifier }`** with methods (the
   `readiness(pool)` closure-factory is the precedent for handler deps). Add a thin **`withTx(ctx, pool, fn)`**
   runner (`BeginTx` → `defer Rollback` → `fn` → `Commit`) and a `decodeJSON` helper. Establish the chi route-group
   skeleton: a **public** group (storefront reads, `POST /orders`) vs an **admin** group (the §3e auth boundary). No
   domain endpoints yet. If `strict-server` is chosen (D8), land not-implemented stubs so the contract compiles green.

### PR-3e-1 — auth: self-issued login + JWT issue (ADR-030, user chose self-managed over Cloudflare Access)
1. **Self-issued JWT.** `go get github.com/go-chi/jwtauth/v5` (+ its JWT lib) — the auth dep **ADR-003 already names**,
   so self-issued is *consistent* with ADR-003 (not a departure) — and promote `golang.org/x/crypto` (`bcrypt`) from
   indirect→direct. core-api **owns** authentication; it does NOT delegate to a Cloudflare-Access edge assertion.
2. **Migration `000009_user_credentials`:** `ALTER TABLE users ADD COLUMN password_hash text` (+ `sqlc generate` regen +
   committed `*.sql.go`, golang-migrate/ADR-028). **Owner-seed:** seed the first `owner` with a bootstrap bcrypt hash
   that **must be rotated on first login** — *sub-decision to finalize in this PR* (seed-in-migration vs a
   `make seed-owner` CLI; the JWT signing secret comes from env, never committed).
3. `POST /auth/login` (email + password): `Identity.UserByEmail` → `bcrypt.CompareHashAndPassword` → on success mint a
   signed JWT (claims `sub=users.id`, `role`) → set it as an **httpOnly + Secure + SameSite cookie** (apps/admin is a
   Next SPA — a cookie keeps the token out of JS-readable storage, blunting XSS theft). `POST /auth/logout` clears it.
   Constant-time compare + a uniform "bad email-or-password" error (no user enumeration). **Token TTL + refresh policy
   finalized in this PR** (*sub-decision*).

### PR-3e-2 — auth: JWT-verify middleware + RBAC + actor injection
1. **JWT-verify middleware** on the admin group (jwtauth): validate the cookie's signed JWT, reject expired/invalid.
   Map the verified **`sub` (users.id) → `Identity.UserByID` → `users.role` → `order.Role`** (DB `user_role`
   owner|staff → `order.Role`; **never** persist `system`). Inject the actor `{ByUser=users.id string, Role,
   server-clock At}` into the request context — standardizing `ByUser` on `users.id` resolves the documented
   string-vs-uuid inconsistency (`statusHistory.byUser` string vs `setting_bank_audit.changed_by` uuid).
2. RBAC middleware on the admin group + a `requireOwner` sub-middleware for owner-only edges (reconcile→PAID,
   →REFUNDED, **and PR-3k's `PATCH /admin/settings/bank-account`** — the settings/STK use case that makes
   `requireOwner` an *exercised* boundary, not a dangling reference). **Do NOT re-implement RBAC math** — authenticate
   → resolve role → pass into the existing `order.RoleAllowed`/`order.Transition` guard (defense-in-depth; the domain
   guard stays the source of truth). HTTP-boundary RBAC tests layered on the merged OSM-04/05 domain coverage; append
   **`RBA-01`** (wrong-role rejected at the HTTP boundary) to `docs/acceptance.md` in this PR.
3. **An `optional-auth` (resolve-actor-if-present) middleware** for the public `POST /orders`: it verifies the JWT
   cookie **iff present** and resolves the actor into context, but does **not** reject when absent — so the §3g inbox
   branch can require a staff/owner actor while keeping web-create open. (`POST /orders` web stays public;
   `channel=inbox` does not — see the §3g BLOCKER fix.)

### PR-3f — order-intake prerequisites (server-authoritative money building blocks)
1. New sqlc **by-id catalog queries** (the read gap — only `ProductBySlug` + `List…ByProduct` exist today):
   `GetProductByID`, by-id color/option lookups (or list+filter).
2. A pricing helper (`internal/order` or a new `internal/pricing`): derive `UnitPrice` server-side = `base_price` +
   selected `color.price_delta` + `option price_deltas`; validate `color.available`, that color/options belong to the
   product, and the engrave `maxChars` (spec §05). The seam faithfully snapshots whatever price it is given, so price
   **authenticity is this helper's responsibility** — never trust a client `UnitPrice`.
3. A shipping-fee helper over `settings.shipping_rules` (province-keyed jsonb schema, **no district**, ADR-017 — §6 D10).
4. An order **code generator** (`#LMN-xxxx`) from a dedicated Postgres sequence, minted inside the create tx
   (collision-free by construction — §6 D9). **Migration `000008_order_code_seq`** (`CREATE SEQUENCE`) + `sqlc
   generate` regen + committed `*.sql.go` (golang-migrate, ADR-028) — counted in this PR.
5. Customer **find-or-create-by-phone** (`CustomerByPhone` → `CreateCustomer`) + PDPL consent capture. **Invoke
   `vn-compliance` before finalizing the consent + address path.**
6. Property tests on the totals invariants (`sum(parts)==total`, int-VND, non-negative). NOTE: at the upper bound —
   split into `3f-1` (queries + pricing) / `3f-2` (shipping + code + customer) if it exceeds ~450.

### PR-3g — POST /orders (public web + staff-gated inbox)
Thin handler bound to the generated `CreateWebOrderInput`/`CreateInboxOrderInput`: decode + validate (reject any
client total/subtotal), find-or-create customer + derive `UnitPrice` + `ShippingFee` + mint `code` (3f), `withTx` →
**`db.CreateOrderTx`** (derives status via `order.InitialStatusForChannel` — web requires non-empty `paymentProofUrl`
→ `PENDING_CONFIRM`; inbox → `PAID` + stamps `payment_confirmed_at`; appends genesis `StatusEvent`; totals via
`money.CalcTotals`; enqueues `order.created` in-tx) → commit → assemble + return the nested `Order` DTO. Map domain
errors via 3d; propagate `r.Context()`.

> **CRITIQUE BLOCKER (fixed here) — inbox-create is a money-creation primitive, gate it.** `order.InitialStatusForChannel`
> returns `PAID` for `channel=inbox` with **no** payment-proof check (verified: `internal/order/status.go:200-211`), and
> conventions §17 / ADR-012 §49 make inbox orders **staff-created** ("nhân viên tự kiểm tra thấy tiền về rồi tạo đơn
> thẳng `PAID`"). A uniformly-public `POST /orders` would let any unauthenticated caller send `{channel:"inbox"}` and
> mint a born-`PAID` order with no money + no proof. **Fix:** the handler runs behind the §3e **optional-auth**
> middleware and **rejects `channel=inbox` with 403 unless a resolved staff/owner actor is present**; `channel=web`
> stays open. (Equivalent unambiguous alternative — the critique sanctioned either: the public mount is web-only
> and rejects `channel=inbox`, while staff inbox-create is the **same handler also mounted on the JWT-gated
> admin group** where the actor is reliably resolved. Pick whichever keeps the auth path config clean — both
> close the bypass identically; **decide in this PR**, D2.) Append **`CHK-05`** (inbox-create requires staff/owner) to
> `docs/acceptance.md` in this PR.

- **Actor / `ByUser` (NOTE fix — guest path):** a public/guest web create has **no** authenticated actor, yet
  `order.GenesisEvent` requires a non-empty `ByUser`. Web-create writes a **reserved sentinel** `ByUser="customer"`
  (a documented non-uuid constant, distinct from any `users.id`) into the genesis `StatusEvent`; inbox-create writes
  the authenticated staff/owner `users.id` (from §3e). This nuances locked decision #6: `ByUser=users.id` is the rule
  for *staff/owner* actions; the customer self-service genesis is the documented exception (no storefront `Account`
  identity this slice).
- **Payment-proof (IMPORTANT fix — soften "end-to-end"):** `paymentProofUrl` is a validated URL string (host-trust
  check toward Garage/CDN — receipt is presigned-PUT direct to Garage, never proxied, ADR-005/CF 100MB cap). The
  presigned-PUT **upload endpoint that mints that URL is deferred** with the storefront-checkout surface — so
  `POST /orders` (web) **accepts a pre-existing/validated URL but a full browser→upload→order flow is not exercised
  this slice** (§0, §7). Append **`CHK-04`** (web-create requires `paymentProofUrl` at the HTTP boundary) to
  `docs/acceptance.md`.
- **Idempotency (§6 D5 — DEFERRED, user 2026-06-26):** slice-3 ships **no** `Idempotency-Key`/dedupe table. A retried
  `POST /orders` can therefore mint a **duplicate order + duplicate `order.created`** — an accepted money-path gap until
  a later slice (revisit when the storefront-checkout surface that produces real retries lands). **No
  `000009_idempotency_keys` migration this slice** (that number is reused by `3e-1`'s `000009_user_credentials`).

### PR-3h — transition endpoints (admin, RBAC-gated)
`POST /orders/{id}/transitions {to, reason?, refundProofUrl?, trackingCode?}` on the admin group. **Dispatch the
money-in reconcile `PENDING_CONFIRM→PAID` to `db.ConfirmPaymentTx`** (the ONLY emitter of `order.paid`) and **every
other edge** (`PRINTING`/`SHIPPING`/`COMPLETED`/`CANCELLED`/`REFUNDED`) to `db.AdvanceStatusTx` — **never
`AdvanceStatusTx` for the money-in edge** (the documented footgun: it flips state but emits no event, so the
relay/consumers never learn payment landed). Source `Role`/`ByUser`/`At` from the auth context + server clock, never
the body. Owner-only edges (reconcile, all →REFUNDED) gated at the `requireOwner` boundary (defense-in-depth over the
domain guard). `withTx` → seam → commit; map each `TransitionError.Code` via 3d.

> **IMPORTANT fix — `tracking_code` on SHIPPING has a concrete write path (§6 D12), resolving the dangling §1
> reference.** spec §04 makes `PRINTING→SHIPPING` require *ảnh QC + mã vận chuyển*, but the merged
> `AdvanceStatusTx(ctx, tx, orderID, to, tctx)` seam takes **no** `tracking_code` (verified: `internal/db/orders.go:273`).
> **Decision:** do **not** churn the merged seam — the SHIPPING handler validates `trackingCode` is present (non-empty,
> per spec) and runs a narrow new `SetTrackingCode` sqlc query **in the SAME `withTx`** as `AdvanceStatusTx`, so the
> status flip + `tracking_code` persist atomically. The `orders.tracking_code` column already exists (migration
> `000005`) → **no migration**, one new query + regen. The **QC packing-photo gate is deferred** (no `qc_photo` column
> / no upload surface — tied to the deferred presigned-upload, §0); slice-3 enforces only the `trackingCode` half.

**Tests + EARS:** dispatch-footgun (reconcile emits exactly one `order.paid` → **`PAY-01`**), staff-blocked-on-owner-edges,
each `TransitionError.Code` → status, SHIPPING persists `trackingCode` atomically + rejects an empty one (→ **`SHP-01`**).
Append `PAY-01`/`SHP-01` to `docs/acceptance.md` in this PR.

### PR-3i — admin dashboard aggregates (Go read endpoint)
New aggregate sqlc queries (zero `COUNT`/`SUM`/`GROUP BY` exist today): `newOrdersToday` count; **`revenueToday` =
`SUM(total)` over `PAID`/`PRINTING`/`SHIPPING`/`COMPLETED` minus `REFUNDED`, scoped to today** (spec §04 net-revenue
formula — `CANCELLED`-after-PAID keeps the money); `printing` count (`status='PRINTING'`); `reviewsWaiting`
(`reply IS NULL AND status='published'`); `recentOrders` (`orders JOIN customers ORDER BY created_at DESC LIMIT N`);
`todoPendingConfirm`/`todoPaidWaitingPrint` counts. Add an `orders(created_at)` index + a `reviews(status, reply)`
partial index via **migration `000010_dashboard_idx`** (golang-migrate, ADR-028) + `sqlc generate` regen for the new
aggregate queries. `GET /admin/dashboard` returns `{stats, recentOrders, todos}` as **raw
int-VND + counts + OrderStatus enum** — no server-formatted money, no translated labels (labelKeys stay i18n,
client-side). Admin-gated (owner+staff both view), thin handler, `r.Context()` propagated. **Resolve the
`Asia/Ho_Chi_Minh` "today" boundary** (DB stores UTC; the shop's day ≠ UTC midnight). Tests for the net-revenue
formula + the zero-state (render 0, never blank — spec §03).

### PR-3j — admin dashboard frontend (replace demo-dashboard.ts)
Replace `apps/admin/src/lib/demo-dashboard.ts` with a real fetch against `GET /admin/dashboard` via the generated
`@lumin/api-client` (`openapi-fetch`); add the core-api base-URL env wiring (none exists). Keep
`StatCards`/`RecentOrders`/`TodoList` consuming the same `{stats, recentOrders, todos}` shape + the `labelKey` i18n
contract; format money **only** via `@lumin/core` `formatVnd`/`formatVnNumber`; preserve loading · empty (render 0,
spec §03) · error states. The **only** axis touching a11y/i18n-keys/sentence-case/`prefers-reduced-motion` + the
ADR-027 visual-fidelity screenshot check.

### PR-3k — admin settings / bank-account (STK) + reply templates (owner-only)
The owner-only config surface the data layer **explicitly deferred** "to the slice-3 RBAC middleware" (`settings.go`,
migration `000007` lines 20/47, conventions §57) — closing the IMPORTANT internal inconsistency where `requireOwner`
cited settings/STK but no PR built it. `GET /admin/settings` (admin-gated read over `GetSettings`) + **`PATCH
/admin/settings/bank-account`** (owner-only via `requireOwner`) → `withTx` → **`db.UpdateBankAccountTx`** (the slice-2
audit-on-commit seam: STK change + append-only audit row in **one** tx, so an STK change can never land without its
audit row). Reply-template admin reads (`GET /admin/reply-templates` over the slice-2 `ListReplyTemplates` /
`GetReplyTemplateByID`). **The static VietQR *image* render** (the display half of conventions §57) is **NOT** built
here — it is a storefront/checkout-display concern, deferred with that surface (§0, §6 D6); this PR only persists the
STK. **Tests + EARS:** staff-blocked on `PATCH /admin/settings/bank-account` (owner-only), the STK change + audit row
commit atomically (rollback leaves neither); append **`STK-01`** to `docs/acceptance.md` in this PR.

## 2. Locked decisions (picked per conflict, not averaged)

1. **Relay = a single in-process goroutine in core-api** (NOT a separate `cmd/relay` binary). Durability lives in the
   committed `pending` rows, so a binary split buys no event-safety while adding a second deployable + a second NATS
   conn + a second lifecycle — over-engineering at one-shop scale (ADR-009). `architecture.md §2` ("core-api phát job
   qua outbox→NATS") and `main.go`'s own doc both lean in-process.
2. **Scan the pending SET `ORDER BY seq`, never a `seq>high-water-mark` cursor, never `FOR UPDATE SKIP LOCKED`.**
   `bigserial seq` is assigned at INSERT not COMMIT, so a lower-`seq` tx can become visible *after* a higher-`seq`
   one; a watermark would permanently skip the late-committing lower-`seq` row = **silent money-event loss**. This is
   the single biggest correctness hazard (§4). Single instance (ADR-009) ⇒ no SKIP LOCKED / leader election /
   advisory lock — the conflicting "consider SKIP LOCKED" hint loses to the more specific ADR-009 no-coordination rule.
3. **`publish → await PubAck → mark-published`, never mark-then-publish.** `Nats-Msg-Id = outbox.id` on every
   publish (JetStream server-side dedup within the duplicate window). **Subject = the literal `event_type`** verbatim
   (`order.created`/`order.paid`/`asset_job.created`) — honoring the DDL/`outbox.go` "event_type == subject, relay
   needs no lookup" invariant, resolving the recorded `asset.job`-bridge note in favor of the literal subject.
4. **The relay provisions streams only; the worker owns its durable consumer config.** `AckWait`-tuned-to-Blender,
   `MaxAckPending=1`, `MaxDeliver`→DLQ are worker-domain knobs (ADR-007, `conventions §Queue`) that drift if the
   relay hard-codes them. The subject mismatch (worker default `ASSET_JOB_SUBJECT='asset.job'` ≠ `asset_job.created`)
   is **captured** by the `ASSET_JOBS` stream's `asset_job.>` subject filter (the stream ingests the published event)
   — but this is **stream capture, not subject reconciliation** (NOTE fix): a future worker consumer that *binds /
   filters* on the worker default `asset.job` would still match nothing, so reconciling the worker's bind subject
   (default → `asset_job.created`) is a worker-phase task. **Slice-3 does NOT edit the worker default** (it has a
   pinned `env_or_pins_documented_defaults` test); functionally fine this slice since no consumer exists yet.
5. **Transient-vs-poison failure policy** (grafted): connection failure → leave `pending`, no `attempts` burn;
   per-message PubAck rejection → `attempts++` → `failed` after `RelayMaxAttempts`. The relay-side `failed`
   quarantine is **distinct** from the consumer-side `MaxDeliver`→DLQ (two surfaces: publish-side vs delivery-side).
6. **Auth = self-issued JWT (core-api owns login); no Cloudflare-Access dependency** (ADR-030, user chose self-managed).
   `POST /auth/login` (email+password) → `bcrypt` verify → signed JWT (`go-chi/jwtauth`, ADR-003) in an httpOnly+Secure
   cookie; `users` gains `password_hash` (migration `000009`). Map the JWT `sub` → `users` row → `order.Role`;
   `ByUser = users.id` **for staff/owner actions**. `system` is a runtime-only actor (SHIPPING→COMPLETED, deferred),
   never a stored role. RBAC at the middleware boundary is defense-in-depth over the domain guard (the guard stays
   authoritative). **`POST /orders` is gated by channel:** `web` is public; `channel=inbox` requires a staff/owner
   actor (conventions §17 / ADR-012 §49) via the §3e-2 optional-auth middleware. A **public/guest web create has no
   `users.id`**, so its genesis `StatusEvent.ByUser` is a reserved sentinel `"customer"` (distinct from any `users.id`)
   — the documented exception to `ByUser=users.id` (no storefront `Account` identity this slice).
7. **OpenAPI is the single hand-authored wire contract**, parity-tested against Go + Zod + PG enums; the public
   `Order` schema is the **nested** DTO, never the flat `sqlc` row; all properties camelCase; money `int64`.
8. **One `ErrorEnvelope {code, messageKey, fields?}`** + the explicit error→status table (§3d); the domain's
   Vietnamese `TransitionError.Message` never crosses the wire.
9. **Reconcile `PENDING_CONFIRM→PAID` MUST route through `ConfirmPaymentTx`** (the only `order.paid` emitter); every
   other edge through `AdvanceStatusTx`. `statusHistory` is appended **only** by the seams via `order.Transition`.
10. **No Go `formatVnd` this slice** — money stays int-VND JSON on the wire; the single formatter remains the
    `packages/core` TS `formatVnd`. (Reopen only if a money-text surface lands — §6 D6.)

## 3. HTTP layer shape (how a thin handler gets its deps)

`NewRouter` grows into a **`Server` struct** carrying `{logger, pool, nats, queries (sqlc.New(pool)), authVerifier}`
with handler methods — the established `readiness(pool)` closure-factory is the precedent for dependency injection;
free funcs taking the pool don't scale to NATS + auth + queries. Handlers stay logic-free: they decode via
`decodeJSON`, resolve the actor from the request context (set by the §3e middleware), run a `withTx(ctx, pool, fn)`
that calls one or more **same-tx** seams, then assemble the nested DTO from `sqlc.Order` + `ListOrderItems` + a
customer fetch. SQL never appears in `httpapi`/`cmd` (architecture §3, db package doc). Every DB **and** NATS call
takes `r.Context()` (the 30s chi `Timeout` is cooperative only). Route topology: a **public** chi group (catalog
reads, `POST /orders` behind an **optional-auth** middleware — `channel=web` is open, `channel=inbox` requires a
resolved staff/owner actor, §3g BLOCKER fix) and a **JWT-gated admin** group (transitions, dashboard,
settings/STK) with a `requireOwner` sub-middleware for owner-only edges (reconcile→PAID, →REFUNDED, **and the built
`PATCH /admin/settings/bank-account` of PR-3k**).

## 4. Outbox→NATS relay design (concrete)

APP Postgres + the existing `nats:2.10-alpine --jetstream` service only (ADR-004/006/008). **No migration** — the
slice-2 `outbox` table already has `seq/status/attempts/published_at` + the `outbox_unpublished_idx` partial index;
slice-3 adds only sqlc queries on existing columns.

**Streams** (ensured idempotently on relay boot via `CreateOrUpdateStream`):

| Stream | Subjects | Retention | DuplicateWindow | Consumer (slice-3) |
|---|---|---|---|---|
| `ORDERS` | `order.>` | Limits | ~2m | none yet (notification consumers, email-first ADR-013, later) |
| `ASSET_JOBS` | `asset_job.>` | WorkQueue | ~2m | none yet (the Rust GPU worker's durable pull consumer — worker phase) |

> The relay provisions the `WorkQueue` stream to **support** the worker but does not create the consumer. The
> consumer-side knobs — long `AckWait` exceeding the worst-case off-peak Blender render, `InProgress` heartbeat,
> `MaxAckPending=1` (concurrency=1), `MaxDeliver`→**DLQ** — are the worker's (`conventions §Queue`, ADR-007), as is
> the DLQ stream. The relay's only "ack" is the JetStream **PubAck** it awaits before marking a row published.

**Subjects & dedup.** Subject = literal `outbox.event_type` (no lookup). `Nats-Msg-Id = outbox.id` (uuid) on every
`PublishMsg` → JetStream server-side dedup within each stream's duplicate window. Payload is forwarded
**byte-for-byte** (the `assetJobCreatedPayload` camelCase JSON the future worker parses — any reshape silently breaks
it). The `dedup_key` UNIQUE guards only the **write** side (a double-insert in a domain tx), never the publish side.
Beyond the duplicate window, delivery is at-least-once and absorbed by **consumer idempotency** (jobs reconstructable
from `sourceModelUrl`+`sourceVersion`, ADR-006; future `order.*` notification consumers must dedup by event id
before they ship — a flagged risk).

**Drain loop (per tick, poll interval ~1s):**
```
rows := SelectPendingOutbox(ctx, batchSize)          -- WHERE status='pending' ORDER BY seq, via outbox_unpublished_idx
for each row in seq order:
    ack, err := js.PublishMsg(ctx, subject=row.event_type, Nats-Msg-Id=row.id, data=row.payload)
    if err is a CONNECTION/transient failure:  break        -- leave pending, do NOT burn attempts, back off
    if err is a per-message PubAck REJECTION:
        IncrementOutboxAttempts(row.id)
        if attempts >= RelayMaxAttempts: MarkOutboxFailed(row.id)   -- poison quarantine (Admin view, deferred)
        continue                                            -- head-of-line: a poison row never blocks later rows
    MarkOutboxPublished(row.id)                             -- ONLY after PubAck
```

**New sqlc queries** (`db/queries/outbox.sql`, regenerated + committed): `SelectPendingOutbox`,
`MarkOutboxPublished`, `IncrementOutboxAttempts`, `MarkOutboxFailed`. Today `outbox.sql` has only `InsertOutbox`.

**Crash-recovery (publish-on-commit ⇒ nothing is lost).** Every event is a durable `pending` row, so a relay crash
loses nothing: on restart it re-scans `WHERE status='pending' ORDER BY seq` and resumes. A crash **after** PubAck but
**before** `MarkOutboxPublished` leaves the row `pending` → it republishes → collapsed by `Nats-Msg-Id` dedup
(within window) or consumer idempotency (beyond). NATS down → rows accumulate `pending` and drain on recovery
(accept-downtime, ADR-009). The relay is strictly a reader of **committed** rows — never on the domain write path
(`EnqueueOutbox`'s `pgx.Tx`-first-arg seam stays the sole writer; the relay must not be folded into it).

**Lifecycle (`main.go`):** `config.Load → db.Open(pool) → nats.Connect → ensureTopology → start relay goroutine →
http.Server` ; on signal: stop relay (ctx-cancel + join) → `srv.Shutdown` → `nats.Close/drain` → `pool.Close()` (the
relay releases its DB + NATS handles before the pool closes). A `recover()` wrapper keeps a relay panic off the HTTP
server. **No advisory lock / leader election** (ADR-009). One dedicated relay path shares the modest `DBMaxConns=8`
pool — keep batch small + the poll interval modest so polling can't starve HTTP handlers (the box also feeds Blender).

## 5. Gates · tests · CI

- **`make verify-go` stays green:** new outbox + by-id + aggregate sqlc queries + the `000008`/`000009`/`000010`
  migrations must pass `sqlc vet` + `sqlc diff` (generated code committed); `gofmt`/`go vet`/`golangci-lint v2 0`/`go
  test -race`. OpenAPI codegen (`oapi-codegen`) + a stale-check wire into the verify lane; the TS client + parity test
  wire into the TS verify lane. **Generated `*.gen.go` is path-excluded in `.golangci.yml exclusions.rules`** (NOT
  linters disabled globally — oapi-codegen output trips golangci-lint v2's 0-issue gate; mirrors `core-data-layer.md §3`).
- **Acceptance ledger / EARS-per-feature (`conventions §Scope&PR`, ADR-027 — §6 D13):** each invariant-bearing PR
  appends its EARS rows to `docs/acceptance.md` in the SAME diff — `3b`→`REL-01/02`, `3e`→`RBA-01`, `3g`→`CHK-04/05`,
  `3h`→`PAY-01/SHP-01`, `3k`→`STK-01` — starting unchecked `[ ]`, ticked only when the linked test passes. Without
  this, `spec-guardian` WARNs (a diff touches order-state/money/checkout with no `spec.md`/`acceptance.md` change) and
  the EARS-lint trips. The still-open Phase-0 ARM item `acceptance.ledger.test` (`docs/plan.md`) lands in `3c-2` (the
  `packages/core` parser that fails a `[x]` row whose test id doesn't resolve/pass); the Go-side relay/RBAC EARS stay
  gated by `guard.test.sh §ARM-GUARD` + their Go tests (cross-language id resolution is out of the parser's scope).
- **ARM (the gate-no-op-looks-like-pass invariant):** the moment the relay lands, ARM into `guard.test.sh
  §ARM-GUARD` — NATS reachability in `/readyz`, the **scan-the-pending-SET** rule (lock it so a `seq>cursor`
  optimization can't regress), the **reconcile→ConfirmPaymentTx** footgun dispatch, and **RBAC-at-HTTP**. Mirror the
  existing `sqlc vet`/testcontainers real-checks.
- **Test strategy:** relay invariants via testcontainers Postgres **+ NATS** — the named late-committing-low-seq
  regression, crash-after-PubAck-before-mark, NATS-down accumulation, poison quarantine. HTTP: error-envelope +
  mapping, RBAC boundary (layered on OSM-04/05), the transition dispatch-footgun (exactly one `order.paid`). Property
  tests on totals (`sum(parts)==total`). Parity test (4-way enum equality).
- **CI NATS lane (carried open from `core-data-layer.md §5`):** testcontainers covers Postgres; the relay needs a
  live JetStream → add a testcontainers-NATS module (or compose-ephemeral) to the `harness.yml services-gates` lane,
  else the relay tests skip-and-look-green and the ARM gate becomes a no-op (§6 D7-adjacent).

## 6. Decisions to confirm before the first PR

Recommendations in **bold**. The first three are the **likely new ADRs** the task flagged.

- **D1 — Relay topology & delivery semantics (NEW `ADR-029`).** No relay/JetStream ADR exists. **Recommend:**
  in-process goroutine; scan the pending SET `ORDER BY seq` (never a watermark, never SKIP LOCKED); `publish →
  PubAck → mark`; `Nats-Msg-Id = outbox.id`; literal `event_type` subject; provision `ORDERS`+`ASSET_JOBS` streams
  only (worker owns its consumer); transient-vs-poison failure policy; panic-recovery; **no advisory lock**; single
  instance (ADR-009). Reconcile the worker subject via the `asset_job.>` wildcard (don't touch the worker default).
- **D2 — Auth/session model (NEW `ADR-030`) — RESOLVED (user 2026-06-26): self-issued JWT.** ADR-003 names
  `go-chi/jwtauth` but pinned no mechanism; `users` had no password column. **Decision (user chose self-managed over
  Cloudflare Access — no dependency on CF-Access config):** core-api owns login — `POST /auth/login` (email+password)
  → `bcrypt` (x/crypto, promoted indirect→direct) → signed JWT (`go-chi/jwtauth`, *consistent with* ADR-003) in an
  **httpOnly+Secure cookie**; `users` gains `password_hash` (migration `000009_user_credentials`); a JWT-verify
  middleware maps `sub`→`users`→`order.Role` and injects `{ByUser=users.id, Role}`. Split into **3e-1** (login + JWT
  issue + credential migration + owner-seed) / **3e-2** (verify mw + RBAC + optional-auth). Storefront-customer auth +
  the Pet Tag `Account` are OUT of scope. **Inbox-create gate (BLOCKER, folds into this ADR):** `POST /orders` runs
  behind the optional-auth middleware; `channel=inbox` requires a resolved staff/owner actor, `channel=web` stays open.
  **Guest `ByUser`:** the public web-create genesis writes the sentinel `ByUser="customer"`. **Sub-decisions to finalize
  in 3e-1/3e-2:** owner-seed (migration bootstrap-hash vs `make seed-owner` CLI), token TTL/refresh, JWT secret via env,
  the thin admin login UI (apps/admin). **Open (non-blocking):** the MV3 extension auth handshake (service vs long-lived token).
- **D3 — OpenAPI workflow (NEW `ADR-031`).** No spec / no `packages/api-client` exists; `packages/core` Zod is the
  de-facto contract. **Recommend:** hand-author one `services/core-api/openapi.yaml` as the single source of truth →
  `oapi-codegen` (Go) + `openapi-typescript`/`openapi-fetch` (`packages/api-client`); a **4-way enum parity test**
  prevents a second drifting source; codegen runs in verify/CI; resolve Review `text`→`body` (+ `spec.md §02`).
- **D4 — HTTP error envelope (candidate `ADR-032`).** Today: only `writeJSON` + an ad-hoc `{"error":"internal"}`.
  **Recommend** recording the `{code, messageKey, fields?}` envelope + the explicit code→status table (§3d) as a
  standalone decision rather than improvising per-handler, since all three TS clients consume it identically.
- **D5 — `POST /orders` idempotency (NEW `ADR-033`) — RESOLVED (user 2026-06-26): DEFERRED.** The order id is
  app-generated per request, so a retried POST mints a **duplicate order + duplicate `order.created`** — a real money-
  path gap. **Decision (user chose to defer):** slice-3 ships **no** `Idempotency-Key`/dedupe table; the dup risk is
  accepted until a later slice (revisit when the storefront-checkout surface that produces real retries lands). **No
  `000009_idempotency_keys` migration** — that number is taken by `3e-1`'s `000009_user_credentials`. **Still in
  slice-3 (independent of idempotency):** the `#LMN-xxxx` Postgres sequence (3f, migration `000008`) + the payment-proof
  host-trust boundary (3g). **"end-to-end" caveat (unchanged):** `POST /orders` (web) **accepts** a pre-validated
  `paymentProofUrl` but the presigned-PUT endpoint that **mints** it is deferred with the storefront-checkout surface
  (ADR-005), so the full browser→upload→order flow is not exercised this slice (§0, §7).
- **D6 — Go `formatVnd` (likely NOT needed).** As scoped, money crosses the wire as int-VND JSON, email is Phase 5,
  the OG card is Phase-1 storefront TS; the static VietQR render is deferred with the storefront checkout-display
  surface **and is amount-less** (conventions §57 — "nội dung/memo CK không bắt buộc"), so it bears on the formatter
  decision neither way. **Recommend: defer the Go formatter.** Reopen **only** if a slice-3 endpoint server-renders
  money to **text** (e.g. an order-confirmation email off `order.created`) — then build the single Go `formatVnd`
  mirroring ADR-019 and wire the deferred ADR-027 REC-M/REC-E money mutation/property gates.
- **D7 — SSE + worker-callback scope — RESOLVED (user 2026-06-26): defer both.** SSE + the worker-callback move to a
  follow-on slice; slice-3 ships the short-poll status fallback (ADR-008) for print-queue/AssetJob progress (admin has
  few users). **The CI NATS lane (testcontainers-nats or compose-ephemeral) lands WITH `3a`/`3b`** so the relay
  invariants actually run — else the ARM gate is a no-op (§5).
- **D8 — `oapi-codegen` mode — RESOLVED (user 2026-06-26): `strict-server`.** Compile-time handler↔contract conformance
  via a generated server interface (folds into ADR-031). Generated code is committed + line-budget-excluded +
  `.golangci.yml`-path-excluded.
- **D9/D10/D11 — minor, fold into the owning PR.** D9 order code = a dedicated Postgres **sequence** formatted
  `#LMN-xxxx` (3f), via **migration `000008_order_code_seq`** + regen. D10 `shipping_rules` = a **province-keyed jsonb
  schema + fee helper**, no district (3f). D11 `print_jobs` fan-out on PAID has no transactional seam today —
  **recommend deferring the fan-out** (admin-internal, SSE deferred) and sourcing the dashboard "printing" KPI from
  `orders.status='PRINTING'`; revisit when SSE lands.
- **D12 — `tracking_code` on SHIPPING + QC photo (NEW — resolves the dangling §1 reference).** The merged
  `AdvanceStatusTx` takes **no** `tracking_code` (`internal/db/orders.go:273`), but spec §04 requires *ảnh QC + mã vận
  chuyển* on `PRINTING→SHIPPING`. **Recommend:** the 3h SHIPPING handler validates a non-empty `trackingCode` (spec
  §04) and runs a narrow `SetTrackingCode` query in the **same tx** as `AdvanceStatusTx` (column exists since `000005`
  → **no migration, no seam churn**). **Defer the QC packing-photo gate** (`docs/plan.md`) — no `qc_photo` column / no
  upload surface — with the presigned-upload deferral.
- **D13 — acceptance ledger / EARS-per-feature (NEW — resolves the spec-guardian/EARS-lint exposure).** Each
  invariant-bearing PR appends EARS rows to `docs/acceptance.md` in-diff (`3b`/`3e`/`3g`/`3h`/`3k` → `REL-01/02`,
  `RBA-01`, `CHK-04/05`, `PAY-01/SHP-01`, `STK-01`), unchecked `[ ]` until their test passes. **Recommend landing the
  Phase-0 `acceptance.ledger.test.ts` parser in `3c-2`** (closes the long-open `docs/plan.md` ARM item) — a `[x]` row
  with an unresolved/failing test id fails the suite; Go relay/RBAC EARS stay gated by `guard.test.sh §ARM-GUARD`.

## 7. Done (this slice)

All 13 sub-PRs merged: `make verify-go` green with the relay + OpenAPI codegen + parity test armed; `guard.test.sh
§ARM-GUARD` asserts the relay scan-pending-SET rule, NATS readiness, the reconcile→`ConfirmPaymentTx` footgun, and
RBAC-at-HTTP (gates can't no-op); the new HTTP-boundary EARS rows (`REL-01/02`, `CHK-04/05`, `RBA-01`, `PAY-01`,
`SHP-01`, `STK-01`) are appended to `docs/acceptance.md` by their owning PRs and tick `[x]` as their tests pass, and
the Phase-0 `acceptance.ledger.test` ARM item is closed in `3c-2` (§6 D13). The outbox→NATS relay drains `order.created`
+ `order.paid` (live emitters this slice: `POST /orders` + reconcile) publish-on-commit, idempotently, surviving
NATS-down + crash without loss or spurious quarantine; the `asset_job.created` path is provisioned + proven by tests
via the `CreateAssetJobTx` seam but has **no slice-3 producer** (the catalog model-upload handler is deferred with the
presigned-upload surface). `POST /orders` (web→PENDING_CONFIRM given a validated proof URL; inbox→PAID,
**staff/owner-gated**) + the RBAC-gated transition endpoint (incl. `tracking_code` on SHIPPING) work through the
existing seams (reconcile emits `order.paid` exactly once); the presigned upload that *mints* the proof URL is
deferred, so a full browser→upload→order flow is not exercised this slice. Self-issued JWT (email+password login →
httpOnly cookie) + owner/staff RBAC gate the admin surface incl. the owner-only settings/STK (`UpdateBankAccountTx`) endpoint. The OpenAPI contract drives
`oapi-codegen` (Go) + `@lumin/api-client` (TS), parity-tested byte-identical to `internal/order` + `packages/core` +
PG. `apps/admin` renders the real dashboard aggregates (net revenue per spec §04, zero-state safe) via the generated
client. **Deferred to a follow-on slice:** SSE progress + the worker-callback endpoint + the presigned upload endpoint
(+ the catalog model-upload handler / storefront catalog DTOs) + storefront-customer auth + guest order-lookup +
`print_jobs` fan-out + the QC packing-photo gate + the static VietQR image render + the full shipping engine + a Go
money formatter.
