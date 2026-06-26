# Plan — Core · Data model + OrderStatus (Go core-api)

> Phase after Phase 0 (`plan.md` §"Core · Data model + OrderStatus" — the spine, *làm sớm*).
> Sources of truth: `spec.md` §02 (data model) / §04 (state machine) · `conventions.md` §Tiền/§statusHistory ·
> `decisions.md` ADR-003/004/006/010/012/017/019/020 · reference impl `packages/core` (TS).
> Branch: `feat/core-data-model` off `main` (`ab99360`).

## Why split (conventions §Scope&PR — 1 PR = 1 trục, <~400 dòng)

`core-api` is the authoritative server (ADR-003): it **re-implements** the spine in Go; `packages/core` (TS)
is the reference the frontends share; OpenAPI is the Go↔TS contract. The phase splits into sequential PRs:

- **Slice 1 (THIS PR) — pure-Go domain spine, no DB.** OrderStatus state machine + money. Mirrors how
  `packages/core` landed (pure domain first), testable without Postgres, fast/deterministic CI. `.go→verify-go`
  ARM gate already covers it.
- **Slice 2 — data layer.** sqlc models per `spec.md` §02 (Product/Color/Option/Order/OrderItem/PrintJob/
  AssetJob/Review/Customer/User/ReplyTemplate/Setting) + **outbox** table + migrations + pgx pool. Arms
  `sqlc vet` + testcontainers (ADR-020). Address = province→ward→street (ADR-017); `channel` enum + `zalo`
  watch; consent record on Customer.
- **Slice 3 — HTTP wiring.** `POST /orders` (channel entry: web→PENDING_CONFIRM w/ proof, inbox→PAID),
  transition endpoints, RBAC middleware (owner/staff), outbox publish-on-commit. Replaces
  `apps/admin/src/lib/demo-dashboard.ts` placeholder with real aggregates.

## Slice 1 — scope (this PR)

Two pure packages under `services/core-api/internal/`, ported from `packages/core`:

### `internal/order` — OrderStatus state machine (`order-state.ts` → Go)
- Enum `Status` (7) + `Statuses` + terminal set; `Role` (owner/staff/system); `Channel` (web/inbox).
- `allowedEdges` (single-line, mutation-gate-ready) + owner-only edges (ADR-010) + reason-required set.
- `IsAllowedEdge` · `IsOwnerOnly` · `RoleAllowed` · `CanTransition`.
- `InitialStatusForChannel` (web needs proof → PENDING_CONFIRM; inbox → PAID).
- `Transition(o, to, ctx)` → validates edge + RBAC + actor + ISO-UTC timestamp + reason/refund-proof, then
  **appends exactly one** `StatusEvent`; returns a NEW order (no mutation). `TransitionError{code,msg}`.
- `ReplayStatus(history)` → asserts contiguous + every hop a valid edge.

### `internal/money` — server-authoritative totals (`money.ts` server half → Go)
- `CalcTotals(TotalsInput) → Totals` — `TotalsInput` has **no** total field (never trusts client; ADR-019).
- int64 VND (the type gives integer-ness for free); reject negative amounts + non-positive quantity.
- Display `formatVnd` deferred to server-rendered surfaces (email/OG) — keep this file to the calc invariant.

### Tests (the gate that makes it real)
- `status_test.go` — full P0 battery mapped to acceptance ids: **OSM-01** transition table (every from×to;
  reject backward/skip/terminal-escape) · **OSM-02** appends exactly one history record + input immutable ·
  **OSM-03** CANCELLED/REFUNDED require reason, REFUNDED requires refundProofUrl · **OSM-04** staff
  reconcile→PAID rejected (owner-only) · **OSM-05** RBAC matrix (every edge×role) · channel entry · replay ·
  timestamp/actor validation.
- `money_test.go` — **MNY-01** sum(parts)==total · **MNY-02** total computed from parts (client total
  unrepresentable by type) · validation (negative/zero/empty).
- Property tests via stdlib **`testing/quick`** (ADR-027 REC-E, no new dep): money `sum(parts)==total` over
  random bounded inputs; replay of a random valid walk == final status.

**Out of scope (later slices):** any DB/sqlc/migration/outbox; HTTP endpoints; `formatVnd` in Go; OpenAPI;
auth/jwtauth; a Go mutation kill-gate mirroring `osm-mutation.test.sh` (anchors `#EDGES/#SUBTOTAL/...` left in
place so a follow-up can wire it).

## Done (this slice)
`make verify-go` green (gofmt + vet + golangci-lint v2 + `go test -race`); spec-guardian PASS; the OSM/MNY
invariants enforced **server-side in Go** with a binding test battery + property tests. No DB touched.

## Gates armed / ledger
- `.go→verify-go` ARM-GUARD: already armed (Phase-0 backbone). New packages ride the existing `go test ./...`.
- acceptance.md: existing OSM-*/MNY-* ids resolve to `packages/core` (TS) tests; Go tests named to mirror
  them for parity. New EARS cluster for the server layer = follow-up once `acceptance.ledger.test.ts` exists
  (don't pollute TS-resolvable ids now).
