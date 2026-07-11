# Active context — focus đang chạy

> **File "đang ở đâu"** (volatile, đổi liên tục). `session-start` echo ~3000 byte đầu khi mở phiên ·
> `pre-compact` ghim làm "plan sống" · `verify-before-stop` nhắc cập nhật khi đổi >1 file source. Giữ phần
> load-bearing (Focus · Next · Ledger) **gần đầu file**. Đây **không** phải nguồn chân lý — chỉ scratchpad phối
> hợp; muốn binding phải thành ADR/luật (`agent-harness.md` §Ranh giới promote memory).

## Focus
**➡️ P3-i LANDED as PR #71** (rebased onto `main` after #70 P3-h + #72 token-fix merged; vi.ts/acceptance/active-context conflicts resolved). **Core Done-gate Track 0/A/B/C COMPLETE** — login → dashboard → orders → detail/transition → print board → settings. Next = **D (products) / E (reviews) / F (greenfield)**. Full P3-i + P3-h build notes as history below.

**— P3-h history (MERGED #70 → `main` `d2d2f1b`) —**
**🔨 PHASE 3 · P3-h (FE `/hang-doi-in` kanban kéo-thả + SSE live — print board) — BUILT + VERIFIED on `feat/phase-3-admin-p3h-print-board`**
(off `main` `9241ad0` after P3-g #69 merged + local main ff'd). **FE-only** (Track B end, `dependsOn: P3-f, P3-g`) — the operator screen that consumes the
P3-f read/PATCH + P3-g SSE. **4 columns = the 4 `PrintStage`s** (Cần in/Đang in/Đóng gói/Đã gửi); RSC fetches the board once (cookie-forward, `no-store`),
the client `<PrintBoard>` keeps it live. **KEY DESIGN — SSE reaches core-api via a same-origin proxy, NOT a direct cross-origin EventSource:** `CORE_API_URL`
is server-only (never `NEXT_PUBLIC`) + the `lumin_session` cookie is httpOnly on the admin host, so the browser CANNOT open an EventSource straight at
core-api. New route handler `app/api/print-stream/route.ts` (Node runtime, `force-dynamic`) reads the cookie server-side and pipes core-api's
`/admin/print-queue/stream` back **byte-for-byte** (returns `upstream.body` ReadableStream — no buffering; `request.signal` forwarded so a browser disconnect
tears down the upstream → core-api `ctx.Done`). This is the concrete meaning of P3-g's "EventSource same-origin" comment. GET (initial board) + PATCH (drag)
stay **Server Actions** (server-side, cookie-forward) — only the ONE streaming endpoint needs the proxy. **Drag = @dnd-kit** (`@dnd-kit/core@6.3.1`, 1 new
dep, D-P3-8) — MouseSensor 8px + TouchSensor hold-200ms (so a mobile swipe still scrolls; no `touch-action:none` trap); **only `listeners` spread, NOT
`attributes`** → the card stays a plain container and the accessible control is the per-card **"Chuyển sang {stage}" button** (keyboard/AT/mobile path,
D-P3-2 — avoids nesting a real button inside a role=button). **STAGE-ONLY (D6):** both drag + button `PATCH /admin/print-jobs/{id}` move **only print_jobs.stage**,
they do **NOT** transition OrderStatus — the design's "kéo → tự đổi trạng thái khách" is intentionally decoupled (order status goes through the P3-e transition
flow with the QC/tracking gate a board drag must never bypass); dropped the design's "ĐẶT TRẠNG THÁI KHÁCH" legend as factually wrong for our contract.
**Optimistic:** card moves immediately → reconciles to the server card (`mergeCard`, idempotent with the SSE broadcast of the same PATCH) → reverts just that
card's stage on failure + `advanceError`. **Fallback poll** (`use-print-stream`): re-GET every 15s **only while SSE is down** (BLOCKER-B / open-q #4 — degrades
to effectively poll-only if the tunnel buffers SSE; visibility-paused; also the only path that surfaces newly-created jobs SSE doesn't emit). **Did NOT port
`use-order-poll`** (plan §5 "reuse") — it's storefront-coupled + single-order-until-terminal semantics; the board fallback is a whole-list refresh, ~12 lines,
not a new poller. **reduced-motion** → drop-animation off. **Filament "thiếu nhựa" badge DEFERRED to P3-s** (no DTO field — render no warning we can't
substantiate, not a fake placeholder). empty/loading/error all present. **Files: 11** (`print-queue.ts` pure adapters `groupByStage`/`nextStage`/`mergeCard` +
`print-queue.test.ts` 4 tests · `print-queue-fetch.ts` RSC GET · `print-queue-actions.ts` advance+refetch Server Actions · `api/print-stream/route.ts` SSE
proxy · `use-print-stream.ts` EventSource+poll · `print-board.tsx` dnd-kit board · `hang-doi-in/{page,loading}.tsx` · `messages/vi.ts` +`printQueue.*` ·
`package.json` +@dnd-kit/core). **Verify:** `pnpm verify` **6/6** (lint · typecheck · admin **48** tests incl print-queue **4** + messages still green ·
prettier) · `next build` ✓ (`/hang-doi-in` ƒ 17.6kB/149kB [dnd-kit] · `/api/print-stream` ƒ 127B) · core `acceptance.ledger` **63** (new `[ ]` `ADM-10`,
Cụm 33 FE). **No BE/contract/codegen/migration change** (P3-f/g already landed) · **1 new dep** (@dnd-kit/core) · **no new ADR** (ADR-008/009 + D6 cover it).
**⚠️ BLOCKER-B STILL A MANUAL GATE** — SSE through the named cloudflared tunnel (incl. this new Next-proxy leg) must be smoke-tested (buffer / 100s / 524)
before relying on live push; the poll fallback ships regardless so the board is correct either way. **NEXT: adversarial self-check + spec-guardian → commit → user gate.** After P3-h, Track B (print board) is complete; core Done-gate = Track 0/A/B/C → remaining lõi is C (P3-i settings).
**— P3-i history (PR #71 → `main`) —**
**🔨 PHASE 3 · P3-i (`/cai-dat` settings — STK/shipping/refund edit + reply-template CRUD — Track C, core Done-gate) — BUILT + VERIFIED on `feat/phase-3-admin-p3i-settings`**
(off `main` `9241ad0`; P3-i `dependsOn: —`, **independent of P3-h** which is committed-but-unmerged on `feat/phase-3-admin-p3h-print-board` @ `7d33058`). **FE+BE in ONE PR** (plan lists P3-i as one FE+BE sub-PR). **Track C = the LAST core Done-gate piece** (Track 0/A/B/C). **BE — 5 new owner-only writes:** `PATCH /admin/settings/shipping-rules` + `.../refund-policy` + `POST`/`PATCH`/`DELETE /admin/reply-templates[/{id}]` — all classify→`authOwnerOnly` **+** `assertOwner` re-assert in-handler (staff→403 / no-actor→401 **before any DB touch**; domain-core "staff không sửa cài đặt"). **KEY DESIGN — shipping_rules persists as `[]pricing.ShippingRule`** (the EXACT type `pricing.ShippingFee` reads at checkout; tested round-trip THROUGH the resolver, unit + real-PG) so a fee edit can never write a shape checkout can't parse; validate province non-empty/unique + fee ≥ 0 → **400** field-map **before write**; empty table allowed. **refund_policy** = trimmed text (empty ok; cap 5000 runes). **reply-template** CRUD: `variables` **derived server-side** from body `{token}`s (regex, unique+first-seen — no client trust → no drift), title/body required+capped, unknown id → **404** (`:one` no-row / `:execrows`=0 → `db.ErrNotFound`). **NO audit** for shipping/refund (open-q #2 — only STK money-out-audited; `UpdateBankAccountTx` UNTOUCHED). **Targeted single-col queries** (not the 3-col `UpdateSettings`) → no clobber. **`Settings.shippingRules` openapi TIGHTENED** to typed `ShippingRule[]` (safe — no existing DTO consumer; checkout reads raw jsonb bytes not the DTO). **FE — 2 routes (design screens 13 + 9):** `/cai-dat` = STK form (→ `PATCH bank-account`) **+ "chưa cấu hình STK ⇒ chặn checkout" warning** (`isStkConfigured` MIRRORS checkout's `stkFromSettings` gate = bin+accountNumber → warning truthful; accountName save-required but not the payment gate) + shipping table add/edit/delete {province, fee} (`formatVnd` display, ZERO client-math) + refund textarea + "Trang con khác" card (mau-tra-loi live; Extension/Nhân viên/Kênh chat = "sắp có" placeholders). `/cai-dat/mau-tra-loi` = reply-template grid + native `<dialog>` add/edit (title+body + live `{...}` var preview) + inline delete-confirm (no blocking `window.confirm`). **All writes = Server Actions (cookie-forward, failures→small view codes, NO envelope leak). FE role hardcoded owner** (`ponytail:` no `/auth/me`/staff till P3-q; BE `authOwnerOnly` is the real wall — matches P3-e). empty/loading/error present; reduced-motion auto-satisfied (no animation). i18n `settings.*` (no literal `{}` — ICU-safe). **Files: 23, +2739/−29.** **Verify:** `make verify-go` ✓ (gofmt·vet·golangci **0**·sqlc·oapi staged·`go test -race` incl real-PG shipping-persist→resolver + reply-CRUD + `TestSettingsWritesAreOwnerOnly`; db 48s/httpapi 42s w/ `TESTCONTAINERS_RYUK_DISABLED=true`) · `pnpm verify` **6/6** (admin **49** incl settings **5** · schema.stale · prettier) · `next build` ✓ (`/cai-dat` ƒ 2.72kB/147kB · `/cai-dat/mau-tra-loi` ƒ 2.38kB/143kB) · core `acceptance.ledger` **64** (new `[ ]` `ADM-11`/`ADM-12`, **Cụm 34**; skips 33 = P3-h monotonic). **No new dep · no new ADR · no migration** (000007 already had shipping_rules/refund_policy cols) · additive openapi + regen staged. **2 latent-token findings (PRE-EXISTING in P3-e, flagged NOT fixed — out of scope):** `bg-surface` (order-detail-view) + `backdrop:bg-cocoa-900/40` (transition-dialog) are no-op classes (bare `surface`/`cocoa` NOT in luminPreset) → dialog backdrop never dims; P3-i uses valid `bg-surface-card` + `backdrop:bg-black/40`. **✅ Reviews DONE:** spec-guardian **PASS** (0 BLK/0 WARN/2 NOTE — FE-owner-assumption ponytail + settings-audit-scope, both intended); adversarial (oracle) **0 correctness bugs** (7 vectors REFUTED — shipping-shape↔resolver parity, owner-only-before-DB, 404-not-silent, XSS-inert-text-nodes, regex edge-cases, no-envelope-leak, STK-warning-parity; vector-8 stale-form-state = benign single-owner last-write-wins, no action). **✅ Committed `9e38c9f`.** **✅ Browser smoke-test PASSED** (full local stack — PG :5433 + core-api :8090 + admin :3001, owner login): `/cai-dat` renders STK/shipping/refund + sub-page links; shipping edit→"Lưu phí ship"→**persisted `27000`/`30000` to DB** + "Đã lưu 🧡"; `/cai-dat/mau-tra-loi` empty→`<dialog>` create (dimmed backdrop) → live `{phí}`/`{STK}` preview → save → grid card with **server-derived** variable tags (FE sent title+body only) → POST 201. **NEXT = user gate: push + PR to main.** **After P3-i, Track 0/A/B/C (core Done-gate) is COMPLETE**; remaining = D (products) / E (reviews) / F (greenfield).

**— P3-g history (MERGED #69 → `main` `9241ad0`) —**
**🔨 PHASE 3 · P3-g (BE SSE `GET /admin/print-queue/stream` — live print board) — BUILT + VERIFIED on `feat/phase-3-admin-p3g-print-stream`**
(off `main` `fddfe40` after P3-f #68 merged + local main ff'd). **BE-only** (Track B, `dependsOn: P3-f`) — the live push behind the P3-h kanban so a
drag on one board reflects on every open board without polling. **KEY DESIGN — in-process hub, NOT NATS (ponytail + ADR-009):** core-api is
single-instance, so the PATCH that moves a card and every SSE subscriber are the same process → a mutex-guarded in-process `printStreamHub`
(subscribe/broadcast/unsubscribe) suffices and is correct. ADR-008 only forbids **exposing NATS to the browser**; it does NOT mandate NATS as the
internal source. Print-stage sync is ephemeral + re-derivable (client re-GETs on reconnect) → **no outbox, no NATS publish, no durability** (event-outbox
skill N/A). `ponytail:` if core-api ever scales horizontally, back the hub with a NATS-subscribe (SSE transport to browser unchanged). **RAW chi route,
NOT OpenAPI:** the oapi strict layer buffers the whole response → cannot stream; `/healthz`+`/readyz` are already raw routes outside the contract
(precedent) → **no openapi/codegen change**. Auth is **manual in-handler** via the same `resolveActor` (owner AND staff — same gate as GET
/admin/print-queue; EventSource sends `lumin_session` same-origin; no-cookie → 401 before any stream byte). **ROUTER restructure (the crux):**
`middleware.Timeout(30s)` moved from global `r.Use` into a **Group wrapping the OpenAPI routes**, so the SSE route escapes the 30s cooperative
context-cancel; there is **no global WriteTimeout** either (main.go left it unset **deliberately** — "SSE routes need per-route handling"). **SSE
hardening (ADR-008 / conventions §Realtime):** `text/event-stream` + `no-transform` + `Content-Encoding: identity` + `X-Accel-Buffering: no` +
`http.Flusher` per frame + **heartbeat `: ping` every 25s** (< Cloudflare 100s idle cap) + opening `: ok` comment; `event: stage` + one-line JSON `data:`
per advanced card; `r.Context().Done()` (clean, since outside Timeout) → unsubscribe. **Broadcast** wired into `AdvancePrintJobStage` **post-commit**
(best-effort · non-blocking · drop-on-full → self-heals via client GET/poll · nil-safe). **Files: 8** (`print_stream.go` hub+handler+writeSSEEvent NEW ·
`server.go` +printHub field/init · `admin_print_queue.go` +broadcast · `router.go` Group+raw-route · `middleware_auth_test.go` +printHub in
`serverWithUsers` · `print_stream_test.go` NEW [hub fan-out · never-blocks · nil-safe · auth-401 · SSE-headers · writeSSEEvent] · integration
+broadcast-on-PATCH assert · acceptance **Cụm 32 `ADM-09`**). **Verify:** `make verify-go` ✓ (gofmt · vet · golangci **0** · sqlc vet/diff · **oapi
stale-check clean — no codegen** · `go test -race ./...` all ok incl real-PG broadcast-on-PATCH; httpapi 43s/db 54s w/ `TESTCONTAINERS_RYUK_DISABLED=true`)
· core `acceptance.ledger` **62** green (new `[ ]` `ADM-09`) · `pnpm verify` **N/A** (zero TS/openapi/packages touched). **No new dep · no new ADR**
(ADR-008 + ADR-009 cover it) **· no migration · no contract-break.** **⚠️ BLOCKER-B STILL OPEN — named-tunnel smoke-test is a MANUAL gate** (can't run
cloudflared here): SSE through the home-box tunnel must be smoke-tested (buffer / 100s / 524) before P3-h ships; if flaky → **poll-only v1** (open-q #4,
ADR-008 allows; fallback `use-order-poll` P1-o already exists). **NEXT after P3-g land = P3-h** (FE `/hang-doi-in` kanban @dnd-kit + consume this SSE +
fallback poll). **Adversarial self-check + spec-guardian → then commit → user gate.**

**— P3-f history (MERGED #68 → `main` `fddfe40`) —**
**🔨 PHASE 3 · P3-f (BE `GET /admin/print-queue` + `PATCH /admin/print-jobs/{id}` — print board list + stage advance) — BUILT + VERIFIED on `feat/phase-3-admin-p3f-print-queue`**
(off `main` `0e307f4` after P3-e #67 merged + local main ff'd). **BE-only** (Track B start, `dependsOn: —`) — the read + mutate behind the P3-h
kanban. **Reuse-heavy (ponytail):** the bare print-job seams (`db.Jobs.PrintJobsByStage`/`AdvancePrintStage`, migration 000006) already existed but
return **ids only** (useless at the printer); the plan's "DTO (job→order→product)" needed a join → **2 new enriched read queries** `ListPrintQueue`
(all stages) + `GetPrintQueueEntry` (by id, for the PATCH response) — join `print_jobs → order_items → orders.code + products.name + quantity`,
`colorName` from denormalized `print_jobs.color_name` (spec §02, no colors join), ordered stage→created_at (FIFO per column). **Write REUSES existing
`AdvancePrintStage` verbatim** (no new update query). **Endpoints:** `GetPrintQueue` (flat enriched card list, client groups into 4 kanban columns) +
`AdvancePrintJobStage` (validate stage ∈ `printStages` → 400 before write [oapi bỏ enum-check] · reuse `AdvancePrintStage` [ErrNotFound→404] · re-read
enriched → 200, same card shape as list). **Both `authRequired`** (classify default — owner AND staff; print board = fulfillment work, NOT money-out —
no classify change, just pinned in the test table). **KEY DESIGN (D6):** the PATCH moves **ONLY `print_jobs.stage`, NOT the customer's OrderStatus** —
the design HTML shows "drag card → order status auto-syncs" but backbone D6 (migration 000006 + `AdvancePrintStage` comment, user-confirmed) decoupled
them, AND coupling would **bypass P3-e's →SHIPPING trackingCode+QC-photo gate** + violate owner-only PAID → stage-only is correct, not lazy. OrderStatus
sync stays in `POST /orders/{id}/transitions` (P3-e). **DTO** = `PrintQueueJob` {id·stage·orderCode·productName·quantity·colorName?·printer?·eta?} — NO
money (a print card has no amount), NO PII. **Files: 12** (jobs.sql +2 queries · jobs.go +2 methods · admin_print_queue.go handler+mappers · openapi
+3 schemas +2 paths · regen api.gen.go/schema.gen.ts staged · 2 test files · middleware_auth_test classify · acceptance Cụm 31). **Verify:** `make
verify-go` ✓ (gofmt·vet·golangci **0**·sqlc vet/diff·oapi stale staged·`go test -race` incl real-PG `TestGetPrintQueueEndToEnd` [2-card enriched +
advance→enriched + bad-stage→400 + nil-body→400 + unknown→404] + `TestGetPrintQueueEmptyIsRenderable`; db 48s/httpapi 39s w/
`TESTCONTAINERS_RYUK_DISABLED=true`) · `pnpm verify` **6/6** (schema.stale + prettier + admin 44 unchanged) · core `acceptance.ledger` **61** green w/
new `[ ]` rows. **No new dep · no new ADR · no migration · no contract-break** (additive openapi + regen). **Adversarial self-check (thin surface —
stage-only mutation, no money/order-status/auth-decision edge):** 9 vectors REFUTED (QC-gate-bypass [structurally avoided — never touches
orders.status]· RBAC [staff-allowed fulfillment correct]· bad-stage→400· unknown→404· INNER-join-airtight [order_item FK ON DELETE CASCADE → no
orphan job; product FK RESTRICT]· enum-order [Postgres orders NEED_PRINT<..<SHIPPED]· enrichment-no-leak· nil-body→400· concurrent-drag last-write-
wins-benign). Acceptance **Cụm 31 `ADM-07`/`ADM-08` (Go-gated)** both `[ ]`. **`ponytail:` ceiling in `ListPrintQueue`: SHIPPED column accretes
unbounded → add "recent N"/archive filter if it grows.** **NEXT after P3-f land = P3-g** (BE SSE `GET /admin/print-queue/stream`, ADR-008 — emit on
stage change + `no-transform`/`identity`/`X-Accel-Buffering:no`/Flusher/heartbeat + **tunnel smoke-test**; BLOCKER-B). **spec-guardian review IN-FLIGHT
→ then commit → user gate.**

**— P3-e history (MERGED #67 → `main` `0e307f4`) —**
**🔨 PHASE 3 · P3-e (admin order-detail `/don-hang/{id}` + transition UI + QC-photo gate) — BUILT + VERIFIED + REVIEWED on `feat/phase-3-admin-p3e-order-detail`**
(off `main` `d0898a0` after P3-d #66 merged + local main ff'd). **FE+BE in ONE PR** (user chose "whole P3-e") — the piece that makes the
admin order flow *operate*, not just read. **BE (QC gate, D-P3-6):** `→SHIPPING` now requires trackingCode **AND** qcPhotoUrl at the
boundary (`transition.go`, before tx) — both persist atomically with the flip via renamed **`SetShippingArtifacts`** (was `SetTrackingCode`;
sets `tracking_code`+`qc_photo_url` in one UPDATE, same tx as `AdvanceStatusTx`); **migration 000014** `orders.qc_photo_url` (nullable text,
>000013 monotonic); `qcPhotoUrl` exposed on Order DTO (raw, denormalized like `trackingCode`). qcPhotoUrl **shape-checked** via exported
`order.IsHTTPURL` (parity w/ refundProofUrl — no `javascript:` link persists; **adversarial Obs-2 FIXED**). **OrderItem DTO enriched** (was
ids-only, useless to a fulfiller): `ListOrderItems` joins **productName** (products INNER) + **colorName** (colors LEFT) + **optionLabels**
(options via jsonb `array_agg`+coalesce) → additive-optional openapi fields (safe — no existing consumer breaks; public timeline untouched).
**FE:** RSC `[id]/page.tsx` (`fetchAdminOrderDetail` cookie-forward · 404→not-found · err→`(app)/error.tsx`) + `[id]/loading.tsx` skeleton;
client `order-detail-view.tsx` (progress 5-step from statusHistory + terminal banner · items w/ names/color/options/engrave · customer PII ·
money `formatVnd` ZERO client-math · payment/refund/QC proof **links** · note) + **action bar from `canTransition(status,to,role)`** (never
offers an edge the server rejects): 1-touch confirm→PAID (owner-only) + advance; **native `<dialog>`** `transition-dialog.tsx` for ship
[tracking+QC upload] / cancel [reason radio] / refund [reason+proof upload], submit locked till fields present; upload reuses `POST
/checkout/payment-proof-upload` presigned-POST (P2-c) → Garage direct → `finalUrl` on transition; Server Actions `order-actions.ts`
(`transitionOrder` cookie-forward + `presignProofUpload`, failures→view codes, no envelope leak) + `upload-proof.ts` client util;
`orders-table.tsx` row code→`/don-hang/{id}` **Link (P3-c seam wired)**; bulk-transition stays inert. **FE role hardcoded `'owner'`** (no
staff yet=P3-q · no `/auth/me`; SERVER authoritative — `ponytail:` comment). i18n `orderDetail.*` namespace. Pure adapters `order-detail.ts`
(`progressSteps`/`availableTransitions`/`transitionKind`) unit-tested. **Files: 30, +1295/−113.** **Verify:** `make verify-go` ✓ (gofmt·vet·
golangci **0**·sqlc·oapi stale staged·`go test -race` incl real-PG `TestSetShippingArtifacts` + `TestTransitionShippingRequiresQcPhoto`
[omit/blank/**non-http**→422] + walk persist-qc + `TestToOrderDTOFullMapping`[names]; db 48s/httpapi 37s — reaper flake needs
`TESTCONTAINERS_RYUK_DISABLED=true` under agent-Docker contention, NOT a code fail) · `pnpm verify` **6/6** (admin **44** tests incl
order-detail **11** · schema.stale · prettier) · `next build` ✓ (`/don-hang/[id]` = ƒ 4.38kB/149kB). **No new dep · no new ADR.** **✅ Reviews
DONE:** spec-guardian **PASS** (0 BLK/0 WARN/0 NOTE — money·statusHistory-via-guard·QC-gate·monotonic-migration·RBAC-server-authoritative·
ADR-032-no-leak·i18n·additive-contract·a11y·anti-reward-hack·spec-sync all confirmed); adversarial **0 correctness bugs** (8 vectors REFUTED:
QC-gate-ordering·atomicity·money-in-owner-only·refund-orphan·migration+join·double-submit[server `FOR UPDATE`+edge-guard+outbox-dedup
backstop → benign 409]·upload·canTransition-projection). 2 LOW obs: **Obs-2 FIXED** (qcPhotoUrl IsHTTPURL, `javascript:`-XSS parity); **Obs-1**
orphan-Garage-on-failed-upload = **documented-accept** (`ponytail:`, harmless bytes, manual refund). Acceptance **Cụm 30 `ADM-05` (Go-gated) +
`ADM-06` (TS-gated)** both `[ ]`. **NEXT after P3-e land = P3-f** (Track B print-queue: drag-drop @dnd-kit + SSE, D-P3-2). **Commit done →
user gate: MERGE. ✅ Browser smoke-test PASSED (login→detail→confirm→PAID→advance→ship-QC-dialog→cancel-terminal, all live; statusHistory chain server-authoritative). ✅ Pushed → PR #67 open to main. **CI GREEN** (app-gates·selftest·services-gates all pass) after guard-fix `da30b5d`: the `SetTrackingCodeTx`→`SetShippingArtifactsTx` rename broke guard.test.sh's transition ARM literal-check (money-path proxy) → updated the grep token to the new seam name (invariant unchanged; 164/0). **NOTE for future renames: `tests/harness/guard.test.sh` hard-codes seam symbol names (ConfirmPaymentTx/order.RoleOwner/SetShippingArtifactsTx/…) as ARM proxies — rename a guarded symbol → update its ARM grep too (self-guard asks before the edit).**

**— P3-d history (MERGED #66 → `main` `d0898a0`) —**
**🔨 PHASE 3 · P3-d (BE `GET /admin/orders/{id}` order detail) — BUILT + VERIFIED + REVIEWED on `feat/phase-3-admin-p3d-order-detail`**
(off `main` `59b4601` after rebase; P3-b MERGED #64, **P3-c MERGED #65**. **Independent of P3-c** [FE `/don-hang` list] — disjoint
files [`services/core-api/**` vs `apps/admin/**`], plan `dependsOn: —`; rebased onto main after P3-c landed, only the 2 shared docs
[`acceptance.md`/`active-context.md`] conflicted — all code applied clean). **BE-only, READ-ONLY** — the detail read behind the P3-b
orders table. **Maximally lazy (ponytail):** the endpoint returns the **EXISTING `Order` schema** — the full internal DTO that
`assembleOrderDTO`/`toOrderDTO` (`dto.go`) already builds: customer PII (name/phone/socialHandle/email) + line items + shippingAddress
(no district, ADR-017) + `subtotal`/`shippingFee`/`total` **raw-int-VND** + `paymentProofUrl`/`refundProofUrl` + internal `note` +
`trackingCode` + **full `statusHistory`** (with `byUser`/`reason`) = **exactly** P3-d's required detail. **NO new schema · NO new SQL**
(reuse `Orders.ByID` + `Items` + `Identity.CustomerByID`) · **NO migration · NO new dep · NO new ADR · NO middleware change** (classify
**DEFAULT → `authRequired`** = owner+staff read, for free). **Files (8, +317, purely additive):** `openapi.yaml` (+33:
`/admin/orders/{id}` GET → `Order`; mirrors transition's `{id}` uuid param + list's admin-gating; 200/400/401/404) · regen
`internal/api/api.gen.go`(+116) + `packages/api-client/src/schema.gen.ts`(+45) **staged** · `admin_orders.go` (+22: `GetAdminOrder`
handler = `ByID`→`ErrNotFound`-passes-through→`assembleOrderDTO`→200; ~10 real LOC) · `admin_orders_integration_test.go` (+76:
`TestGetAdminOrderEndToEnd` real-PG — seed 2-item web order → read-by-id → assert full detail [PII · items=2 · money 510k/30k/540k ·
proofUrl set · statusHistory=born-PENDING_CONFIRM w/ `byUser`] + unknown-id→`ErrNotFound`; `getAdminOrder` helper) · `admin_orders_test.go`
(+14: `TestGetAdminOrderRequiresAuth` Docker-free — no-cookie→401, **valid-uuid path** so binding passes before the strict auth mw) ·
`middleware_auth_test.go` (+1: classify table `GetAdminOrder`→`authRequired`) · `docs/acceptance.md` (+10: **Cụm 29 `ADM-04`** Go-gated
`[ ]`; **Cụm 28/`ADM-03` = P3-c #65 ngay trên — Cụm 29 nối tiếp**). **Money** raw-int-VND passthrough, ZERO server-format (#2).
**ADR-032:** returns the **internal `Order` projection** (admin MAY see PII/money/proof/note/statusHistory-actor) — deliberately **NOT**
the public `PublicOrderTimeline` whitelist (guest-lookup only). Not-found → uniform **404 NOT_FOUND** (no existence leak). **Reuse:**
`Order` schema + `assembleOrderDTO`/`toOrderDTO`/`statusHistoryDTO`/`orderItemsDTO`/`customerDTO` + `Orders.ByID` +
`mapError(ErrNotFound)`→404 + P3-b integration seed helpers. **Verify:** `make verify-go` ✓ (gofmt · vet · golangci **0** · sqlc
vet/diff · oapi stale-check staged · `go test -race` incl real-PG `TestGetAdminOrderEndToEnd`; httpapi 37s / db 49s) · `pnpm verify`
**6/6** (schema.gen.ts stale-gate ✓ + prettier). Pure row→DTO mapping already pinned by `TestToOrderDTOFullMapping` (`dto_test.go`) →
not duplicated (ponytail). **✅ Review DONE:** spec-guardian **PASS** (0 BLK / 0 WARN / 0 NOTE — RBAC authRequired · ADR-032 internal
projection · money raw-int-VND · uniform-404 · clean-reuse · test-integrity · acceptance · spec-sync all confirmed). BE read-only, owns
no money-mutation/transition/auth-decision → no separate adversarial pass. **✅ Committed `7c718a7` → PR #66 (rebased onto `main`
`59b4601` after P3-c #65 landed; docs-only conflict resolved).** **NEXT after P3-d land = P3-e** (FE `/don-hang/{id}` detail +
**transition UI** + QC-photo gate [migration 000014] — consumes THIS endpoint + wires the P3-c seams: row→detail link, inline + bulk
transitions, mobile action-row).

**— P3-c history (MERGED #65 → `main` `59b4601`) —**
**🔨 PHASE 3 · P3-c (FE `/don-hang` admin orders list) — BUILT + VERIFIED + REVIEWED on `feat/phase-3-admin-p3c-orders-list`**
(off `main` `b2e68c1`; P3-b MERGED #64). **FE-only, READ-ONLY** — consumes the merged `GET /admin/orders` (P3-b). **Architecture** =
RSC page + **URL-searchParams filter/pagination** + server-fetch (cookie-forward, mirrors `dashboard-fetch`) + pure adapters + 2 client
islands (filter `<select>`, table multi-select). **Files (9, +588):** `lib/orders.ts` (pure adapters: `parseStatusFilter` [junk/case→"Tất
cả", no 400] · `productLabel` [firstItemName + "+N" = itemCount−1] · `toOrderRows` [rename customerName→customer, keep enums] · `pageCount`
[ceil, floor-1] · `buildOrdersHref` [omit page-1/no-status]) · `test/orders.test.ts` **+9** (Docker-free; **NB colocated `src/**` test was
silently NOT matched — admin vitest `include:['test/**']` → moved to `test/`**) · `lib/orders-fetch.ts` (server-only, forwards httpOnly
`lumin_session`, `no-store`, throw→`(app)/error.tsx`) · `components/orders-filter.tsx` (client, native `<select>` all-7-status + "Tất cả",
onChange→router.push reset page-1) · `components/orders-table.tsx` (client; **desktop table** Mã/Khách/Sản phẩm/Tổng/Kênh/Trạng thái/Ngày +
**mobile card-stack**, same rows; **multi-select scaffold** = checkbox+select-all+"Đã chọn N"bar+Bỏ chọn, bulk "Đổi trạng thái" **inert seam→
P3-e**) · `app/(app)/don-hang/{page,loading}.tsx` (RSC reads searchParams+fetch+map+pager prev/next; route skeleton) · `messages/vi.ts`
(**+`orders.*`+`channel.*`** namespaces) · `docs/acceptance.md` (**Cụm 28 `ADM-03`** FE `[ ]`). **Money** `formatVnd` only raw-int-VND ZERO
client-math (#2); **status→`OrderStatusBadge`** + channel/status enum→i18n label (#3); **date→`formatVnDate`** (dd/MM/yyyy). **Reuse:**
`OrderStatusBadge`+`order-status.ts` + `dashboard-fetch` pattern + `(app)/error.tsx` retry + core `formatVnd`/`formatVnDate`/`ORDER_STATUSES`.
**Hardening:** `?status=` lạ→Tất cả · `?page=` lẻ/≤0/junk→`Math.floor`+clamp≥1 (no non-int→endpoint-400). **Deliberate scope cuts** (design
shows, endpoint/phase KHÔNG hỗ trợ): per-status **pill-counts** + **search** + **Xuất CSV** dropped (no endpoint field); inline per-row
**transition controls** + mobile **action-row** → **P3-e** (transitions own that); filter = native `<select>` all-7 (KHÔNG design's grouped
"Huỷ/Hoàn" pill — endpoint filters single-status); channel `web`→"Web"/`inbox`→"Inbox" (design IG/Mess sub-channels KHÔNG trong data model);
money `formatVnd` not "₫445k", date với năm. **Verify:** `pnpm verify` **6/6** (lint·typecheck·test·format:check) · admin **33** tests (auth 10
+ dashboard 10 + messages 4 + **orders 9**) · `next build` xanh (`/don-hang` = `ƒ` dynamic 1.86kB / 146kB FLJS; reads cookie/searchParams).
**No new dep · no new ADR · no migration · no contract/codegen change** (additive i18n + docs only). **✅ Review DONE:** spec-guardian **PASS**
(0 BLK / 0 WARN / 2 NOTE — both informational no-action: FE has no page-size control by design [YAGNI] · dynamic-route `no-store` re-fetch is
intended live-admin behavior; independently re-confirmed money-via-formatter · no i18n literals · read-only-no-transition · RBAC-cookie-only ·
empty/loading/error all present · reduced-motion honored · `acceptance.md` synced in-PR correctly `[ ]` · ADR-032 admin projection). FE
read-only, no money-mutation/transition/auth-decision owned here → no separate adversarial pass. **NEXT after P3-c land = P3-d** (BE
order-detail data) → **P3-e** (FE `/don-hang/{id}` detail + transition UI, wires the P3-c seams: row→detail link, inline + bulk transitions,
mobile action-row). **Commit → user gate.**

**— P3-b history (MERGED #64 → `main` `b2e68c1`) —**
**🔨 PHASE 3 · P3-b (BE `GET /admin/orders` — list · status-filter · paginate) — BUILT + VERIFIED + REVIEWED on `feat/phase-3-admin-p3b-orders-list`**
(off `main` `edcb5fe`; P3-a MERGED #63). **BE-only** — mirrors catalog-list (`products.go GetProducts`) + dashboard patterns. **DTO** =
INTERNAL admin projection (`AdminOrderSummary`: id/code/customerName/**firstItemName+itemCount** cho cột "sản phẩm"/channel/status/
total-**raw-int-VND**/createdAt) — **KHÔNG** dùng public `PublicOrderTimeline` whitelist (đây có PII/kênh/tiền, ADR-032). **SQL**
(`orders.sql`): `ListAdminOrders` (newest-first `created_at DESC, id DESC` stable-paging · nullable `status` narg = "Tất cả" · JOIN
`customers.name` + 2 scalar subquery first-item-name/item-count backed by `order_items_order_idx`, no-N+1; first item picked `ORDER BY
oi.id` stable-arbitrary; `firstItemName` non-pointer `string` an-toàn vì mọi đơn ≥1 item — CreateOrderTx `ErrNoItems` + `order_items`
CHỈ ON DELETE CASCADE, KHÔNG có standalone item-DELETE) + `CountAdminOrders` (cùng filter). **Handler** (`admin_orders.go`): `authRequired`
FREE qua classify fail-closed default (owner+staff đọc); `adminOrdersPageParams` (default 20, max 50) + `adminOrdersStatusFilter` (validate
vs `order.Statuses`) → **400 trước mọi read** (oapi bỏ min/max/enum); offset-clamp 100k chống int32-overflow (như catalog). Money raw
int-VND (#2); status/channel = enum, FE format "+N"/label (#3). **Reuse**: `db.NewOrders(pool).AdminList(AdminOrderFilter)` + `nullOrderStatus`
(map `*order.Status`→`sqlc.NullOrderStatus`). **Verify:** `make verify-go` ✓ (gofmt·vet·golangci **0**·sqlc vet/diff·oapi stale-check
staged·`go test -race`: httpapi **+7** admin-orders test [4 Docker-free DTO/page/status + 3 integration real-PG: filter/paginate/newest-first/
multi-item/empty/bad-input→400] + classify `GetAdminOrders`→authRequired) · `pnpm verify` **6/6** (schema.gen.ts stale-gate + prettier).
Additive openapi (`/admin/orders` + 2 schema) + regen api.gen.go/schema.gen.ts **staged**. Acceptance **Cụm 27 `ADM-02`** (Go-gated `[ ]`).
**No new dep · no new ADR · no migration.** 12 files/+998. **✅ Review DONE:** spec-guardian **PASS** (0 BLK/1 WARN/1 NOTE — WARN
acceptance-EARS + NOTE codegen-staged **cả hai ĐÃ thoả** [ADM-02 ở Cụm 27, .gen staged + stale-check xanh]; reviewer chưa với tới file
staged); adversarial (oracle) **0 correctness bug** (6 góc REFUTED: offset-clamp int-không-int32 an-toàn · `$1 IS NULL` match mọi row =
"Tất cả" · ≥1-item invariant làm non-pointer `firstItemName` scan airtight · `id` tiebreak = total-order stable-paging · itemCount int32-widen
· mọi bad-input→400-trước-read). **NEXT sau P3-b land = P3-c** (FE `/don-hang` danh sách — filter pills + table + `OrderStatusBadge` +
multi-select scaffold, tiêu thụ endpoint này; admin-mobile card-stack). **Commit → user gate.**

**— P3-a history (MERGED #63 → `main` `edcb5fe`) —**
**🔨 PHASE 3 · P3-a (admin login + auth-redirect) — BUILT + VERIFIED on `feat/phase-3-admin-p3a-login`** (off `main`
`a448a7d`; NOT the migration branch — re-based off main so the pending unaccent fix stays separate). **Backend auth đã có**
(ADR-030 self-issued JWT: `POST /auth/login` bcrypt→httpOnly cookie `lumin_session` SameSite=Strict, `/auth/logout`); P3-a chỉ
là **FE + BFF re-issue cookie**. **Restructure:** route-group `app/(app)/` giữ chrome (sidebar+offset) — MOVED `page/loading/
error.tsx` vào đó; `/dang-nhap` sống NGOÀI group (full-bleed, no nav); root `layout.tsx` giờ chỉ html/body/providers.
**Login flow:** `login-form.tsx` (client, native required/type=email) → Server Action `lib/auth-actions.ts#login` gọi core-api
`POST /auth/login` **server-side** → `parseSessionCookie` lấy value+Max-Age từ upstream Set-Cookie → `cookies().set` re-issue
trên host admin (httpOnly+strict+secure-khi-prod, token KHÔNG chạm client JS) → `router.replace('/')`. 401/400→"sai email/mật
khẩu" ĐỒNG NHẤT (no enum), 5xx/throw→"thử lại" (no set). **`middleware.ts`** (edge): thiếu cookie→redirect `/dang-nhap` (real
gate vẫn là core-api 401; Max-Age==JWT TTL nên expiry drop cookie→middleware, không ping-pong); có cookie ở `/dang-nhap`→`/`.
**Logout** = Server Action xoá cookie (JWT stateless) trong sidebar footer. Dropped signup/forgot-pw/remember-me (owner seed qua
`make seed-owner`; staff invite=P3-q; no reset backend). **Reuse:** `SESSION_COOKIE`+`coreApiBaseUrl` extract sang `lib/session.ts`
(dashboard-fetch dùng chung). **Verify:** `pnpm verify` **6/6** (lint·typecheck·test·format) — admin **24** test (auth.test.ts
**+10**: parseSessionCookie 5 + login action 5) · `next build` xanh (`/dang-nhap` static · `/` dynamic · Middleware 34kB).
Acceptance **Cụm 26 `ADM-01`** (FE `[ ]`). **Runtime smoke (next start):** `/dang-nhap` 200+form · `/`+`/don-hang` no-cookie
→307 `/dang-nhap` · `/dang-nhap`+cookie →307 `/` · `/favicon.ico` không redirect (matcher OK). **✅ Review DONE:** spec-guardian
**PASS** (0 BLK/0 WARN/0 NOTE); adversarial-security **0 exploitable** (7 góc refute: cookie round-trip byte-khớp — JWT base64url
không `=`/`;`; matcher chỉ UX-gate real-gate=core-api 401, no open-redirect; uniform 401 no-enum; SameSite=Strict CSRF; Max-Age
luôn có). **2 LOW deferred (không chặn):** (1) `secure:NODE_ENV==='production'` — landmine khi viết admin Dockerfile (đã `ponytail:`
comment: pin NODE_ENV hoặc COOKIE_SECURE env); (2) `/auth/login` chưa rate-limit app-level (dựa CF WAF chưa wire; BFF-hop giấu
client IP → limit phải ở **edge admin**, không core-api keyed-IP) — ops Phase-5. **✅ Doc-sync (BLOCKER-E) DONE:** synced
"Cloudflare Access" → ADR-030 JWT ở `conventions.md §Bảo mật` (qua van `.allow-contract-edit` dùng-rồi-xả) + `.claude/rules/
admin.md` + `plan.md §Phase-3` + `architecture.md`; giữ nguyên các ref hợp-lệ (ADR-030 "KHÔNG dựa CF Access" · operations.md
GlitchTip-UI-sau-CF-Access · core-http-relay plan). **NEXT:** commit → user gate (cân nhắc tách `docs:` doc-sync + `docs(phase-3):
plan` khỏi `feat(admin):P3-a` — Scope §1-PR-1-trục); kế tiếp **P3-b** (GET /admin/orders list).

**✅ PHASE 2 CHECKOUT COMPLETE (2026-07-10)** — cả 9 sub-PR `P2-a..i` MERGED; cuối = **P2-g #60** (`origin/main` squash
`17284fb`; local `main` đã ff'd, working tree clean). Đơn web end-to-end đủ luồng: `/thanh-toan` C1 địa chỉ → C2 VietQR+proof
→ C3 wait-screen auto-poll (PENDING_CONFIRM→PAID không refresh) + `/o/{code}-{token}` phone-less deep link.

**✅ WALKTHROUGH FINDINGS — BOTH FIXED** — end-to-end **browser** walkthrough of the full P2 journey (2026-07-10, full local
stack: storefront+core-api+PG/NATS/Garage, seeded product+STK+shipping, LMN-1000 placed→reconciled→PAID live) confirmed the happy
path; surfaced 2 gaps (→ memory [[lumin-phase2-walkthrough-findings]]): **(1)** `/gio-hang` had **NO checkout CTA** (`cart-view.tsx`
Phase-1 boundary never re-wired) → `/thanh-toan` URL-only → **MERGED #61** (`main` `a448a7d`; `CtaLink`→`/thanh-toan` +
`cart.checkoutCta` i18n). **(2)** fresh `make migrate` breaks at `000012_product_search` — golang-migrate's session can't resolve the
**unqualified** `unaccent(...)` in the `immutable_unaccent` body ("unaccent(unknown,text) does not exist" **even with the extension
in public + public on search_path** — NOT the same-tx/visibility theory; CI masks it because integration tests apply `.sql` via a
direct **pgx applier** [D4], never golang-migrate CLI) → **FIXED** on `fix/migrate-unaccent-schema-qualify`: fully schema-qualify the
body (`public.unaccent('public.unaccent'::regdictionary, …)`) + `CREATE EXTENSION … WITH SCHEMA public`. Verified: fresh
`make migrate` 0→13 green · `immutable_unaccent('Đèn để bàn')`→`Den de ban` · sqlc vet/diff clean · db+httpapi integration green.
Commit/PR pending user gate.

**➡️ PHASE 3 · Admin — PLAN LOCKED (2026-07-10), chưa code.** Plan `docs/plans/phase-3-admin.md` (3 vòng探索 read-only:
backend-surface + spec/designs + FE-reuse). **Phát hiện then chốt:** xương sống admin **đã có** (Core slice 3 PR-3a..k:
auth+RBAC JWT [ADR-030, **KHÔNG** Cloudflare Access], dashboard, `POST /orders/{id}/transitions` confirm/advance/cancel/refund,
settings/STK owner-only+audit, reply-templates) → Phase 3 = **FE-nặng** + lấp handler đọc + 2 surface greenfield. `apps/admin`
hiện **chỉ có dashboard** — **CHƯA có màn login** (backend auth chạy nhưng không có UI lấy cookie) → **P3-a `/dang-nhap` =
firstPR, gate tất cả**. **Owner-lock:** D-P3-1 scope=**EVERYTHING** (mọi màn `designs/`, ~20 sub-PR) · D-P3-2 hàng-đợi-in=
**drag-drop @dnd-kit + SSE** · D-P3-3 editor SP=**full 2-cột + live preview** · D-P3-5 upload 2 đường (**ảnh** reuse P2-c
presigned-POST; **model .glb** = presigned-PUT multipart ADR-005, infra greenfield) · D-P3-6 QC-photo `→SHIPPING` (migration
000014) · D-P3-7 Vật-tư + Pet-Tag=**greenfield cuối** (Pet-Tag tách `docs/plans/pet-tag.md`). **Tracks:** 0-Foundation(P3-a) ·
A-Đơn(b..e) · B-Hàng-in(f..h) · C-Cài-đặt(i) = **Done-gate lõi `plan.md`**; D-SP(j..l) · E-Đánh-giá(m..n) · F-extras
(o..t Danh-mục/Khách/Nhân-viên/Kênh/Vật-tư/Pet-Tag). **BLOCKER-E doc-drift:** `conventions.md` §57 + `plan.md` §Phase-3 còn
ghi "Cloudflare Access" → spec-sync về ADR-030 (JWT). **NEXT = P3-a** (login UI; backend `/auth/login` đã sẵn). Housekeeping
treo: **52 nhánh local** (đa số merged/`:gone`) chờ chủ duyệt xoá.

**— P2-g history (MERGED #60 → `main` `17284fb`) —**
**P2-g (C3 wait-screen + confirmation) — spec-guardian **PASS** (0 BLK/0 WARN/3 NOTE —
NOTE-1 no-render-test = **deliberate skip** [storefront has NO jsdom/testing-library, pure-logic-only convention like
P2-d/e/f; the risky parser IS unit-tested]; NOTE-2 emoji-🧡 precedent + NOTE-3 `createdAt` mapping-parity = no-action);
adversarial **0 correctness bugs** (7 risk-vectors refuted: `#`-in-code query-encode → `%23` via openapi-fetch serializer,
server no-strip → matches stored `#LMN-…`; handle round-trip for leading-digit/embedded-`-`/`_` tokens; byte-identical hook
fidelity vs original P1-o loop; SSR/hydration seed; cart-clear guard-order; `fetcherRef.current!` safety). 2 adversarial
non-bug notes: REFUNDED via generic branch (intentional, matches P1-o) + `idle` unreachable in wait-screen (harmless). FE-only, **no BE/contract/codegen/migration**. **FINAL sub-PR of the
Phase-2 checkout journey (P2-d→e→f→g)** — after it lands, Phase-2 checkout is complete. Replaces P2-f's minimal `OrderPlaced`
with a full wait-screen reached TWO ways, identical behavior: post-checkout (`checkout-view` renders `<WaitScreen
code={placed.order.code} token={placed.trackingToken} justPlaced />`) and the phone-less deep link `/o/{code}-{token}` (NEW
route `app/o/[handle]/page.tsx`, noindex + robots-disallow). **Reuse-P1-o-verbatim (plan §5) = extract the P1-o poll
`useEffect` into shared hook `lib/use-order-poll.ts`** (cadence 15s · 10-min ceiling · hidden-tab pause+deadline · exp backoff ·
terminal-stop) now used by BOTH `order-lookup.tsx` (P1-o, behavior UNCHANGED — proves the extraction) and `wait-screen.tsx`;
the ONLY difference is the fetcher: NEW Server Action `lib/order-track.ts` → `GET /orders/track?code=&token=` (mirrors
`order-lookup.ts` DTO→TimelineData map + uniform-404 no-leak, ADR-032). Poll flips PENDING_CONFIRM→PAID **without refresh**.
**CANCELLED branch** (receipt rejected, spec §04) = distinct terminal copy + nhắn-shop; poll already stopped (`isPollableStatus`
terminal). Confirmation = code + status badge + **copy-link** (`window.location.origin` + `buildTrackHandle`, no server env
needed) + nhắn-shop (`/lien-he`, same target as tracker+footer). **`/o/` URL parse — storefront owns it (track.go):** strip
code `#` (URL-fragment-unsafe) → split `^(LMN-\d+)-(.+)$` (token base64url may contain `-`/`_`; greedy `\d+` stops at the
boundary `-` → unambiguous) → re-add `#` + upper-case code, token verbatim (base64url case-sensitive). Pure
`buildTrackHandle`/`parseTrackHandle` in `order-lookup-view.ts`, unit-tested (+4). Malformed handle / wrong-expired token →
uniform "link sai/hết hạn" state (hi-fi C3 line 1179). **Poll-Q1 (plan §6 open-q): kept P1-o 15s, NO Phase-2 override** (the
point of reuse-verbatim). NEW `track` i18n namespace (reuses `lookup.*` for shared live/paused/refresh/rate/error affordance);
dropped dead `checkout.done*`. robots.ts disallow += `/o/` + overdue `/thanh-toan` (comment promised it "when checkout lands";
P2-d/f missed it — both already per-page noindex, this is the crawl backstop). **Verify:** `pnpm verify` **6/6** — storefront
**161** tests (order-lookup-view **16**, +4 handle round-trip/split/case/malformed). **9 files (+513/−136;** order-lookup.tsx −90
net as the loop moved to the hook).

**— P2-f history below (now MERGED via PR #59 → `main` `e94b658`; P2-g branched off it) —**
**P2-f (payment step C2 on `/thanh-toan`: VietQR + proof upload + submit → `POST /orders`) — BUILT + VERIFIED on
`feat/phase-2-checkout-p2f` (off `feat/phase-2-checkout-p2e`; P2-f STACKS on P2-e — merge P2-e first).** `note` handling
(owner-chosen "hide it on review" after adversarial flag): collected on C1 but **neither echoed on the C2 review nor sent** —
`CreateWebOrderInput` has no `note` field (only the inbox DTO), and echoing it on the confirm screen would imply it was saved;
contract gap deferred (add additive `note?` later). Flow: C2 renders the server-built VietQR
(`config.vietqrUrl` img + STK accountNumber/accountName; **no bank-name** — QR renders it, ponytail bin→name map deferred) →
shopper picks a receipt → Server Action **`createPaymentProofUpload(contentType)`** (P2-c presigned POST) → browser POSTs the
bytes **straight to Garage** (policy fields first, file part last; size ≤ maxBytes pre-checked) → hold `finalUrl` → "Xác nhận
đặt đơn" (disabled until proof done + total settled; double-submit guard D-P2-7) → Server Action
**`placeOrder(buildWebOrderInput(...))`** → 201 `{order, trackingToken}` → **clear cart** + minimal done view (holds token;
**full wait-screen + `/o/{code}-{token}` link = P2-g seam**). **C2½ full-screen loading** while in-flight (not just a disabled
button); STK-empty → friendly closed-notice (mirrors `NO_STK_CONFIGURED`); failures mapped to `no_stk`/`no_shipping_rule`/
`error` (loud-reject, no envelope leak).

**Money-path core = pure `buildWebOrderInput(validated, items, proofUrl)` in `lib/checkout-form.ts`:** priced fields
(`productId`/`colorId`/`optionIds`/`quantity`) come **STRAIGHT from `cartQuoteItems`** → the order can't be priced ≠ the quote
the shopper saw (parity by construction; P2-b's Go `TestQuotePriceParityWithOrder` already proved order-with-personalization ==
quote). Engraved lines add `personalization{text, zoneId=engrave.optionId}` (zoneId non-blank server-required, §5 free-form;
blank text dropped, mirroring `personalizationFrom` trim); acks map 1:1 when personalized; **note omitted**. **5 files:** NEW
`lib/order-submit.ts` (2 Server Actions, `'use server'`, safe-`code` mapping like `quoteCart` — no envelope leak) ·
`lib/checkout-form.ts` (+`buildWebOrderInput`) · `lib/cart-store.ts` (+`clear()`) · `components/checkout-view.tsx` (payment UI +
`submitting`/`placed` states + STK guard; replaced the P2-f seam line) · `messages/vi.ts` (C2/C2½/done keys, dropped
`paymentPending`). **Verify:** `pnpm verify` **6/6** — storefront **157** tests incl `checkout-form` **17** (+4
`buildWebOrderInput`: plain mapping · quote-parity · engrave personalization+zoneId+acks · blank-engrave drop · note excluded).
Acceptance **Cụm 25 `CHK-11`** (FE `[ ]` by convention). **No new dep · no new ADR · no migration.** **✅ Review DONE:**
spec-guardian **PASS** (0 blk/0 warn/2 note); adversarial **1 HIGH + 1 MED + 1 LOW** → HIGH **FIXED** (double-submit: the
`submitting` state guard leaked across the async setState gap → 2nd fast click minted a duplicate order; replaced with a
synchronous `submitLatch` useRef — server idempotency stays the authoritative future fix, ADR-033), MED = note→**hide-on-review**
(owner), LOW = `file.type` trust noted as `ponytail:` ceiling. Re-verified green post-fix. **P2-e MERGED (PR #58 → `main`
`1b656fe`); P2-f rebased onto that `main` (dropped the 2 now-redundant P2-e commits → single-commit clean diff) + pushed → PR
open → `main`; chờ user merge-gate.** **NEXT after P2-f = P2-g** (C3 wait-screen: reuse P1-o poll over `GET /orders/track`
token + OrderTimeline + `/o/{code}-{token}` copy link + CANCELLED branch).

**— P2-e history below (now MERGED via PR #58 → `main` `1b656fe`; P2-f was branched off it, since rebased onto `main`) —**
**➡️ P2-e (engrave acks on `/thanh-toan` info step) — BUILT + VERIFIED + REVIEWED on `feat/phase-2-checkout-p2e`
(off `main` `e1234ab`; P2-d #57 MERGED, local main ff'd).** FE-only, **no BE/contract change** — the two ack fields
already exist on `CreateWebOrderInput` (openapi.yaml:1490-1493), unlike the `note` gap. ADR-012 dual-ack **add-on that
stacks ON TOP of** P2-d's đổi-trả disclosure (does NOT replace): cart has engraving (`engrave.text.trim()!==''` — exact
mirror of server `personalizationFrom` non-blank-text, defends tampered localStorage) → render engrave-echo `<ul>` +
prepay copy + 2 required `@lumin/ui` Checkbox → `personalizationAck` + `engraveEchoConfirmed`. New pure
`personalizationAckMet(hasP,ack,echo)=!hasP||(ack&&echo)` in `lib/checkout-form.ts` = exact mirror of `checkout.go:241`
(`anyPersonalization && (!ack||!echo)`); gates "Tiếp tục" via `continueDisabled` **+ Enter-path early-return + `ackHint`
nudge (no 400)**. Acks carried in `ValidatedCheckout` (optional, true only when personalized → P2-f maps 1:1); non-engraved
→ section absent, flags omitted (server ignores). **✅ Review DONE:** spec-guardian **PASS** (0 blk/0 warn/0 note —
server-mirror·stacking·conventions·P2-f-seam verified, incl stale-acks-on-de-engrave + Enter-path); adversarial **0
correctness bugs**. **Verify:** `pnpm verify` **6/6** — storefront **153** tests incl `checkout-form` **13** (+2 gate
truth-table). 4 files/+118. **No new dep · no new ADR · no migration.** **Committed → chờ user push+PR-gate.** **NEXT =
P2-f** (VietQR + proof upload + submit → `POST /orders`; wires cart→checkout entry + must close the `note`-on-web-input
contract gap).

**— P2-d now MERGED (#57 → `main` `e1234ab`); the "PR #57 OPEN" note below is superseded —**
**➡️ P2-d (C1 checkout info step `/thanh-toan`) — BUILT + VERIFIED on `feat/phase-2-checkout-p2d` (off `main` `fff5618`;
P2-i #56 squash-merged, local main ff'd).** FE-only, **no BE/contract change** (reuses P2-a `/checkout/config` + P2-b
`/price/quote?province`). New: RSC shell `app/thanh-toan/{page,loading}.tsx` (fetch config server-side, **noindex**) → client
`components/checkout-view.tsx` (mount/cart-guard · config-error retry · empty-CTA · C1 form · **step machine info→payment**:
C2 "Giao cho"+totals header rendered, QR/proof/submit = **P2-f seam**). Form mirrors server `checkout.go intake.validate` via
pure `lib/checkout-form.ts` (name 2–60 **rune** trim · phone `^(0|\+84)\d{9}$` **whitespace-stripped** `normalizePhone` · email
optional "@"-check · province[native `<select>` from `shippableProvinces`, no @lumin/ui Select]/ward/street non-blank, **NO
district** ADR-017 · maps `{customer,shippingAddress,note?}`, email/note omit-when-blank). Live **Tạm tính/Phí ship/Tổng CHỈ từ
`/price/quote` kèm province** (extended `lib/quote.ts`: optional province → `shippingFee`/`total` + new `no_shipping_rule` code;
ZERO client-math; quote gates "Tiếp tục"). **đổi-trả disclosure (refundPolicy inline + link `/chinh-sach#doi-tra`) cho MỌI
giỏ** + **PDPL privacy notice unbundled, KHÔNG marketing-tick** (contract-basis order_fulfillment granted server-side; compliance
§2/§3). **✅ Review DONE:** spec-guardian **PASS** (0 blk/0 warn/2 note — note-1 note-defer accepted, note-2 anchors verified present on /chinh-sach); adversarial **0 correctness bugs** (8 vectors refuted). **Committed `fc8287c` → PR #57 OPEN → main (chờ user merge-gate).** **⚠ Contract gap for P2-f:** `CreateWebOrderInput` has **no `note`** field (only inbox DTO) → P2-f must add additive
`note?` to the web input or render display-only (P2-d only COLLECTS note). **Decision:** cart→checkout entry NOT wired
(deferred to P2-f flow-completion; `/thanh-toan` reachable by URL only for now). **Verify:** `pnpm verify` **6/6** (lint·typecheck·
test all pkgs·prettier) — storefront **151** tests incl. new `checkout-form.test.ts` (**11**) · api-client `schema.stale` green
(no codegen drift) · core `acceptance.ledger` **52** green. Acceptance **Cụm 24 `CHK-10`** (FE, `[ ]` by convention — TS gate in
app-gates, not the packages-only parser). **No new dep · no new ADR · no migration.** **Review IN-FLIGHT: spec-guardian +
adversarial. NEXT after P2-d lands = P2-e (engrave acks) then P2-f (VietQR+proof+submit, wires cart entry + note).**

**— P2-i/earlier Phase-2 history below (P2-i now MERGED #56, `main`=`fff5618`) —**
**➡️ PHASE 2 STATUS (2026-07-10):** **P2-a/P2-b/P2-c/P2-h MERGED** (#53/#52/**#55**/#54; `main`=`c44c06c`). **🔨 P2-i
(`GET /orders/track?code=&token=` phone-less tokenized tracking + `trackingToken` trong order-create 201) — BUILT + FULLY
VERIFIED + REVIEWED on `feat/phase-2-checkout-p2i` (off `main` `c44c06c`).** Implements D-P2-8: token =
**`base64url(HMAC-SHA256(TRACKING_SECRET, orderCode))`** — capability deterministic, **KHÔNG migration/KHÔNG cột** (recompute
lúc đọc). New `internal/httpapi/track.go` (`trackingSigner` HMAC + `TrackOrder` handler) **mirror `LookupOrder` verbatim**:
reuse `s.lookup` per-code token-bucket (CHUNG với lookup), `publicTimelineDTO` (cùng ADR-032 whitelist), uniform-404
code-lạ==token-sai (no enumeration), **constant-time `hmac.Equal`**. `POST /orders` 201 → **`CreateOrderResult {order,
trackingToken}`** (additive; token **chỉ** ở 201, không lộ endpoint đọc nào khác — 1 dòng đổi ở `mustCreateOrder`). Config
**`TrackingSecret`** + **`UsesForgeableTrackingSecret`** fail-fast (reuse `ALLOW_DEV_JWT_SECRET` opt-in) + main.go
fail-fast/Warn + `WithTrackingSecret` wiring (BLOCKER-F). `middleware_auth` classify **`TrackOrder=authPublic`** (fail-closed
default sẽ 401 link công khai — REAL catch: integration test drives no-cookie router → 200). **`ponytail:` base64url thay
base62** (plan literal) — stdlib/URL-safe, token opaque, FE owns `/o/{code}-{token}` parse. **No new dep · no new ADR**
(implements D-P2-8; reuse ADR-030 forgeable-secret / ADR-032 whitelist / ADR-034 token-bucket). **Verify (colima up):**
`make verify-go` ✓ (gofmt·vet·golangci **0**·sqlc vet/diff·oapi stale-check·`go test -race` incl. **real-PG
`TestTrackOrderEndToEnd`**) · `pnpm verify` 6/6 (schema.gen.ts stale-gate + prettier) · guard **164/0** (**+1 TRK ARM**:
`hmac.Equal` + `s.lookup.allow` + main `UsesForgeableTrackingSecret` + classify authPublic — **PROVEN binding** mutate
`hmac.Equal`→`==` → RED → restore → green). Docker-free `TestTrackingSignerRoundTrip` (determinism/tamper/normalize/secret-keyed)
+ `config.TestUsesForgeableTrackingSecret`. Acceptance **`TRK-01`** (Go-gated `[ ]`) + ops `TRACKING_SECRET` doc (§4b). 16 files
/ +642 (codegen-heavy: api.gen.go/schema.gen.ts). **Review IN-FLIGHT:** spec-guardian + adversarial-security (attack
enumeration/forgeability/timing/DTO-leak). **Review DONE:** spec-guardian **PASS** (0 BLK / 2 WARN / 3 NOTE); adversarial
**0 exploitable** (7 angles traced vs audited LookupOrder). **WARN-1 FIXED** (openapi + TRK-01 said absent-token→404, code
đúng trả 400 required-param → reworded: present-wrong-token→uniform-404, ABSENT code/token→400 pre-DB uniform, không oracle;
regen'd api.gen.go/schema.gen.ts, stale-check re-clean). Adversarial NOTE-1 addressed: ops note edge access-log KHÔNG giữ
query-string cho `/orders/track` (token in URL = bearer). WARN-2/3 (base64url plan-drift · no-new-ADR) + NOTE-2/3 (no
per-token revoke · shared ALLOW_DEV switch) = accepted/informational. **NEXT after P2-i lands = FE journey chain P2-d→e→f→g** (mọi seam BE/infra/content
`P2-a/b/c/i/h` giờ đủ). **Owner ops trước P2-f go-live:** Garage bucket/key/CORS/lifecycle bootstrap + Caddy handle +
Cloudflare-Tunnel ingress hostname (home box; infra/README).

**— P2-c/earlier Phase-2 history below (P2-c now MERGED #55, `main`=`c44c06c`) —**
**➡️ PHASE 2 STATUS (2026-07-09):** **P2-a/P2-b/P2-h MERGED** (#53/#52/#54; `main`=`608ec46`). **🔨 P2-c
(`POST /checkout/payment-proof-upload` presigned POST + retention) — BUILT + FULLY VERIFIED on `feat/phase-2-checkout-p2c`,
uncommitted.** A parallel **Codex** session had scaffolded P2-c hand-rolling the SigV4 POST policy; per two owner decisions
this session **(1) swapped signing → `minio-go/v7` (`@v7.0.77`, go directive HELD 1.23.6)** — new `internal/proofstore` is the
ONE home for presign + `OwnsURL` host-pin + `Delete`, shared by the upload handler + `CreateOrder` gate + the sweeper — and
**(2) added a cron-GC retention sweeper `internal/retention`** (owner chose delete-90d-**after-terminal** over object-age
lifecycle): anchor = `orders.updated_at` (set by every transition, never touched after a close state), single-source terminal
set `order.TerminalStatuses()`, **object-delete-then-null-ref** (idempotent: crash mid-way → next sweep re-selects, S3 delete
idempotent); the bucket **lifecycle rule stays the ORPHAN backstop** (infra/README). PDPL notice + `consentPolicyVersion` bump
**deferred to P2-f** (dormant endpoint collects no PII until the FE wires it — tracked hard gate). **Real bug caught + fixed
(parallel tool shipped it, masked because its `verify-go` ran without Docker so the integration test skipped):** the host-pin
gate pre-empted the P2-a STK gate → `TestCreateOrderWebRequiresSTK` got `PROOF_REQUIRED` not `NO_STK_CONFIGURED`; fix = host-pin
fires **only when uploads are configured** (`s.proofUploads != nil`), keeping the STK gate testable in isolation with no prod
hole (a real web order cannot exist without uploads → storefront needs the presigned endpoint to make a proof URL). The
Docker-free `checkout_test.go` uses a nil pool, so every gate must fire before any DB read — host-pin stays early. **Verification
(colima up):** `make verify-go` ✓ (gofmt·vet·golangci **0 issues**·sqlc vet/diff·oapi stale-check·`go test -race` incl. new
`db.TestPurgeableProofOrders` integration vs real PG) · guard **163/0** (**+1 host-pin ARM PR-P2-c**: checkout `OwnsURL` +
`SetContentLengthRange`/`SetContentType` + `proofUploadLimiter.allow` + classify authPublic — **PROVEN binding** mutate→RED→
restore) · `pnpm verify` 6/6 + `format:check` ✓ (**`.agents/`+`.codex/` gitignored** — external Codex tooling, out of the PR).
**+1 dep** minio-go/v7 (+md5-simd/rs-xid/go-humanize/go-ini indirects). **No new ADR** (implements ADR-035; its "lifecycle/GC"
wording already covers cron-GC + lifecycle backstop). Acceptance: `CHK-08` refs fixed (signer tests → `proofstore.*`) + new
**`CHK-09`** retention (Go-gated `[ ]`). **Review DONE:** spec-guardian **PASS** (1 NOTE = host-pin-when-`nil`, accepted); adversarial **0 BLOCKER / 0
exploitable** (traced minio source: offline-sign confirmed via `getBucketLocation` region short-circuit, no secret leak,
`updated_at` anchor sound, list→delete→clear crash-consistent) — **1 NOTE FIXED** (`OwnsURL`/`ownsObjectKey` now round-trips
to the canonical `uuid.New().String()` shape → rejects `urn:uuid:`/brace/uppercase variants the signer never mints;
+`proofstore_bypass_test.go` 3 tests), 2 NOTEs ACCEPTED (foreign-URL null-ref + global rate-limit DoS-lever = deliberate
single-shop). Re-verified post-fix: guard **163/0**, `make verify-go` green. **NEXT after P2-c lands = P2-i**
(tokenized phone-less tracking, `dependsOn=[]`), then FE chain P2-d→e→f→g. **Owner ops step before P2-f goes live:** Garage
bucket/key/CORS/lifecycle bootstrap + a Caddy handle + Cloudflare-Tunnel ingress hostname (home box; runbook in infra/README).

**— parallel-tool P2-c BUILT note (2026-07-06) superseded by the entry above: hand-rolled SigV4 signer swapped to minio-go,
cron-GC retention added, host-pin/STK ordering bug fixed, guard 162→163, format:check fixed —**

**— earlier P2-a/P2-b history below (P2-a now merged; the "🔨 BUILT … PR #53 OPEN" note is superseded) —**
**➡️ PHASE 2 STATUS (2026-07-05 PM):** **P2-b MERGED** (PR #52 → `origin/main` `b8af772`, 13:47Z; local `main` ff'd —
the earlier "awaiting merge-gate" note is stale). **2 of 9 sub-PRs building/done.** **🔨 P2-a (`GET /checkout/config`
public whitelist [STK + server-built VietQR URL + shippable provinces + refundPolicy] + web `POST /orders` STK gate
→ 422 `NO_STK_CONFIGURED` before any write) — BUILT on branch `feat/phase-2-checkout-p2a` (off `main` `b8af772`;
staged, NOT committed — awaiting review outcomes + user merge-gate). verify-go rc=0 (golangci 0, sqlc vet+diff, oapi stale-check
staged, `go test -race` incl httpapi+db integration vs real PG/colima) · `pnpm verify` 6/6 (api-client stale-gate) ·
guard 161→162 (+1 config ARM; STK-gate + vietQRImageURL + classify all PROVEN binding mutate→RED→restore) · osm 22.
Additive openapi (`GetCheckoutConfig` + `CheckoutConfig` schema) + regen api.gen.go/schema.gen.ts staged. No new dep ·
no new ADR (impl D-P2-1/ADR-010) · no migration. Acceptance Cụm 22 `CHK-06`/`CHK-07` (Go-gated `[ ]`).
**spec-guardian PASS (0 BLK/0 WARN/2 NOTE-informational). Adversarial 5-lens wf_b41c27c8 = 1 confirmed NOTE → FIXED:**
`shippableProvinces` chỉ bắt malformed *shape*, KHÔNG bắt `fee<0` mà `pricing.ShippingFee` coi là malformed→500 →
`/checkout/config` sẽ 200-list tỉnh mà web-order tới đó 500 (mâu thuẫn comment + CHK-06); fix = mirror check `r.Fee<0`
loop-top (mọi rule kể cả `*`) + 3-case malformed test. Re-verify full green (verify-go rc=0 · guard 162 · osm 22).
**Op-note: một stray `services/core-api/api.gen.go` (2999 dòng, dup của `internal/api/api.gen.go` — `output:` relative +
cwd sai) lọt vào `git add -A` → CAUGHT qua diffstat nhảy 642→3641, `git rm`'d; `go generate ./internal/api/...` chỉ ghi
internal/api.** 16 files / 648 ins → **committed + PR #53 OPEN** (`feat/phase-2-checkout-p2a` → `main`, MERGEABLE, CI
running: selftest green · app-gates · services-gates) — chờ user merge-gate.** NEXT after P2-a lands = **P2-h**
(`/chinh-sach`, ADR-free).

**✅ PHASE 1 STOREFRONT COMPLETE (2026-07-05)** — cả 19 sub-PR `P1-a..s` MERGED; cuối = **P1-i #51** (`origin/main`
`1dc8c05`, on-demand 3D model-viewer, 11:34Z). Local `main` đã ff `1dc8c05`, working tree clean. Housekeeping nợ:
~30 nhánh local đã-merge/`:gone` + `chore/core-closeout-housekeeping` (20 behind/1 ahead, obsolete) — **chờ chủ duyệt xoá**.

**➡️ PHASE 2 · Checkout & thanh toán — PLAN LOCKED, chưa code.** Plan `docs/plans/phase-2-checkout.md`
(workflow `wf_cae0afba`: 10 readers → 3 angles → 3-lens judge → synthesis + completeness-critic; winner = risk-first
money-spine). **9 sub-PR** `P2-a..i`, dependency-sound: seam BE/infra/content trước (`P2-a` checkout-config+STK-gate ·
`P2-b` `/price/quote`+shipping · `P2-c` proof presigned-POST upload · `P2-i` tokenized phone-less tracking · `P2-h`
`/chinh-sach` legal) → FE journey (`P2-d` địa chỉ → `P2-e` engrave-acks → `P2-f` QR+proof+submit → `P2-g` wait-screen).
**Xương sống tiền/đơn ĐÃ có** (`POST /orders` 3g, `/price/quote` P1-b, cart P1-k, guest-poll P1-o) — Phase-2 chỉ lấp
gap + treo FE. **4 quyết định chủ LOCKED (2026-07-05):** proof = **presigned POST + auto-delete 90d** · đổi-trả =
**disclosure MỌI đơn + trang `/chinh-sach`** · deposit = **100% prepay, không migration** · **D-P2-8 = DỰNG endpoint
theo dõi phone-less tokenized** (HMAC capability, KHÔNG migration → +P2-i). 6 còn lại lấy đề xuất (VietQR img.vietqr.io ·
province=shipping_rules keys · ETA tĩnh · missing-STK 422 · double-submit FE-guard+runbook · analytics defer).
**NEXT = P2-b hoặc P2-h** (cả hai ADR-free, `dependsOn=[]`, land song song được); `P2-a`/`P2-c`/`P2-i` cần ADR/secret lock.

**🔨 PR-P2-b (`POST /price/quote` optional `province` → `{lines, subtotal, shippingFee, total}`) — BUILT · verify+
integration(colima) green · **spec-guardian PASS (0 BLK/1 WARN-fixed/1 NOTE-fixed)** · **adversarial 4-lens wf_8d47e86a
0 confirmed** (2 NOTE refuted: whitespace-province + >int32-qty đều bị checkout độc-lập reject → không under-charge được;
contract-compat + edge-errors sạch) · **PR #52 OPEN · CI green (app-gates/selftest/services-gates) · MERGEABLE · chờ
user merge-gate.** (branch `feat/phase-2-checkout-p2b` off `main` `1dc8c05`.)** Review-fix:
`acceptance.md` sync `quoteSubtotal`→`quoteTotals` + test-id `TestQuoteSubtotalCrossLineOverflow`→`…Totals…` (QTE-01) +
**QTE-02 mới** (Go-gated `[ ]`: shipping-fold + 422 NO_SHIPPING_RULE + no-province byte-identical + parity). Additive
contract: `PriceQuoteInput.province?` + `PriceQuote.shippingFee?/total?` (omitempty → **vắng province = byte-identical**
pre-P2-b). Handler `price.go`: province≠"" → `db.Settings.Get` (ErrNotFound→logged 500 như checkout) → `pricing.ShippingFee`
(no-rule→**422 `NO_SHIPPING_RULE`** đã map sẵn errors.go:148) → `quoteTotals(lines,fee)` (đổi từ `quoteSubtotal`, giờ trả
`money.Totals` + fold shipping). **Parity = tường tiền:** `quoteTotals` route CÙNG `money.LineItem{UnitPrice,Quantity}`+fee
qua `money.CalcTotals` mà `CreateOrderTx.lineItems` (orders.go:359) chạy → quote money == order charge cho cùng cart+tỉnh.
**Test:** unit `quoteTotals` (subtotal + fold-fee + cross-line overflow) · integration (real PG, colima, -race)
`TestQuotePriceParityWithOrder` (**cart CÓ KHẮC** 550k×2+30k=1.130.000, quote==order field-by-field) +
`TestQuotePriceProvinceNoRule` (422) + no-province nil-shipping byte-identical. `make verify-go` rc=0 (golangci 0, sqlc
vet+diff, oapi stale-check staged) · full httpapi integration 28s green · `pnpm verify` 6/6 (api-client stale-gate + 138
storefront) · guard **161** / osm 22. **No new dep · no new ADR · no migration.** Codegen regen (Go api.gen.go + TS
schema.gen.ts) staged.

> Lịch sử Phase-0/Core/Slice-1..3 bên dưới (volatile log, giữ tham chiếu). Phase-1 P1-a..s chi tiết ở giữa file.

**PHASE 0 DONE — cả 5 slice trên `main` (`ab99360`):** compose(#5) · ui(#6) · storefront(#7) · admin(#9) ·
services backbone(#10, squash-merged 2026-06-26 03:28Z). Local `main` đã ff về `ab99360`; nhánh
`feat/phase-0-services-backbone` đã xoá local (remote còn — chưa được duyệt xoá). Còn nợ Phase 0 = **ops (không
code):** GPU gate WSL2 (driver Win + cuda-toolkit + nvidia-container-toolkit + Blender-thấy-GPU) + Dockerfile 2
service (gắn GPU gate) — việc của chủ ở máy nhà, không scaffold được.

**ĐANG CHẠY = Phase "Core · Data model + OrderStatus" (xương sống).** Plan: `docs/plans/core-data-model.md`
(3 slice tuần tự). **Slice 1 = domain spine THUẦN Go, KHÔNG DB → ✅ MERGED (PR #11, `origin/main` `10b31f6`,
2026-06-26 05:01Z, squash).** `services/core-api/internal/order` (state machine port từ `packages/core/
order-state.ts` — edges/RBAC/reason/owner-only/statusHistory/replay/channel-entry) + `internal/money`
(`CalcTotals` server-authoritative; `formatVnd` DEFER tới surface email/OG). Test OSM-01..05 + MNY-01/02 +
property (`testing/quick`); `make verify-go` xanh (**17 test**). ADR-003 (Go re-implement spine server-side;
OpenAPI là hợp đồng TS↔Go). Local `main` đã ff về `10b31f6`; nhánh `feat/core-data-model` đã squash-merged
(còn local + remote, chưa duyệt xoá).

**ĐANG Ở Slice 2 (data layer).** Plan 7 sub-PR `docs/plans/core-data-layer.md` (run wf_0952e60c-e3d). Quyết định
chủ: **golang-migrate** + **defer AssetJob** (ADR-028). **PR-2a (infra) ✅ MERGED #12 → `main` `7441072`.**
**PR-2b (outbox table + tx-insert seam) ✅ MERGED #13 → `main` `861808d`.**
**PR-2c (catalog) ✅ MERGED #14 → `881bc86`. PR-2d (identity: customers/consent_grants/users + reviews FK)
✅ MERGED #15 → `main` `59d4f98`.**
**PR-2e (order spine) ✅ MERGED #16 → `main` `cf31cb2` (2026-06-26 09:39Z, squash; local main ff'd).**
`000005_orders` (orders + order_items) + sqlc overrides (`order_status`/`order_channel`→`order.Status`/`Channel`,
`status_history`→`[]order.StatusEvent`, `shipping_address`→`order.Address`, `personalization`→`*order.Personalization`)
+ 3 tx seams in `internal/db/orders.go`: `CreateOrderTx` (genesis event + items + `order.created`), `ConfirmPaymentTx`
(owner-only reconcile→PAID + `order.paid`), `AdvanceStatusTx` (`FOR UPDATE` lock → `order.Transition` → atomic
flip+append; REFUNDED denormalizes refundProofUrl). Totals via `money.CalcTotals` (no client total). `make verify-go`
green; **integration tests RAN vs real Postgres (colima, not just CI)** incl. a `-race` concurrent-reconcile lock
proof; guard 141 / osm 22. 4-lens adversarial review (wf_ac186d9c): 14→9 confirmed, all fixed (2 IMPORTANT:
empty-items guard + FOR-UPDATE test). **No new deps.**
**PR-2f (fulfillment/asset) ✅ MERGED #17 → `main` `b1b28a0` (2026-06-26, squash; local main ff'd).**
`000006_jobs` (asset_jobs + print_jobs + 2 new enums) + `db/queries/jobs.sql` + `internal/db/jobs.go` (`Jobs` repo +
3rd emit-seam `CreateAssetJobTx` → `asset_job.created`). **D3 resolved (user):** AssetJob shape inferred (no spec
§02 table) → SPLIT `asset_job_type` {model_ingest, sprite_render}; `source_model_url`+`source_version` (content-hash)
reconstructable (ADR-006); outputs→Product (job input-only). **D6 resolved (user):** `print_jobs.stage` STORED (staff
drag-drop, finer than order status, Pet-Tag NFC stage later). print_jobs no emit-seam (admin-internal SSE slice 3).
`make verify-go` green; **9 jobs integration tests RAN vs real Postgres (colima)** + reversibility re-passes; guard
141 / osm 22; **no new deps**.
**PR-2g (config/reference) ✅ MERGED #18 → `main` `ffab5f8` (2026-06-26, squash; local main ff'd).** `000007_settings` (reply_templates + settings singleton [shop_info/bank_account VietQR/
shipping_rules/refund_policy] + `setting_bank_audit`) + `db/queries/settings.sql` + `internal/db/settings.go`
(`Settings` repo + `UpdateBankAccountTx` audit-on-commit seam). **Singleton** = `id boolean PK DEFAULT true CHECK (id)`
+ seed row. **Append-only DB-enforced** = row-level BEFORE UPDATE/DELETE **+** statement-level BEFORE TRUNCATE
triggers both RAISE (not just no-query — TRUNCATE hole caught by review). `setting_bank_audit.seq` (bigserial) =
deterministic newest-first. **refund_policy** per ADR-012 (NOT return_policy); NO e-invoice/tax cols (compliance §5).
vn-compliance loaded. `make verify-go` green; **6 settings integration tests RAN vs real Postgres (colima)** +
reversibility re-passes; guard 141 / osm 22; **no new deps**. **4-lens adversarial review wf_70129d8e: 7 confirmed /
5 refuted, all fixed** (2 IMPORTANT money-out: TRUNCATE-bypass + validate() null/`{}`/`[]`; ordering bound by seq).
**✅ SLICE 2 COMPLETE — all 7 sub-PRs 2a–2g MERGED → `main` `ffab5f8`.** **ĐANG Ở Slice 3 (HTTP/relay) — PLAN +
ADRs LOCKED, chưa code.** Plan `docs/plans/core-http-relay.md` (wf_48252601, 18 agents: 9 readers → 3 design angles →
3-lens judge → synthesis + completeness-critique) reconciled to **13 sub-PRs / 2 tracks**: relay `3a→3b` (NATS
substrate + drain loop) · contract/HTTP `3c-1→3c-2→3d→3e-1→3e-2→{3g,3h,3i,3k}→3j` (+ `3f` intake helpers independent).
**5 ADRs LOCKED in `decisions.md` (user-confirmed 2026-06-26): 029 relay (in-process goroutine · scan-pending-SET ORDER
BY seq, KHÔNG watermark/SKIP-LOCKED/advisory-lock per ADR-009 · publish→PubAck→mark) · 030 auth = SELF-ISSUED JWT
(user chose NOT Cloudflare-Access — `POST /auth/login`+bcrypt+`go-chi/jwtauth` httpOnly cookie · `users.password_hash`
migration 000009 · split 3e-1 login / 3e-2 verify+RBAC) · 031 OpenAPI hand-yaml single-source → oapi-codegen
**strict-server** + openapi-typescript (`packages/api-client`) · 032 error-envelope `{code,messageKey,fields?}` · 033
idempotency DEFERRED.** Migrations (ACTUAL, post-3e-1-landing-first): **000009** user_credentials (3e-1) · **000010**
order_code_seq (3f — plan said 000008 but 3e-1 merged out of plan order taking 000009; a 000008 would be silently
skipped on any DB already migrated to 9, so 3f renumbered to 000010) · **000011** dashboard_idx (3i, shifted).
Adversarial critique earlier caught a money-path BLOCKER (uniformly-public `POST /orders` lets
`channel=inbox` mint a born-PAID order w/o payment → fixed: inbox **staff-gated**) + added `3k` settings/STK endpoint
the data layer deferred to slice-3 RBAC. docs baseline committed `ecd06fa`.
**PR-3a relay substrate ✅ MERGED → PR #19 → `origin/main` `280e94b` (2026-06-27 11:30Z, squash; local `main` ff'd).**
`internal/natsx` (Connect/EnsureTopology/Reachable/Close) + config NATS/relay knobs + `getenvDuration` + main lifecycle
+ `/readyz` NATS check via `NATSStatus` iface; `nats.go` v1.48.0 PINNED (v1.52 forces go 1.25, like pgx). 4-lens review
wf_adea04ba (14→5 confirmed / 0 BLOCKER, all fixed: Docker-free non-fail-fast tests + convergence). guard 142.
**`3b` relay drain loop ✅ MERGED (PR #20) → `origin/main` `c3b2004` (2026-06-27, merge-commit; local `main` ff'd). RELAY TRACK 3a→3b COMPLETE.**
`internal/relay` (drain loop: `SelectPendingOutbox`→publishOne→await PubAck→markPublished; transient-vs-poison split;
panic-recovery; `isTransient` on real nats/jetstream v1.48 sentinels) + 4 outbox sqlc queries (scan pending-SET `ORDER BY
seq`, NO watermark/SKIP-LOCKED) + natsx `+PublishMsg`/`+ReEnsureOnReconnect` (topology-on-reconnect carry-over from the 3a
review) + main.go lifecycle (start relay goroutine, stopRelay cancel+join BEFORE nc.Close/pool.Close on both exit paths).
`make verify-go` green; **9 relay tests RAN vs real PG+NATS (colima, -race)** incl. the **late-low-seq watermark-loss
regression** + dedup-on-republish + no-stream→transient→recover + poison-quarantine; natsx+db no regression. **guard 144
(+2 relay ARM: scan-pending-SET rule lock + relay-start-in-main, both PROVEN binding mutate→RED→restore); osm 22.** REL-01/
REL-02 → `docs/acceptance.md` (EARS-lint pass). **No new deps** (reuse nats.go/pgx/uuid/testcontainers). Adversarial 5-lens
review wf_81c76244 (5 lenses → per-finding refute): **12 raw → 4 confirmed (0 BLOCKER) / 8 refuted, ALL 4 FIXED** — (IMPORTANT)
relay-start ARM grep didn't strip `//` comments → commented-out relay false-PASSED (now strips `//` + loosened `.Run(` so
ctx-rename không false-RED; re-proven: comment-out→RED, rename→GREEN, delete→RED); (NOTE) `time.NewTicker(poll)` panic ngoài
drainOnce recover → non-positive RELAY_POLL_INTERVAL crash cả process → `newRelay` clamp poll/batch/maxAtt≤0→default + test;
(NOTE) panic-recovery 0 coverage → `TestDrainPanicRecovered`; (NOTE) clamp test. guard giữ 144, relay test 9→11.

**`3c-1` OpenAPI contract authoring ✅ MERGED (PR #21) → `origin/main` `f1b35d2` (2026-06-27 23:45Z, squash; local `main` ff'd). (branch `feat/core-http-relay-3c-1` off `c3b2004`.)**
Head of the contract/HTTP track (unblocks 3c-2→3d→3e→{3g,3h,3i,3k}→3j). Hand-authored
`services/core-api/openapi.yaml` (OpenAPI **3.0.3**, slice-3 surfaces ONLY — auth/orders/transitions/dashboard/
settings-STK/reply-templates; NO catalog read DTOs per scope): nested `Order` DTO (not flat sqlc row) +
`CreateWebOrderInput`/`CreateInboxOrderInput` (oneOf+discriminator on `channel`; inputs OMIT unitPrice/total/subtotal
→ server-authoritative, always-must #2) + `TransitionRequest` + `ErrorEnvelope {code,messageKey,fields?}` (ADR-032) +
Settings/BankAccount{bin,accountNumber,accountName}/ReplyTemplate + DashboardSnapshot + cookieAuth securityScheme.
Money `integer,format:int64`; props camelCase. **4-way enum parity test** `internal/contract/parity_test.go` (yaml.v3
indirect→direct): OrderStatus/Channel/Role byte-identical across **OpenAPI == internal/order == packages/core Zod == PG
000001**; encodes the `system` asymmetry explicitly (actor **Role** {owner,staff,system} vs stored **UserRole**/PG
`user_role` {owner,staff}). spec-sync `spec.md §02` Review `text`→`body` (DB/Go already `body`). ADR-031 implemented (no
new ADR — landed `ecd06fa`). `make verify-go` green (golangci 0, sqlc vet+diff, `go test -race` incl parity); **guard
145** (+1 contract ARM: openapi.yaml→parity must reference all 4 sources, PROVEN binding missing→144/1); osm 22;
**parity PROVEN binding** (REFUNDED drift→RED→restore). **No EARS row** (contract-authoring, no runtime invariant).
**Adversarial 4-lens review wf_a95388f8-5d8: 3 confirmed (1 BLOCKER) / 4 refuted, all confirmed FIXED.** BLOCKER
(openapi lens, reviewer RAN oapi-codegen v2.5.1): inline `oneOf`+discriminator on `POST /orders` → oapi-codegen emits
an OPAQUE `union json.RawMessage` w/ unexported field + 0 methods → strict-server can't read the order payload → FIX:
extract into NAMED `CreateOrderInput` schema (+$ref) → **re-ran oapi-codegen: 10 union methods now (As*/From*/Merge*/
Discriminator/ValueByDiscriminator/Marshal/Unmarshal), exit 0**. NOTE optionIds→`format:uuid` (both item schemas).
NOTE contract ARM was presence-only → tightened (≥4 `Test*Parity` + `assertSame` + `order.Statuses`, PROVEN binding:
gamed-stub→144/1). Refuted (sound): trackingCode-→SHIPPING contract is intentional (plan §3h/D12) · Order.createdAt
deliberate superset · regex/literal can't false-pass (fail-safe). guard stays 145.

**`3c-2` codegen + `packages/api-client` scaffolding ✅ MERGED (PR #22) → `origin/main` `d10d30e` (2026-07-01 07:16Z,
squash; local `main` ff'd). CONTRACT/HTTP TRACK HEAD 3c-1→3c-2 COMPLETE.** Wires the contract → BOTH generated clients (ADR-031/§6 D8
strict-server), NO domain endpoints (that's 3d). **GO:** `internal/api/{oapi-codegen.yaml,gen.go}` (pin
`oapi-codegen@v2.5.1` in `//go:generate`) → committed `api.gen.go` (strict-server + chi-server; the named
`CreateOrderInput` union from the 3c-1 BLOCKER stays intact) + dep `github.com/oapi-codegen/runtime v1.1.2`
**PINNED** (v1.4.2 pulls x/crypto→go 1.24; **go directive stays 1.23.6** như pgx/nats) + `.golangci.yml` gen-exclude
(`generated:lax` + `paths: '.*\.gen\.go$'`) + `make verify-go` gains `oapi` target + `go generate ./internal/api/...`
+ `git diff --exit-code` stale-check. **TS:** NEW `@lumin/api-client` (openapi-typescript **7.13.0** → committed
`src/schema.gen.ts` + openapi-fetch **0.13.8** `createApiClient`, cookie-cred default per ADR-030) + DRY stale-gate
`test/schema.stale.test.ts` (regen via the shared `codegen.mjs` render fn → byte-equality) + `**/*.gen.ts`
eslint+prettier-ignore. **HARNESS:** guard oapi ARM (verify-go recipe PHẢI chứa CẢ `go generate …internal/api` VÀ
`git diff --exit-code…internal/api`; comment-strip nên verb bị `#`-comment không false-pass) **145→146**; D13
`docs/plan.md` acceptance-ledger checkbox ✅ ticked (parser pre-existed+passes+armed; Go REL-01/02 GIỮ `[ ]` cố ý —
parser chỉ resolve id TS). `make verify-go` rc=0 · `pnpm verify` rc=0 · guard **146** · osm 22; **cả 3 gate mới PROVEN
binding** (mutate→RED→restore). **Deps:** +oapi-codegen/runtime v1.1.2 +apapsch/go-jsonmerge/v2 (Go) +openapi-typescript
+openapi-fetch (TS). **4-lens review wf_58d3da06: 2 confirmed (0 BLOCKER · both NOTE) / 0 refuted, BOTH FIXED** —
(NOTE) guard ARM grep unanchored → `#`-commented verb false-passed (cùng class lỗ `//` của 3b) → strip comment lines
(hardened sibling sqlc ARM luôn), re-proven comment-out→RED; (NOTE) oapi-codegen.yaml comment mis-attached to no-op
`skip-prune` → moved rationale into `generate:` block + dropped the line. (1 review lens stalled/no-report — its
territory self-verified: go 1.23 preserved, golangci 0, CI go-1.23+network compatible.)

**`3d` HTTP foundation ✅ MERGED (PR #23) → `origin/main` `eac9b0f` (2026-07-01 09:29Z, squash; local `main` ff'd).
CONTRACT/HTTP TRACK 3c-1→3c-2→3d COMPLETE (keystone landed).** (branch `feat/core-http-relay-3d` off `main` `d10d30e`, now merged/stale.) The keystone the whole HTTP track funnels through (unblocks 3e→{3g,3h,3i,3k}→3j). Chose
**strict-server** wiring (ADR-031 D8): `internal/httpapi/{errors.go,server.go,stubs.go}` + rewired `router.go`. **errors.go**
= the ONE domain-error→(status,`api.ErrorEnvelope{code,messageKey,fields?}`) table (ADR-032): `*order.TransitionError`
reuses its code verbatim (INVALID_EDGE→409·RBAC→403·REASON/REFUND/PROOF_REQUIRED→422·INVALID_ACTOR/TIMESTAMP→400·unknown→422)
+ `db.Err*`/`money.ErrInvalidAmount`→404/422 + unmapped→500; `msgKey(code)="errors."+code` (code↔key can't drift; frontend
owns `errors` namespace, added 3j+). Two strict hooks REPLACE the oapi-codegen plaintext defaults (`http.Error(w,err.Error())`
would leak the Vietnamese `TransitionError.Message` — always-must #3): `handleResponseError` (maps domain err → envelope; logs
only genuine 500s server-side, NEVER forwards err.Error()) + `handleRequestError` (bind/decode fail → 400 VALIDATION, no raw
parser echo). **server.go** = `Server{logger,pool,nats}` (implements `api.StrictServerInterface`; `queries`/`authVerifier`
DEFERRED to 3g/3e to keep staticcheck unused-field clean) + `(*Server).readiness` method (moved from router free-func) +
`withTx(ctx,txBeginner,fn)` (Begin→fn→Commit, rollback on err/panic; `txBeginner` iface = Docker-free unit-testable, `*pgxpool.Pool`
satisfies). **stubs.go** = 8 not-implemented handlers (→501 NOT_IMPLEMENTED envelope) replaced per-endpoint by 3e–3k. **router.go**:
`NewStrictHandlerWithOptions(srv,nil,{Request/ResponseErrorHandlerFunc})` + **`HandlerWithOptions` w/ `ChiServerOptions.ErrorHandlerFunc`**
(nil StrictMiddlewareFunc slice = the auth-boundary seam 3e-2 fills). `NewRouter(logger,pool,nats)` signature UNCHANGED (existing readyz
tests stay green). **HARNESS:** guard **147** (+1 error-envelope ARM: errors.go landed → router must wire BOTH error seams
[strict `ResponseErrorHandlerFunc` + chi `ChiServerOptions`] + mapError must map TransitionError; PROVEN binding — rename-token→RED,
comment-out→RED, restore→green) + **fixed the pre-existing NATS-readiness ARM** (it pinned `router.go` but readiness moved to `server.go`
→ widened to grep httpapi prod files, `--exclude=*_test.go` + strip comments). **ERR-01** → `docs/acceptance.md` (Go-gated `[ ]`).
`make verify-go` rc=0 (golangci 0, sqlc vet+diff, oapi stale-check, `go test -race` incl httpapi) · guard **147** · osm 22 · TS
acceptance-ledger 17/17 (acceptance.md consumed) · Docker-free (no DB/NATS test). **No new deps · no new ADR** (implements ADR-032).
~300 lines non-test src (< 400 budget).
**5-lens adversarial review wf_f3cb8fbd: 10 raw → 5 confirmed / 5 refuted, ALL FIXED.** (IMPORTANT ×2, same defect two lenses)
`api.HandlerFromMux` left the CHI-wrapper `ErrorHandlerFunc` at oapi-codegen's plaintext default → `POST /orders/{non-uuid}/transitions`
returned `text/plain` `Invalid format for parameter id: …` (echo input + broke the ADR-032 JSON contract; param-binding fires BEFORE the
strict layer) → switched to `HandlerWithOptions` w/ `ChiServerOptions.ErrorHandlerFunc: srv.handleRequestError` + `TestBadPathParamReturns400Validation`
(proven backstop: revert→RED) + ARM now requires `ChiServerOptions`. (BLOCKER ×2, same, self-inflicted) the `ERR-01` row wrapped
`the system shall` onto line 2 → REC-18 EARS-lint is line-oriented → guard went 146/1 RED (I'd run guard BEFORE adding the row) → reflowed
onto one physical line. (NOTE) NATS ARM dir-grep could match tests/comments → hardened. Refuted (sound): ARM over-claim (param path never
carries the Vietnamese message), 501-not-in-contract (deliberate stubs), route-group-not-established (plan-sanctioned strict-server + auth
seam to 3e-2), 2× ARM-presence-only (backstopped by the real Go tests).

**`3e-1` auth self-issued login ✅ BUILT · verify green · 5-lens review DONE (4→3 confirmed/1 refuted, ALL FIXED) · chờ push→PR.
(branch `feat/core-http-relay-3e-1` off `main` `eac9b0f`.)** The critical-path head after 3d; unblocks 3e-2 (verify+RBAC) → the
whole handler fan-out. ADR-030 self-issued JWT. **User sub-decisions (AskUserQuestion): owner-seed = `make seed-owner` CLI
(pure-DDL migration, NO committed secret); token = 12h JWT, NO refresh.** Landed: migration **`000009_user_credentials`**
(`ALTER TABLE users ADD COLUMN password_hash text` NULLABLE — a credential-less user can't log in) + `UpsertOwnerCredential`
upsert-on-email (idempotent rotate) · **`internal/auth`** (`Issuer` HS256 via `go-chi/jwtauth/v5`; `Issue`→httpOnly+Secure+
SameSite=**Strict** cookie, token-in-cookie-only; `Clear`; `VerifyPassword` bcrypt **timing-equalized** w/ a dummy-hash compare
on the nil/unknown path → no user-enumeration; `HashPassword`) · **`internal/httpapi/auth.go`** `LoginUser`/`LogoutUser`
(lookup→bcrypt→mint; uniform 401 for unknown-email==wrong-password; 500-on-DB-fault no-leak) using the generated
`LoginUser200JSONResponse{Body,Headers.SetCookie}` (openapi Set-Cookie header now formal) · `cmd/seed-owner` + Makefile target ·
config `JWT_SECRET`/`JWT_TTL`(12h)/`COOKIE_SECURE`(true)/`ALLOW_DEV_JWT_SECRET` + **`UsesForgeableJWTSecret()` → main.go
FAIL-FAST** when the public dev secret would sign tokens without opt-in (money-out: forgeable owner → reconcile→PAID/STK). `users`
`SELECT *` auto-picks `password_hash` (sqlc `*string`). **Server** gained `auth *auth.Issuer` + `users userReader` seam
(Docker-free login unit tests via injected fake); `NewServer`/`NewRouter` +1 param (readyz tests pass nil). `make verify-go` rc=0
(golangci 0, sqlc vet+diff, oapi+sqlc regen committed, `go test -race`) · **guard 148** (+1 auth ARM PROVEN binding ×3: HttpOnly ·
bcrypt.CompareHashAndPassword · login VerifyPassword(nil) — each mutate→RED→restore) · TS api-client typecheck+stale-gate+lint green
(schema.gen.ts regen for Set-Cookie) · acceptance **Cụm 6 AUTH-01/02** (Go-gated `[ ]`) · docs/operations.md §4b (seed + env). **Deps:
+go-chi/jwtauth/v5 v5.4.0 (+lestrrat jwx/v3 tree), x/crypto v0.37→v0.38 indirect→DIRECT; go directive HELD 1.23.6.** **No new ADR**
(implements ADR-030). **5-lens adversarial review wf_eab30b50: 4 raw → 3 confirmed (0 BLOCKER, all IMPORTANT) / 1 refuted (README
out-of-scope), ALL FIXED** — (security) dev-secret Warn insufficient → FAIL-FAST + `ALLOW_DEV_JWT_SECRET` opt-in + `UsesForgeableJWTSecret`
predicate + config tests; (contract) openapi didn't formally declare Set-Cookie header → added `headers:` (regen'd api.gen.go typed
`Headers.SetCookie`, handler now consumes it, custom cookie-response types deleted) + TS schema regen; (spec-adr) operations.md
missing seed-owner docs → §4b. ~430 lines non-test src (auth is invariant-dense; plan budgeted 320, soft ≤400 — cohesive 1-axis).

> Lịch sử app-shell/backbone Phase-0 (storefront/admin/services scaffold) đã archive — xem `git log` + PR #5–#10.

**`3e-1` auth self-issued login ✅ MERGED (PR #24) → `origin/main` `0f665c4` (2026-07-01 15:33Z, squash; local `main` ff'd,
branch deleted).** Contract/HTTP track head 3c-1→3c-2→3d→3e-1 COMPLETE (auth ISSUE side landed).

**`3e-2` auth: JWT-verify middleware + RBAC + actor injection ✅ MERGED (PR #25) → `origin/main` `a442757` (2026-07-01,
squash; local `main` ff'd, branch deleted).** Fills the `StrictMiddlewareFunc` auth seam 3d left (`nil`
slice → now `[]api.StrictMiddlewareFunc{srv.authMiddleware}`); unblocks the whole handler fan-out {3g/3h/3i/3k→3j}. **One
strict-server middleware** branches on the generated operationID (`classify`): **fail-closed default** (unlisted op →
`authRequired`) · `authPublic` {LoginUser,LogoutUser} · `authOptional` {CreateOrder} (resolve iff cookie present, never
reject when absent — the web-create path; §3g still gates channel=inbox) · `authOwnerOnly` {UpdateBankAccount} = the
`requireOwner` STK edge. **`resolveActor`** verifies the cookie via new **`auth.Verify`** (HS256 sig + exp/nbf via
`jwtauth.VerifyToken`, returns `Claims{sub,role}`) → `uuid.Parse(sub)` → **`Identity.UserByID`** (new `GetUserByID` sqlc +
method; NO migration — users table exists) → **role from the DB row, NOT the token claim** (stale token can't outrank a
role change / deactivation; `!Active`→401) → `actorRole` maps user_role→`order.Role` **explicitly so it can NEVER yield
`system`** (server-internal actor, never a login identity). Injects `Actor{ByUser=users.id string, Role, At=server-clock}`
into ctx via unexported key (`actor.go`) — standardizes `statusHistory.byUser` on users.id string. **Does NOT re-implement
RBAC math** — domain guard (`order.RoleAllowed`/`Transition`) stays source of truth; mw only authenticates + gates the
owner-only settings edge. errors.go +`errUnauthenticated`→401 `UNAUTHORIZED` / +`errForbidden`→403 `FORBIDDEN` (+code
`FORBIDDEN`); DB-fault on lookup → raw err → 500 no-leak. Fixed pre-existing `TestDomainRouteReturns501Envelope` (dashboard
now gated → authenticate first via new `testAuthedRouter`). **`make verify-go` rc=0** (golangci 0, sqlc vet+diff, oapi
stale-check clean [no openapi change], `go test -race`) · **guard 149** (+1 auth-boundary ARM PROVEN binding: router wire
`StrictMiddlewareFunc{srv.authMiddleware}` non-nil + `auth.Verify` + `UserByID`; nil-wire→148/1→restore→149) · osm 22 ·
core ledger 43/43 (RBA-01 stays `[ ]` Go-gated). **RBA-01** → acceptance Cụm 7. **No new deps · no new ADR** (implements
ADR-030/032). ~190 non-test src. Docker-free unit + wire tests (nil pool); UserByID integration folded into
`TestUserRoundTrip` (skip-local/run-CI). **spec-guardian PASS: 0 BLOCKER/0 WARN/1 NOTE** (optional path 401s on a
present-but-BROKEN cookie vs treating anonymous — deliberate: `lumin_session` is admin-only SameSite=Strict, web customer
never carries it; locked by `TestAuthMiddlewareOptionalRejectsInvalidCookie`).

**`3e-2` auth boundary ✅ MERGED (PR #25) → `origin/main` `a442757` (2026-07-01, squash; local `main` ff'd).**
**`3f` order-intake prereqs ✅ MERGED (PR #26) → `origin/main` `7ab0159` (2026-07-02, squash; local `main` ff'd).**
`internal/pricing` (server-authoritative `PriceItem`/`ShippingFee`) + by-id catalog sqlc + customer find-or-create +
migration **`000010_order_code_seq`** (note: 3f's code-seq took **000010**, not the plan's 000008 — monotonic numbering
above main per memory; 3i dashboard_idx → next free number). Acceptance Cụm 8 `PRC-01/02`. **→ handler fan-out unblocked.**

**`3h` transition endpoints ✅ MERGED (PR #27) → `origin/main` `5fad85a` (2026-07-02, squash; local `main` ff'd).**
`POST /orders/{id}/transitions` — the RBAC-gated status-change endpoint.
`internal/httpapi/transition.go` (`TransitionOrder` handler) + `dto.go` (shared nested-Order assembler `toOrderDTO`/
`assembleOrderDTO`, reused by 3g) + `internal/db` `SetTrackingCodeTx` seam (+ `SetTrackingCode` sqlc query, **no migration** —
`orders.tracking_code` exists since 000005) + errors.go `errTrackingCodeRequired`→**422 `TRACKING_CODE_REQUIRED`**.
**Dispatch footgun (locked #9):** `to=PAID` → `ConfirmPaymentTx` (only `order.paid` emitter); every other edge →
`AdvanceStatusTx`. **Money-in owner-gate at the BOUNDARY:** `ConfirmPaymentTx` hardcodes `role=owner` so the domain guard
can't reject staff on reconcile → handler rejects `staff`+`to=PAID` with 403 *before* the tx (money-OUT →REFUNDED stays
gated by the domain guard via the actor's real role through AdvanceStatusTx). **SHIPPING:** requires non-empty
`trackingCode` (422 if missing) + `SetTrackingCodeTx` in the **same tx** as the flip (atomic — never SHIPPING w/o code;
QC-photo half deferred, §0). Actor (Role/ByUser/At) from ctx + server clock, never the body. Removed the `TransitionOrder`
501 stub. **guard 150→151** (+1 transition ARM PROVEN binding: `ConfirmPaymentTx` + `order.RoleOwner` + `SetTrackingCodeTx`
in transition.go). **acceptance Cụm 9 `PAY-01`/`SHP-01`** (Go-gated `[ ]`). **No new deps · no new ADR** (impl locked #9/§6 D12).
Tests: 6 Docker-free (staff-reconcile-403 · shipping-tracking-422 · missing-actor-401 · nil-body-400 · `toOrderDTO` full +
empty-optionals + malformed-ts) + 2 httpapi integration (PENDING→PAID→PRINTING→SHIPPING walk: exactly-one-order.paid + no
paid on non-money edges + tracking persist atomic + DTO assembly; invalid-edge→409/missing→404 envelope) + 1 db
`TestSetTrackingCode` — **integration RAN vs real PG (colima), all green**.

**AUTH BOUNDARY COMPLETE → handler fan-out unblocked {3g/3h/3i/3k→3j}.**

**`3g` checkout `POST /orders` ✅ BUILT (`df16b83` build + `4a3ff8f` review-fixes, branch `feat/core-http-relay-3g` off
`main` `5fad85a`) · post-build multi-lens review DONE · fixes applied · verify+integration(colima) green · guard 152 ·
spec-guardian PASS · **PR #28 OPEN · CI green (app-gates/selftest/services-gates) · chờ user merge-gate.**** `internal/httpapi/
checkout.go` CreateOrder strict handler behind optional-auth: ONE handler/mount branch on resolved actor (D2) · **inbox
staff-gate** (channel=inbox mints born-PAID → 403 unless actor — critique BLOCKER/CHK-05) · web CHK-04 `paymentProofUrl`
http(s)+host at boundary · ADR-012 ack+echo · **ADR-019 loud-reject** client unitPrice/subtotal/total/shippingFee → 400 ·
money via `pricing.PriceItem`+`ShippingFee`+`CalcTotals` · one tx FindOrCreateCustomer + GrantConsentIfAbsent (PDPL
order_fulfillment only) + NextOrderCode + `CreateOrderTx` (genesis + `order.created` publish-on-commit) · guest genesis
`ByUser="customer"`. **Post-build review `wf_4364e692-084` (6 money-path lenses × per-finding refute, 17 agents): 11 raw
→ 8 confirmed (ALL NOTE) / 0 BLOCKER / 0 IMPORTANT / 1 uncertain / 2 refuted — money authority + inbox-gate + PDPL +
tx-outbox atomicity ALL held.** Fixes (4 files): (①) `clientMoneyFields` now **case-folds** (`isMoneyKey`+`EqualFold`) —
`{"Total":…}`/`{"Items":[{"UnitPrice":…}]}` bypassed the exact-case reject (NO money impact — input DTO has no price
field, server re-prices — but fail-loud was weaker than doc'd) + regression test; (#6) `assembleOrderDTO` → free func
taking `sqlc.DBTX`; checkout assembles DTO **inside the write tx** so a post-write read failure rolls back instead of
committing an order the client is told failed (dup-on-retry, idempotency deferred §6 D5); 3h keeps post-commit `s.pool`
(unchanged); (#8) missing settings singleton → **logged 500** not unlogged client 404 (`%v` breaks ErrNotFound chain);
(#7 doc) `validate()` email `@`-check unreached (openapi_types.Email validates at decode → `fields:{body}`) — kept as
deliberate defense-in-depth per the existing test, doc made honest; (#3 doc) inbox no-actor stays **403** (acceptance
CHK-05 locks it — RBAC framing, POST /orders public for web) + reconciling comment vs actor.go generic "ok=false ⇒
unauth". No-action: #2 authOptional-401-on-broken-cookie (3e-2 already-adjudicated) · #5 policy_version-refresh (deferred
in-code) · #4 consent-clean · uncertain inbox-emits-`order.created`-not-`order.paid` (spec'd CHK-05, by-design).
`make verify-go` rc=0 (golangci 0, sqlc vet+diff, oapi stale-check clean [no openapi change], `go test -race`) ·
**integration RAN vs real Postgres (colima, -race):** web-end-to-end (assemble-in-tx path) · inbox-staff-born-PAID · 7
pricing rejections · transition walk (3h path unregressed) · guard **152** (3g ARM intact) · scratch verifier files
deleted. **No new deps · no new ADR** (implements ADR-019/017/012/030). **spec-guardian PASS: 0 BLOCKER / 0 WARN / 1 NOTE**
(3h transition.go:92 keeps post-commit `s.pool` assembly — out-of-scope, deliberate, lower-risk [no new row → no
dup-order hazard]; spec-guardian confirmed assemble-in-tx STRICTLY reduces the ADR-033 dup surface w/o weakening ADR-006:
the `order.created` outbox INSERT rolls back with the order). CHK-04/05 acceptance Cụm 10 `[ ]` (Go-gated).

**`3f` order-intake prerequisites ✅ BUILT · verify+integration(colima) green · spec-guardian PASS (renumber WARN fixed) ·
chờ push→PR. (branch `feat/core-http-relay-3f` off `main` `a442757`.)** Server-authoritative money building blocks feeding
the 3g checkout handler; NO HTTP layer. **`internal/pricing`** (NEW pkg): `PriceItem` derives per-line UnitPrice from
catalog (`product.BasePrice` + `color.PriceDelta` + Σ `option.PriceDelta`) — `Selection` input carries NO client price
(structurally can't trust a client total, ADR-019); validates color membership+`available`, option membership, duplicate
options, engrave text ≤ `option.MaxChars` (rune-counted, spec §05); overflow-checked. `ShippingFee` resolves fee from
`settings.shipping_rules` jsonb by province (exact or `"*"` wildcard, NO district ADR-017) → `ErrNoShippingRule`(→422 in 3g)
when none match, never silently 0. **db:** `GetProductByID`+`Catalog.ProductByID` (by-id intake read) · `NextOrderCode`
seam (`#LMN-%04d` via **`nextval('order_code_seq')`** minted in-tx, collision-free §6 D9) · `Identity.FindOrCreateCustomer`
(find-by-phone|insert; documented find-then-insert race = dup-customer not money-error) · `GrantConsentIfAbsent` (idempotent
PDPL consent via `ON CONFLICT` on the active partial-unique index — append-then-mark preserved). **Migration `000010`**
`order_code_seq` (`CREATE SEQUENCE START WITH 1000`). **spec-guardian WARN FIXED:** plan said 000008 but 3e-1 merged first
taking 000009 → a 000008 would be silently skipped by golang-migrate on an already-migrated DB → **renumbered 000008→000010**
(3i dashboard_idx shifts 000010→000011; plan.md updated). `make verify-go` rc=0 (golangci 0, sqlc vet+diff [+3 new queries
regen], oapi stale-check clean [no openapi change], `go test -race`) · **guard 150** (+1 order-intake ARM PROVEN binding ×3:
PriceItem derives BasePrice+PriceDelta · Selection has no client price field · NextOrderCode uses nextval — each
mutate→149/1→restore) · osm 22 · **integration tests RAN vs real Postgres (colima, -race):** ProductByID · NextOrderCode
(monotonic+unique+#LMN-1000) · FindOrCreateCustomer (idempotent by phone) · GrantConsentIfAbsent (idempotent) + reversibility
re-passes with the renamed migration · pricing unit+property Docker-free. **PRC-01/PRC-02** → acceptance Cụm 8 (Go-gated `[ ]`).
**~290 non-test src (< 450 budget → single PR, no 3f-1/3f-2 split). No new deps · no new ADR** (implements ADR-019/017; §6 D9/D10).
**spec-guardian PASS: 0 BLOCKER / 1 WARN (renumber, FIXED) / 1 NOTE** (find-or-create race, disclosed+accepted). **Contract-doc
drift left for user:** `decisions.md` ADR-033 still says "migration 000008" (non-normative aside; hard-blocked file → not
edited unilaterally; flag in PR).

**`3g` checkout ✅ MERGED (PR #28) → `origin/main` `3fb254e` (2026-07-02, squash; local `main` ff'd). Slice-3 fan-out continues.**

**`3i` dashboard aggregate ✅ MERGED (PR #29) → `origin/main` `c7ca0bc` (2026-07-02, squash). `GET /admin/dashboard`: net-revenue
anchored on `payment_confirmed_at` (đã-từng-PAID; giữ CANCELLED-sau-PAID, loại REFUNDED — spec §04, KHÔNG `status IN` ngây thơ) +
`hcmDayBounds` (Asia/Ho_Chi_Minh UTC+7 `[start,end)`) + migration `000011_dashboard_idx`; guard 153 (dashboard ARM); DASH-01
acceptance Cụm 11.**

**`3k` admin settings/STK ✅ BUILT · verify+integration(colima) green · guard 154 · adversarial review DONE + fixes applied ·
spec-guardian PASS (0 BLOCKER/0 WARN/2 NOTE) · **MERGED origin/main (3i #29) INTO branch → PR #30 updated (regular push, NO force-push
per user boundary)**. (branch `feat/core-http-relay-3k`, base `main` `c7ca0bc` [3i]).**
**Merge note: PR-3i (#29) merged to main mid-flight → conflict on stubs.go/acceptance.md/guard.test.sh. Resolved: `stubs.go`
**DELETED** (all 8 handlers now implemented — 3i's GetDashboard + 3k's 3 settings); STK-01 renumbered **Cụm 11→Cụm 12** (3i took
Cụm 11 = DASH); guard keeps BOTH ARMs → **154**. Chose a merge commit (not rebase) because a rebase would need a force-push (denied);
verify-go + guard + integration re-run green on the merged tree (byte-identical to the resolved tree).**
**spec-guardian 2 NOTE (both non-blocking, no action — server-authoritative fail-closed): (1) openapi `BankAccountUpdate` stays
loose vs stricter server validate — "server-stricter-than-contract is the safe direction, every rejection returns the DECLARED
400"; add `pattern`/`minLength`/`maxLength` là follow-up khi 3j TS-client thực sự tiêu thụ (no consumer yet). (2) `db.ErrInvalidBankChange→422`
là defense-in-depth STRUCTURALLY UNREACHABLE từ handler này (cleanBankUpdate + uuid.Parse đảm bảo input hợp lệ trước UpdateBankAccountTx)
→ undeclared 422 không bao giờ ra wire; sound as written.**
**Review wf_929df5a0-540 (5 money-out lenses × per-finding refute + completeness critic, 12 agents): 3 raw → 0 confirmed / 3
refuted (money-authority + owner-gate + field-integrity all held). Critic surfaced 3 net-new: (IMPORTANT) `isDigits` accepts
any-length digit string but a napas BIN is EXACTLY 6 digits → a fat-fingered/nonexistent numeric BIN would be stored → misrouting
QR → FIXED (`cleanBankUpdate` now `len(bin)==6`+digits, accountNumber digits ≤19 + boundary tests); (NOTE) handler validated body
[400] before owner re-assert [403] → FIXED (authz-FIRST reorder — no per-field leak in the classify-regress path); (NOTE)
append-only untested → REFUTED (PR-2g `db.TestBankAuditAppendOnly` already covers UPDATE/DELETE/TRUNCATE-blocked).** The owner-only
config surface the data layer deferred "to slice-3 RBAC". `internal/httpapi/settings.go`: **GetSettings** (admin-gated read,
jsonb→typed DTO, missing-singleton→logged 500 not 404) + **UpdateBankAccount** (PATCH bank-account, owner-only) +
**ListReplyTemplates**. Money-out STK change (authz FIRST): `actorFrom`→401 if absent → **owner re-assert** (`actor.Role !=
order.RoleOwner → 403` defense-in-depth: classify()→authOwnerOnly gates ở biên, but STK is the single highest-value money-out field
so the handler re-asserts — a classify() regress can neither let staff rewrite it NOR leak field-shape detail) → `cleanBankUpdate`
field-shape validate (**bin đúng 6 napas digits**, accountNumber digits ≤19, accountName non-empty → 400 per-field loud-reject) →
`changedBy` from **actor ctx (users.id), never body** → `withTx` + **`db.UpdateBankAccountTx`** (column +
setting_bank_audit row **one tx**, audit-on-commit — conventions §57). **Prior session left 3 duplicate stubs in `stubs.go`
(compile blocker) → removed (GetDashboard/3i the last stub).** No openapi/sqlc change (contract authored in 3c-1; DTOs/req-objects
already generated) → oapi+sqlc stale-checks clean. **guard 152→153** (+1 settings ARM PROVEN binding ×3: `UpdateBankAccountTx` +
`order.RoleOwner` + `actorFrom` — each mutate→152/1→restore). **`STK-01`** → acceptance Cụm 11 (Go-gated `[ ]`). **No new deps ·
no new ADR** (impl conventions §57/ADR-012/domain-core RBAC). Tests: 4 Docker-free unit (`TestCleanBankUpdate` field-shape ·
`TestUpdateBankAccountRejectsNonOwner` staff→403 · `TestSettingsDTODecodesJSONB`/`EmptyJSONB` · `TestReplyTemplatesDTO`) + 3 httpapi
integration RAN vs real PG (colima, -race): `TestUpdateBankAccountEndToEnd` (column+audit atomic, changed_by from ctx, GetSettings
reflects) · `TestGetSettingsSeededDefaults` · `TestListReplyTemplatesEndToEnd` (ORDER BY title). colima was ALREADY running (prior
session) — used as-is, left running.

## Next steps (1–3)

> **✅ 2026-07-03 — CORE BACKBONE COMPLETE + PHASE 1 STARTED (supersedes the 1–3 below).** The entire "Core · Data
> model + OrderStatus" phase is on `main` (Slice 1 spine · Slice 2 data · Slice 3 HTTP/relay; PR-3j = last, #31).
> **Housekeeping closed → PR #32 MERGED (`origin/main` `67a3b3d`):** testcontainers ARM `//`-hole hardened + ADR-033
> "000008"→"000010" fixed via the contract-edit valve. Local `main` ff'd to `67a3b3d`.
> ⏳ **Branch prune still OWNER-ONLY** (guard-bash + auto-classifier block destructive git — squash-merges aren't
> ancestors so `-d` refuses and `-D` is blocked): owner runs `git branch -D` (23 local) + `git push origin --delete`
> (16 remote); all map to MERGED PRs #1–#32 (verified by PR#, commands handed off in chat).
>
> **NEXT = Phase 1 · Storefront.** Plan PERSISTED → `docs/plans/phase-1-storefront.md` (wf_d4c5772c-9b4; 19 sub-PRs
> P1-a..s, risk-first spine). Locked decisions (user 2026-07-03): **D-P1-1** drop `productType` · **D-P1-2**
> `POST /price/quote` server-authoritative · **D-P1-3** full scope (reviews + FTS no-dấu + customer accounts).
> Storefront still Phase-0 shell (`apps/storefront` renders `lib/demo-products.ts`); backend catalog READ endpoints
> didn't exist (slice-3 cut them) → building in core-api first (tables/sqlc exist PR-2c/2d).
>
> **✅ PR-P1-a (contract anchor · `GET /products/{slug}`) — MERGED → PR #33 → `origin/main` `ca78f33` (2026-07-03, merge-commit; local `main` ff'd). spec-guardian PASS (0 BLOCKER/0 WARN/1 NOTE).**
> Branch `feat/phase-1-storefront-p1a` off `main` `67a3b3d` (commit 1 = plan doc `49dafda`, commit 2 = impl `322759f`). Adds the public
> storefront catalog read: OpenAPI Product/Color/Option/Dimensions/ProductStatus/OptionType (**no productType**, v0.4.0)
> → regen Go+TS · `internal/httpapi/products.go` handler (active-only, **uniform 404 non-leak** for unknown/draft/archived,
> raw int-VND, classify `authPublic`) reusing `GetProductBySlug`/`ListColorsByProduct`/`ListOptionsByProduct` (no new sqlc
> query) · unit(DTO)+integration(real-PG full public-router)+public-classify+parity(OpenAPI↔Postgres) tests · **CAT-01 ARM**
> + Cụm-13 EARS row (Go-gated `[ ]`). `make verify-go` GREEN (race + integration vs colima PG) · api-client typecheck+schema-stale ·
> **guard 155 / osm 22** (last-green 2026-07-03, race+integration vs colima PG). **MERGED → PR #33 → `ca78f33`; local `main` ff'd.** Open Q's deferred to their PRs
> (plan §6): caching (P1-c/h) · customer-auth mechanism + BLOCKER-2 credentials migration >000011 (P1-r) · sprite source
> (P1-i) · re-read `designs/Lumin Storefront - Hi-fi.dc.html` before FE PRs (P1-f+, plan §7 debt).
>
> **✅ PR-P1-b (`POST /price/quote` · server-authoritative line pricing) — MERGED (PR #34) → `origin/main` `b616b1c` (2026-07-03, merge-commit; local `main` ff'd). spec-guardian PASS (0/0/0).**
> Thin HTTP wrapper trên `pricing.PriceItem` (PRC-01 sẵn có) — KHÔNG thêm math miền. OpenAPI `POST /price/quote` +
> `PriceQuoteInput{items[≤50]}`/`PriceQuote{lines,subtotal}`/`PriceQuoteLine{unitPrice,quantity,lineTotal}` (reuse
> `OrderItemInput` → no client price; reuse BadRequest/Unprocessable+ErrorEnvelope → **no new enum, parity_test
> KHÔNG đổi**) → regen Go+TS. `internal/httpapi/price.go`: `QuotePrice` mirror checkout `priceLine` (ProductByID +
> Colors/OptionsByProduct → PriceItem → guarded `money.CalcTotals`), pure `priceQuoteLine`+`quoteSubtotal` (test
> money Docker-free), non-active/unknown → **422 PRODUCT_UNAVAILABLE** non-leak, `classify QuotePrice→authPublic`.
> **line/subtotal ONLY (no shipping/address/tax), int-VND thô, messageKey không raw text, zoneId free-form (§5 DROP).**
> **USER-CONFIRMED (2026-07-03):** KHÔNG loud-reject client money keys (khác checkout `clientMoneyFields`) — DTO không
> có trường giá + response CHÍNH LÀ giá authoritative → không có divergence bền. **Adversarial review wf_1102fae9
> (5-lens → refute-by-default verify): 7 raw → 0 auto-confirm; tự phân xử 4 fix split-verdict** — (IMPORTANT)
> `maxItems:50` + runtime 400 (public unbounded-items DoS: 3 DB read/line, chưa có edge rate-limit) · (IMPORTANT)
> tách `quoteSubtotal` + test cross-line-overflow GIẾT mutant naive-Σ · (NOTE) `PriceQuoteLine` desc hết over-claim
> product (positional index mapping ghi rõ) · (NOTE) pre-DB reject tests (nil/empty/over-cap). Từ chối: per-request
> memoization (moot sau cap) · qty>MaxInt32 checkout-parity (không divergence tiền, plan không mandate). `make
> verify-go` GREEN (golangci 0, oapi stale-check clean, `go test -race` — **httpapi integration RAN vs colima PG**:
> `TestQuotePriceEndToEnd` + 6 rejection subtests, KHÔNG skip) · `pnpm verify` + api-client typecheck · **guard 155 /
> osm 22** (last-green 2026-07-03). **QTE-01 acceptance Cụm 14 `[ ]` (Go-gated).**
>
> **✅ PR-P1-c (`GET /products` · public catalog LIST) — MERGED (PR #35) → `origin/main` `7fcbd3e` (2026-07-03, merge-commit; CI green app-gates/selftest/services-gates; local `main` ff'd).** (branch `feat/phase-1-storefront-p1c` off `main` `b616b1c`.)
> **spec-guardian PASS (0 BLOCKER/0 WARN/1 NOTE** — clamp `maxCatalogOffset` cố ý). **Adversarial 17-agent review
> wf_4c60df42 (5 lens × per-finding refute + completeness critic): 1 raw → 0 confirmed / 1 refuted; critic 4 gap ĐÃ FOLD**
> — (IMPORTANT) `?category=` rỗng im lặng trả trang rỗng (footgun FE "All") → `normalizeFilter` coi ''→bỏ lọc = tất cả;
> (NOTE) `?sort=` rỗng → newest (đối xứng, hết bất-nhất vs category); (NOTE) test `q` reserved 200+ignored; (NOTE) test
> 304 Cache-Control + doc ETag "tiết-kiệm-bandwidth-không-phải-origin-compute" (edge cache = P1-f). User (2026-07-03)
> chọn **P1-c làm bước kế** (critical path — mở khoá cả FE track P1-f→g→h) +
> caching **"Decide during P1-c"**: ship ETag + `Cache-Control` provisional **package const**, hoãn chiến lược ISR/purge
> sang **P1-f** (nơi caching thực sự sống). OpenAPI `GET /products` (v0.5.0): `ProductCard`/`ProductList` (card projection
> — KHÔNG colors/options/description → **no N+1**) + param `category`(slug) / `sort`(WHITELIST newest|price_asc|price_desc|
> rating) / `page` / `pageSize`(≤48) / `q`(**RESERVED**, ignore tới P1-e) / `If-None-Match` header · resp 200(+ETag+
> Cache-Control)/**304**/400 → regen Go+TS. **NO new domain enum** (`GetProductsParamsSort` là query-param enum, KHÔNG
> chạm 4-way parity). sqlc `ListActiveProducts` (**active-only tại SQL WHERE** — hàng ẩn draft/archived KHÔNG rò; category
> qua **uncorrelated subquery**; sort qua **WHITELIST-CASE** — không đưa text client thô vào ORDER BY; `created_at DESC,
> id DESC` = total order ⇒ paginate ổn định) + `CountActiveProducts` (cùng WHERE; skew list/count cosmetic, KHÔNG phải
> tiền). `internal/db.ListActiveProductCards`. Handler `GetProducts` (classify **authPublic**): `pageParams`/`sortParam`
> chặn shape (pageSize>48 / page<1 / sort lạ → **400 VALIDATION** — oapi-codegen KHÔNG enforce min/max) + `maxCatalogOffset`
> guard chống tràn int32 OFFSET (page-quá-xa → trang rỗng, không lỗi) + `weakETag` (W/ hash body — đổi khi giá/stock/rating/
> thứ-tự đổi) + `ifNoneMatch` (RFC 9110 weak-compare + `*` + comma-list) → 304 body-less. `productCardsDTO` images empty→
> `[]` không null; ảnh JSONB hỏng **hard-fail 500** (nhất quán detail). **NO migration** (catalog nhỏ made-to-order → chưa
> cần index). Money `basePrice` int-VND thô (always-must #2). **NO new dep · NO new ADR.** **Gates:** `make verify-go`
> GREEN (golangci 0, sqlc vet/diff, oapi stale-check, `go test -race` — **httpapi+db integration RAN vs colima PG**:
> active-only non-leak · sort price/rating-nulls-last · category filter · paginate ổn định · far-page overflow · 304 · DoS
> cap) · api-client typecheck+stale-gate+lint · core ledger 31/31 · **guard 156** (+1 **CAT-02 ARM PROVEN binding ×3**: SQL
> `status='active'` filter · `maxPageSize` · classify `GetProducts` authPublic — mỗi mutate→155/1→restore) · osm 22 ·
> **CAT-02** acceptance Cụm 13 `[ ]` (Go-gated).
>
> **✅ PR-P1-d (`GET /categories` · public category LIST) — MERGED (PR #36) → `origin/main` `77b51e0` (2026-07-03, merge-commit; local `main` ff'd).** (branch `feat/phase-1-storefront-p1d` off `main` `7fcbd3e` [P1-c].)
> The catalog-browse chips feed (unblocks FE P1-g).
> New sqlc `ListCategories` + `Catalog.Categories`; OpenAPI `0.5.0→0.6.0` (`Category{id,slug,name}` + `GET /categories`
> public, 200 **bare array** + weak `ETag`/`Cache-Control`, `If-None-Match`→**304**) → regen Go+TS. Handler
> `internal/httpapi/categories.go` `GetCategories` reuses `weakETag`/`ifNoneMatch`/`catalogCacheControl` (một hình caching
> chung với `/products`, chốt ISR/purge ở P1-f) + `categoriesDTO` (empty→`[]` không null); classify `GetCategories`→**authPublic**.
> **NO migration** (categories table sẵn từ 000003) · **NO new enum** (parity_test KHÔNG đổi) · **NO new dep · NO new ADR.**
> **User-confirmed 2026-07-03 (AskUserQuestion): browsable-only** — `ListCategories` scope theo category-có-≥1-hàng-`active`
> (`WHERE EXISTS ... status='active'`), CÙNG non-leak-tại-SQL của CAT-01/02: category chỉ-chứa-draft/archived (products
> default `draft`, `category_id` NOT NULL) hoặc rỗng KHÔNG surface → hết dead-end chip + hết rò tên category chưa-phát-hành.
> **Gates:** `make verify-go` GREEN (golangci 0, sqlc vet/diff, oapi stale-check, `go test -race`) · api-client
> typecheck+stale+lint · **guard 156→157** (+1 **CAT-03 ARM PROVEN binding ×2**: classify authPublic [flip→RED] · ListCategories
> `EXISTS status='active'` scope [strip→RED] — mỗi mutate→156/1→restore) · osm 22 · **integration RAN vs colima PG (-race):**
> no-categories→`[]` · draft-only/empty categories→still `[]` (non-leak) · browsable-only name→slug order (hidden excluded) ·
> 304 + wrong-etag→200. **CAT-03** acceptance Cụm 13 `[ ]` (Go-gated). **Reviews:** spec-guardian **PASS 0/0/0**; adversarial
> 5-lens wf_b771e647 (per-finding refute + completeness critic, 6 agents): **0 lens-confirmed / 0 refuted**; critic 2 NOTE →
> **comp-1 (transitive draft-leak) FIXED** via browsable-only above; **comp-2 (no result-size bound) ACCEPTED-documented**
> (categories admin-curated, no user-generated path, near-static — rationale in `ListCategories` comment; EXISTS scope tightens
> it further). **NEXT sau P1-d:** P1-n `/orders/lookup` · rồi FE **P1-f** (home grid) → P1-g → P1-h.
>
> **✅ PR-P1-n (`GET /orders/lookup` · public guest order lookup) — MERGED (PR #37) → `origin/main` `c8f9b28` (2026-07-03, merge-commit; CI green app-gates/selftest/services-gates; local `main` ff'd).** (branch `feat/phase-1-storefront-p1n` off `main`
> `77b51e0` [P1-d].) Last BE read endpoint before the FE track.
> **User-confirmed 2026-07-03 (AskUserQuestion):** rate-limit = **in-memory x/time/rate per-code token-bucket** · **declare 429 +
> `RATE_LIMITED`** in contract · DTO = **status+tracking+date** · **DROP failure-lockout** (post-review) + **new ADR-034**. Grounded by a
> 6-reader research sweep (wf_8ee0db04). **OpenAPI 0.6.0→0.7.0:** `GET /orders/lookup` (operationId `lookupOrder`, **no `security:` key**
> = public like getProducts) + `PublicOrderTimeline{code,status,milestones[{status,at}],trackingCode?,createdAt}` + `OrderMilestone`
> (reuse parity-locked `OrderStatus` enum → **NO new enum, parity untouched**; NEVER `$ref` internal Order/Customer/StatusEvent) +
> `TooManyRequests`(429) → regen Go+TS (staged). **Handler `internal/httpapi/lookup.go`** (classify `LookupOrder`→**authPublic** + parity
> map): per-code `s.lookup.allow()` gate BEFORE any DB → 429 (+Warn log for ops); `Orders.ByCode` + `Identity.CustomerByID` (reuse proven
> queries, `status_history` override intact — **NO new SQL/migration**); **`subtle.ConstantTimeCompare`** on phone + **dummy-compare on the
> code-miss path** (AUTH-01; comments now honest that the DB-read-count residual is NOT timing-equalized — resistance rests on identical
> 404 body + rate-limit + WAF + sequential-codes-are-low-value); **uniform `db.ErrNotFound`→404** unknown-code == phone-mismatch (byte-
> identical); length-guarded `normalizePhone` (0xxx/+84xxx/bare-84-NSN → 9-digit) + `normalizeLookupCode`; `publicTimelineDTO` whitelist
> (drops byUser/reason/PII/money/proof; ADR-032). **`internal/httpapi/ratelimit.go`** (NEW, first in-process limiter): in-memory per-code
> `golang.org/x/time/rate` bucket + lazy TTL-sweep (bounded map) — **NO failure-lockout** (ADR-034: codes are sequential → a per-code
> lockout, checked before the phone, lets an attacker 429-lock the real owner out of their own order; the bucket alone makes brute-force
> infeasible); injectable clock; **package-const defaults, env-knobs DEFERRED to P1-o** (poll cadence open, plan §6.6). `errors.go`
> +`codeRateLimited`/`errRateLimited`→**429**. **Deps:** `golang.org/x/time` promoted indirect→**direct** (already in go.sum, **NO new
> module download**); **go directive HELD 1.23.6.** **Reviews:** spec-guardian **PASS 0/0/1** (timing-comment NOTE → fixed); adversarial
> 17-agent 6-lens wf_4ef2b511 (per-finding refute + completeness critic): **1 CONFIRMED IMPORTANT** (owner-lockout DoS → FIXED by dropping
> the lockout, user-approved) / 8 refuted; **critic gaps folded:** router-level 429-envelope test · REFUNDED-milestone non-leak test ·
> limiter concurrency test (-race) · normalizePhone bare-84 edge + test · honest timing/missing-customer comments · ops Warn log · ADR-034.
> **Gates (last-green 2026-07-04):** `make verify-go` rc=0 (golangci 0, sqlc vet/diff, oapi stale-check, `go test -race` incl parity) ·
> api-client typecheck+`schema.stale`+lint · **guard 157→158** (+1 **LKP-01 ARM PROVEN binding**: `subtle.ConstantTimeCompare` · uniform
> `db.ErrNotFound` · `s.lookup.allow` · classify authPublic — mutate→157/1→restore, re-proven post-fix) · **integration RAN vs colima PG
> (-race):** found→timeline · +84 normalize · unknown==wrong-phone byte-identical 404 · NON-LEAK whitelist · trackingCode after SHIPPING ·
> **REFUNDED milestone drops reason/refundProofUrl**; full httpapi+db+contract green. **LKP-01** acceptance **Cụm 15** (Go-gated `[ ]`).
> **ADR-034** (guest-lookup rate-limit: per-code token-bucket, no per-IP, no lockout) + conventions §Bảo mật line updated (via ADR-022
> valve, user-approved). ⚠️ auth-adjacent path — owner review từng dòng trước merge.
>
> **✅ PR-P1-e (`GET /products?q=` · no-accent full-text search, ADR-016) — MERGED (PR #38) → `origin/main` `77e2a2a` (2026-07-04, merge-commit; CI green app-gates/selftest/services-gates; local `main` ff'd).** (branch `feat/phase-1-storefront-p1e` off `main` `c8f9b28` [P1-n].)
> Wires the `?q=` param declared-but-reserved since P1-c — **additive, KHÔNG mở lại contract shape** (chỉ đổi description + thêm
> `maxLength:100` cho param `q`; **NO new enum → parity_test KHÔNG đổi**). **Migration `000012_product_search`** (head 000011, 000008 skip
> → 000012 monotonic): `CREATE EXTENSION unaccent` + **`immutable_unaccent(text)`** (IMMUTABLE wrapper `unaccent('unaccent',$1)` +
> **`translate(…, 'đĐ','dd')`** vì đ/Đ U+0111/U+0110 là chữ-gạch KHÔNG phân rã Unicode → shipped rules không fold "đèn"→"den"; translate
> tường minh, idempotent) + **functional GIN index** `products_search_idx` (KHÔNG cột `search_tsv` → `sqlc.Product`/`SELECT *`/parity
> UNTOUCHED — zero blast radius). Query: `@search` narg ANDed **TRONG** `ListActiveProducts`/`CountActiveProducts` (giữ `status='active'`
> → search KHÔNG leak hàng ẩn) qua `plainto_tsquery('simple', immutable_unaccent(...))` (parameterized, KHÔNG nội suy); count cùng filter →
> envelope `total` phản ánh tập đã-tìm. Handler `searchParam` (""/space→nil=bỏ tìm; trim; **rune-count > `maxSearchLen`=100 → 400**);
> **sort/paginate/ETag KHÔNG đổi** (ETag hash body → tự khác theo q); **KHÔNG relevance-rank** (catalog nhỏ, tránh mở contract sort enum).
> **Gates (last-green 2026-07-04):** `make verify-go` rc=0 (golangci 0, sqlc vet/diff, oapi stale-check, `go test -race`) · api-client
> typecheck+`schema.stale`+lint · core ledger 34/34 · **guard 158→159** (+1 **CAT-04 ARM PROVEN binding ×2**: `plainto_tsquery` strip→RED ·
> `maxSearchLen` rename→RED — mỗi mutate→158/1→restore) · osm 22 · **integration RAN vs colima PG (-race):** `TestGetProductsSearch` 7
> subtest (đ-fold "den"→"đèn" · accented==no-accent · tone-mark "may"→"mây" · multi-word AND · description-searched · +category AND +
> no-match→trang rỗng · ETag khác theo q) + `TestMigrationsReversible` (000012 up+down sạch, unaccent trong postgres:16-alpine) + list
> q-filter subtest (draft excluded). **CAT-04** acceptance Cụm 13 `[ ]` (Go-gated). **operations.md §4c** (unaccent = điều kiện migrate;
> role cần quyền CREATE EXTENSION / pre-create nếu role hạn chế; REINDEX nếu đổi từ điển). **NO new dep · NO new ADR** (implements ADR-016).
> **Reviews:** spec-guardian **PASS 0/0/0** (7 checks: money/parity/ADR-016/non-leak/i18n/migration-numbering/additivity; REC-05 no-test-weaken + REC-16
> no-special-case xác nhận). Adversarial 6-lens wf_26e7d75f (per-finding refute + completeness critic, 10 agents): **3 raw → 0 confirmed / 3 refuted**
> (test-quality nitpicks: reversibility-fn-check redundant, seed-dependency covered by 2nd test, inline-block-comment ARM gap low-risk) + **3 critic
> NOTE gaps ALL FIXED:** (①) malformed-UTF-8 `?q=%ff` → 500 → **`utf8.ValidString` guard → 400** (+ test); (②) down.sql `DROP EXTENSION` broken cho
> restricted-role/pre-created deploy (privilege-asymmetric + destructive) → **bỏ DROP EXTENSION, chỉ xoá function+index nó own** (+ operations.md §4c
> rollback note; reversibility re-passed); (③) index-expr byte-identity chưa có gate → **CAT-04 ARM (d) grep -F to_tsvector expr ở CẢ catalog.sql + migration
> 000012** (PROVEN binding: desync migration→158/1→restore). guard giữ 159 (ARM mạnh hơn, không +count).

> **🔨 PR-P1-l (`GET /products/{slug}/reviews` · public product reviews, published-only) — BUILT · reviews DONE + 2 NOTE fixes applied ·
> verify-go+integration(colima)+TS gates GREEN · guard 159→160 · REV-01 ARM PROVEN binding · spec-guardian PASS 0/0/0 · committed `a12fb5f` ·
> pushed → PR #39 OPEN · chờ user merge-gate.**
> (branch `feat/phase-1-storefront-p1l` off `main` `77e2a2a` [P1-e].) The reviews BE endpoint the plan §2 defers to P1-l; unblocks FE P1-m.
> **Contract:** openapi `GET /products/{slug}/reviews` + schemas `Review`/`ReviewReply`/`ReviewList` (money-free; camelCase; weak-ETag+304 như
> catalog reads) → BOTH clients regen (`api.gen.go` + TS `schema.gen.ts`). **NO new enum → parity_test UNTOUCHED. NO new migration** (reviews
> table exists since 000003). **Data:** `ListReviewsByProduct` + `CountPublishedReviewsByProduct` — **published-only filter tại NGUỒN SQL**
> (`WHERE status='published'`, cùng non-leak `status='active'` của catalog; hidden review KHÔNG bao giờ phục vụ) + **projection bỏ `customer_id`**
> (không PII người đánh giá ra wire — PDPL) → `Catalog.ListPublishedReviews`. **Handler `reviews.go`:** resolve slug→ACTIVE product first (slug lạ
> HOẶC nháp/lưu-trữ đều **404 đồng nhất** — reviews sản phẩm ẩn không phục vụ, không probe catalog, cùng lẽ GetProductBySlug); newest-first;
> `pageParams`/`weakETag`/`ifNoneMatch`/`catalogCacheControl` reuse; `classify GetProductReviews=authPublic`. **`reply` = nullable `{body,at}`
> forward-contract cho P1-m** (chưa có write path Phase-1). **NO `sort` param Phase-1** (newest-only — deliberate scope-tightening vs GetProducts;
> additive sau nếu design cần). **Design calls (deliberate, spec-guardian-confirmed):** no reviewer identity on wire · reply forward-contract · sort dropped.
> **Gates (last-green 2026-07-04):** `make verify-go` rc=0 (golangci 0, sqlc vet/diff, oapi stale-check, `go test -race`) · api-client
> typecheck+`schema.stale`+lint · **guard 159→160** (+1 **REV-01 ARM PROVEN binding**: drop `status='published'`→159/1→restore) · osm 22 ·
> **integration RAN vs colima PG (-race):** `TestGetProductReviewsEndToEnd` (published-only-hidden-NEVER-served · newest-first · **5-row id-DESC
> tiebreak walk PROVEN load-bearing** [drop `,id DESC`→RED→restore] · empty→`[]`-not-404 · unknown==draft-slug uniform-404 · ETag→304 · pageSize>48→400)
> + Docker-free unit (`reviewsDTO` null/empty/corrupt-jsonb + **allowlist** no-author-identity + pre-DB 400). **REV-01** acceptance Cụm 16 `[ ]` (Go-gated).
> **Reviews:** spec-guardian **PASS 0/0/0**. Adversarial 5-lens wf_47351c57 (per-finding refute + completeness critic, 11 agents): **5 raw → 2
> confirmed (both NOTE) / 3 refuted; both NOTE FIXED:** (①) id-DESC tiebreak unexercised (distinct seed created_at) → **5-row identical-created_at
> full-walk test, PROVEN binding**; (②) no-author-identity was a name-BLOCKLIST (vacuous for unlisted PII) → **exact-key ALLOWLIST** (any new field→RED).
> **NO new dep · NO new ADR** (implements the CAT-01/CAT-02 non-leak stance + ADR-032 envelope).

> **🔨 PR-P1-f (FE TRACK HEAD · wire `@lumin/api-client` + swap home grid demo→live `GET /products` + on-write cache purge) — BUILT ·
> spec-guardian PASS 0/0/3 · adversarial 5-lens review DONE (4 confirmed/11 refuted) · all fixes applied · pnpm verify + guard GREEN · chờ commit→push→PR.**
> (branch `feat/phase-1-storefront-p1f` off `main` `269f067` [P1-l #39] — moved OFF `feat/…-p1l` per spec-guardian branch-hygiene NOTE so the diff is P1-f-only.)
> **FIRST FE PR of Phase 1** — pivots BE→FE. All 7 storefront read endpoints (P1-a/b/c/d/e/l/n) now on `main`; this lights up the home grid.
> **Caching Q1 decided (user 2026-07-04) = ON-WRITE PURGE + backstop.** `fetchNewArrivals` fetch tagged `next:{revalidate:300, tags:['catalog']}`
> (300s = BACKSTOP ceiling so an un-purged cache can't freeze) + **`app/api/revalidate` route** (shared-secret `x-revalidate-secret` → `revalidateTag('catalog')`,
> **fail-CLOSED** on unset secret [500], `timingSafeEqual` constant-time [401 missing/wrong/wrong-len]). **Emit-side (core-api product-change webhook)
> DEFERRED** — no product-write path exists yet (only unexposed `CreateProduct` insert, zero `UPDATE products`); receive-side ships now, wires when admin
> product-CRUD lands (user-confirmed the receive+backstop scope). Card price is DISPLAY-ONLY (checkout re-prices via `POST /price/quote` P1-b) → ≤5-min-stale card price cosmetic, no money-integrity risk.
> **Files:** `next.config.mjs` (+`@lumin/api-client` transpile) · `package.json` (+`@lumin/api-client` ws, +**`server-only` 0.0.1**) · **`lib/product-view.ts`** (pure API→view
> mapper, `import type` only → client-safe) · **`lib/catalog.ts`** (`import 'server-only'` + `createApiClient`(`CORE_API_URL` thrown-not-defaulted) + `fetchNewArrivals`
> = `GET /products?sort=newest&pageSize=8`, throw-on-error→error.tsx) · **`lib/revalidate-auth.ts`** (pure `verifyRevalidateSecret`, unit-tested) · **`app/api/revalidate/route.ts`** ·
> `app/page.tsx` (async server-fetch → `<FeaturedProducts products>`) · `components/featured-products.tsx` (client, takes `products` prop, maps view→`@lumin/ui`
> `ProductCard`; `basePrice` RAW int-VND→PriceTag/formatVnd, `images[0]` cover, `slug`→`/san-pham/{slug}` href; empty-CTA→`/danh-muc`) · `.env.example`
> (`CORE_API_URL`+`REVALIDATE_SECRET` server-only) · tests `catalog.test.ts`+`revalidate-auth.test.ts` · **DELETED `lib/demo-products.ts`**.
> **Server-only boundary COMPILER-ENFORCED** (`import 'server-only'` in catalog.ts → any future client value-import = build error; grep-verified no
> `CORE_API_URL`/`createApiClient` in a `'use client'` runtime import — client imports only `type ProductCardView`). **openapi-fetch `next` forwarding verified at source**
> (0.13.8 re-attaches `next` onto the Request after `new Request()` strips it → caching REAL, not a no-op). empty/loading/error all wired (empty=FeaturedProducts
> len0 · loading=`loading.tsx` skeleton · error=`page.tsx` throw→`error.tsx` retry). NO Intl in storefront (ESLint MNY-03 armed). **Gates (last-green 2026-07-04):**
> `pnpm verify` rc=0 (lint+typecheck+test+format, 6 workspaces) · **15 storefront tests** (mapper 6 + purge-auth 5 + messages 4) · **guard 160** (no new ARM — FE
> track `armGates=none` per plan §3) · osm 22. **Deps:** +`@lumin/api-client`(ws) +`server-only`(0.0.1) +`openapi-fetch`(transitive). **NO new ADR** (implements Q1 caching decision).
> **Reviews:** spec-guardian **PASS 0 BLOCKER/0 WARN/3 NOTE** (server-only boundary discipline-only→FIXED · dormant purge endpoint=conscious call · branch-hygiene→FIXED [moved off p1l]).
> Adversarial 5-lens wf_abea142d (21 agents: 5 lens find → per-finding refute → completeness critic): **15 raw → 4 confirmed (0 BLOCKER) / 11 refuted + 3 critic gaps; ALL FIXED:**
> (IMPORTANT, 2 lenses + spec-guardian) catalog.ts no build-time server-only guard → **`import 'server-only'` + `server-only` dep** (compiler-enforced boundary);
> (NOTE) `imageSrc: images[0]` passed empty-string `src=""` through, contra docstring → **`images[0] || undefined`** + `['']`/`['',…]`→undefined tests; (NOTE) empty-state CTA
> was circular self-link `/`→ **`/danh-muc`** (matches viewAll) + copy `emptyCta='Xem tất cả danh mục'`; (critic) no acceptance EARS row → **Cụm 17 SF-01 [fail-closed
> purge auth]/SF-02 [int-VND-raw + images-empty→undefined + server-only]** (`[ ]` — ledger parser scans `packages/**` only, TS test-ids at `apps/**` can't be `[x]`).
> **Caching lens self-REFUTED its own "no-op" headline** (matches my source trace); **security lens REFUTED all purge concerns** (fail-safe + constant-time hold).
> **Visual-fidelity:** hi-fi home read (understand wf_307ff7c9, §7 debt paid); grid REUSES the P0-vetted `@lumin/ui` ProductCard (markup unchanged → P1-f is data-swap, not layout);
> design's compact home cards = name+price+rating (no badge/compareAt/sale — matches the narrow projection); **live screenshot DEFERRED to P1-g/h** (need running origin + seeded products w/ image URLs). ⚠️ auth-adjacent (revalidate secret) — owner line-by-line before merge.
> **NEXT (FE track, all unblocked by P1-f):** **P1-h** product detail `/san-pham/{slug}` (dependsOn P1-a,f — the card href already points there) · **P1-g** browse `/san-pham` (c,d,e,f) ·
> **P1-o** guest lookup UI (n,f) · **P1-m** reviews FE (l,f). Re-read `designs/Lumin Storefront - Hi-fi.dc.html` per-screen before each.

> **✅ P1-f MERGED (PR #40) → `origin/main` `a1e898b` (2026-07-04, merge-commit; local `main` ff'd).**
>
> **✅ PR-P1-h (FE · product detail `/san-pham/{slug}`) — MERGED (PR #41) → `origin/main` `8d293fa` · `pnpm verify` GREEN
> (28 storefront tests) · guard 160/osm 22 (no FE ARM) · spec-guardian PASS (0 BLOCKER/1 WARN-FIXED/1 NOTE) · adversarial
> 6-lens wf_bf7aa2b1 DONE (9 raised → 3 confirmed [ALL the same breadcrumb defect, corroborated by a11y+i18n+states
> lenses + spec-guardian] / 6 refuted; 5 critic NOTEs → 4 FIXED / 1 deferred) · committed `3717291` → **PR #41 ✅ MERGED →
> `origin/main` `8d293fa` (2026-07-04, squash; local `main` ff'd to `8d293fa`).**
> (branch `feat/phase-1-storefront-p1h` off `main` `a1e898b`.) Closes the dead card→detail link P1-f opened; the FE
> critical path (P1-i/j/k/m all sit on it). **Scope (user 2026-07-04):** detail SHELL + colour swatches (out-of-stock)
> + "Thêm vào giỏ" **LOCKED until an in-stock colour chosen**; CTA click UNWIRED (no-op seam → P1-k). Deferred (by design,
> not missing): cart+quantity P1-k · engrave/option pickers P1-j (contract exposes no choice `values[]`) · 360/sprite P1-i ·
> reviews FE P1-m · live `/price/quote` total P1-k. **Files (9):** `lib/product-view.ts` (+`ProductDetailView`/`ColorView`
> types, `toProductDetailView` mapper, pure `canAddToCart`/`isColorSelectable`/`formatDimensions`) · `lib/catalog.ts`
> (+`fetchProductBySlug`: server-only, **404→null / else throw**, `tags:['catalog']`+300s backstop) · `components/product-detail.tsx`
> (NEW client: media+thumb gallery · `PriceTag(basePrice)` · Rating/no-reviews · description · specs `w × d × h mm`+material ·
> swatches hex+selected-ring+**available:false→disabled+`core.errors.colorOutOfStock`** · `Button` pop gated by `canAddToCart`) ·
> `app/san-pham/[slug]/{page,loading,not-found}.tsx` (server route · Next-15 async `params` · uniform `notFound()` non-leak ·
> skeleton · 404 CTA→/danh-muc) · `messages/vi.ts` (+`productDetail` ns; reuse `product.add`+`core.errors.colorOutOfStock`) ·
> `test/product-detail-view.test.ts` (13 tests: mapper edges + dedupe + `canAddToCart` lock truth-table) · `docs/acceptance.md`
> **Cụm 18 SF-03/SF-04** (`[ ]` TS-gated). **Money:** basePrice-only via PriceTag/formatVnd, **NO client sum** of colour/option
> `priceDelta` (server-authoritative `/price/quote` P1-k); no Intl outside core (MNY-03). **NO new dep · NO new ADR · NO migration
> · NO contract change** (consumes P1-a `GET /products/{slug}`). **Review fixes (4):** (①IMPORTANT ×4-reviewer) breadcrumb
> `<nav>` reused `nav.primaryNav` → dup landmark w/ BottomNav on mobile → dedicated `productDetail.breadcrumbLabel` "Đường dẫn";
> (②NOTE) `aria-current="page"` on terminal crumb; (③NOTE) swatch `<div role="group" aria-labelledby>` names the set (kept
> `aria-pressed` toggles per locked invariant — radiogroup change REFUTED as over-reach); (④NOTE) `toProductDetailView` now
> **de-dupes images** (+test) so a repeated photo can't dup a React key. **Deferred (documented):** out-of-stock note keeps
> spec §05-mandated `core.errors.colorOutOfStock` (refuted as redundancy-not-defect) · per-product meta description/canonical/OG/
> JSON-LD → **P1-q** (SEO PR). **Live screenshot vs hi-fi DEFERRED** (needs running origin + seeded product images; same as P1-f).
>
> **🔨 PR-P1-j (FE · engrave/personalize + choice-option pickers trên `/san-pham/{slug}`) — BUILT · review DONE + fixes applied ·
> `pnpm verify` re-GREEN (46 storefront tests, product-detail-view 13→31) · guard 160/osm 22 (no FE ARM) · spec-guardian PASS (0/0/2) ·
> committed `4b14df1` → pushed → **PR #42 OPEN · chờ user merge-gate.**
> (branch `feat/phase-1-storefront-p1j` off `main` `8d293fa`.) On the FE critical path — unblocks **P1-k** cart (j→k→p).
> **Scope (user 2026-07-04, 2 quyết định + 1 correction):** (1) render CẢ engrave text field LẪN choice add-on toggles;
> (2) counter **mirror server** — **đếm code point THÔ** qua `Array.from(text)`, **KHÔNG normalize** (server `utf8.RuneCountInString`
> cũng không → normalize sẽ làm client lỏng hơn server cho NFD; user chọn "drop NFC" sau khi review vạch ra premise sai của câu hỏi đầu).
> **zoneId UI DEFERRED** (§5 DROP server-side; draggable-orb zone picker = P1-i). CTA click vẫn **UNWIRED** (no-op seam → P1-k);
> selection UI-only (no `/price/quote` call, no total). **Files (6):** `lib/product-view.ts` (+`OptionView` + `options[]` view/mapper
> `maxChars ?? null`; pure `engraveLength` [raw code point] / `isEngraveWithinLimit` / `canAddToCartWithOptions` = colour-lock AND mọi
> engraving trong hạn) · **NEW** `components/engrave-field.tsx` (client: `Input` label=option.label + `hint`=maxChars + over-limit
> `error`/`role=alert` [native-associated, không tự đặt aria-describedby] + live nameplate preview + counter visual `aria-hidden`;
> reduced-motion) · `components/product-detail.tsx` (wire engrave fields/text-option + choice toggles [sr-only checkbox + styled box +
> `PriceTag` priceDelta, no sub-`values[]`]; composite lock; pick-colour hint chỉ theo colour blocker) · `messages/vi.ts`
> (+engrave/option keys trong `productDetail` ns) · `test/product-detail-view.test.ts` (+18: engraveLength ASCII/NFC/**NFD-raw=2**/non-BMP
> [explicit `\u` escapes] · isEngraveWithinLimit blank/null/limit/trailing-space · canAddToCartWithOptions truth-table · options mapping) ·
> `docs/acceptance.md` **Cụm 19 SF-05/SF-06** (`[ ]` TS-gated). **Money:** basePrice-only, **NO client sum** priceDelta; no Intl ngoài core
> (MNY-03 — counter dùng `Array.from`, không `Intl`). **NO new dep · NO new ADR · NO migration · NO contract change** (consumes P1-a
> `GET /products/{slug}`). **Adversarial 6-lens review `wf_4cb45ad6-ccf` (rune-parity/money/a11y/i18n/states/contract-scope × per-finding
> refute, 17 agents): 11 raw → 5 confirmed / 6 refuted; 5 confirmed rút về 2 defect, CẢ HAI FIXED:** (①IMPORTANT ×2-lens a11y+states)
> caller `aria-describedby={counterId}` **clobber** Input primitive's own error wiring (`{...props}` spread SAU nội bộ) → over-limit error
> `<p role=alert>` mồ côi → **FIX:** bỏ aria-describedby, dùng native `hint`(maxChars)+`error` của Input; counter span → `aria-hidden`
> (cũng bỏ `aria-label` — ARIA-prohibited trên generic span + che số "5/20"); (②IMPORTANT states) **rune-parity**: NFC-normalize làm
> client lỏng hơn server thô cho NFD → **FIX:** drop NFC, đếm raw code point (user-confirmed) + sửa comment/test sai. **Refuted (sound):**
> NFC-out-of-scope (2 lens — nhưng false comment/test sống trong P1-j nên vẫn sửa) · BOM/NEL trim-set lệch (pathological, server backstop) ·
> multi-text-option vs single Personalization (P1-k concern) · counter aria-label che số (dup của defect ①).

> **✅ PR-P1-k (FE cart `/gio-hang`) — committed `fd56578` · pushed → PR #43 OPEN · CI green (app-gates/selftest/services-gates) · MERGEABLE · chờ user merge-gate. (verify+lint+typecheck+format green · 6-lens review DONE fixes-applied · spec-guardian PASS 0/0/0.)**
> (branch `feat/phase-1-storefront-p1k` off `main` `296e8f9` [P1-j].) **Scope (user 2026-07-04): cart screen ONLY** — detail live-total /
> sticky-mobile add-to-cart bar DEFERRED (follow-up hoặc gộp P1-i). **NEW:** `lib/cart.ts` (pure model + reducers + quote-map: `cartLineKey`
> gộp-theo-cấu-hình · `buildCartItem` [engrave OFF optionIds, blank=none, key-merge] · `addItem`/`setItemQuantity` dec-tại-1→xoá/clamp/`MAX_LINES` ·
> `cartQuoteItems` **gấp engrave optionId vào optionIds** + bỏ null colorId + **KHÔNG personalization/giá lên wire** · `sanitizeCart` đọc-total) ·
> `lib/cart-store.ts` (localStorage external store `useSyncExternalStore`, cross-tab `storage`, stable-snapshot cache, mutators đọc `read()` mới nhất) ·
> `lib/quote.ts` (`'use server'` `quoteCart` → POST /price/quote; err→safe code, **KHÔNG forward envelope/messageKey**) · `lib/core-api.ts` (tách
> server-only `coreApiBaseUrl`, dùng chung catalog.ts) · `components/cart-view.tsx` (mount-skeleton→empty/list/error; debounced quote + stale-guard +
> retry; subtotal `aria-live`) · `cart-line.tsx` (`QuantityStepper` min=0 dec-tại-1→xoá + dynamic remove-label; PriceTag line total) · `app/gio-hang/
> {page,loading}.tsx` (**noindex**). **MOD:** product-detail wire "Thêm vào giỏ" → `add`+`router.push('/gio-hang')` · site-header+bottom-nav `/gio`→
> `/gio-hang` · messages `cart` ns · acceptance **Cụm 20 SF-07/08** (`[ ]` TS-gated). **MONEY:** zero client-sum — subtotal + mọi line total CHỈ từ
> /price/quote (server-authoritative, ADR-019); tiền qua PriceTag/@lumin/core; `CORE_API_URL` giữ server-only (client bundle sạch). **BOUNDARY (plan
> §0):** KHÔNG nút checkout (footer = tạm tính + note ship-tính-sau); zero order/payment/address code (grep-verified — chỉ comment + CSS
> `transition-colors`). **NO new dep · NO new ADR · NO migration · NO contract change** (tiêu thụ P1-a/P1-b). **Verify:** storefront **70** test (24 new
> cart) · core **66** (ledger 43) · ui 105 · guard **160** / osm 22 · `next build` compiles+types-ok (`/` prerender fail = **pre-existing** P1-f home
> fetch tới API-down, KHÔNG do CI gate — app-gates chạy `pnpm verify`, không `next build`).
> **Adversarial review `wf_d56a1e76-943` (6 lens money/contract/persistence/a11y/scope/design × per-finding refute + completeness critic, 16 agents):
> 2 defect thực (fixed) + 2 critic NOTE (fixed) + 1 accepted-documented; các finding còn lại refuted.** ① (IMPORTANT persistence+contract, cùng lỗi)
> **stale-quote positional misalignment**: sau khi xoá dòng-giữa (index-shift), `quote` (state cũ) + `items` (mới) cập nhật non-atomic → 1 frame
> vẽ **line total của dòng bên cạnh** + subtotal cũ → **FIX:** gắn `signature` vào quote 'ok'/'error', chỉ áp giá khi `quote.signature===cartSignature(items)`
> (else skeleton) — khử cả line-total-sai lẫn subtotal-flash, zero round-trip thêm. ② (IMPORTANT a11y) cart-line thumbnail `<Link>` bọc chỉ
> `<img alt="">` → **empty link** (WCAG 2.4.4/4.1.2) → **FIX:** `aria-label={item.name}` (theo pattern gallery-thumb product-detail). ③ (critic NOTE)
> `unavailable`(422) Retry re-fire y request → no-op loop → **FIX:** Retry chỉ hiện khi `code==='error'` (transient); `unavailable` dựa copy
> "thử xoá rồi thêm lại" (sửa dòng → đổi signature → auto re-quote). ④ (critic NOTE) comment `MAX_LINES` "caller/UI prevents" sai → **FIX:** sửa
> comment (silent backstop, 50 > mọi giỏ thực). **Accepted-documented:** multi-text-option collapse → single-personalization contract (OrderItemInput
> có 1 slot; server cũng engrave text-option đầu) → không đại diện được sản phẩm 2-engrave, không fix. **Refuted (sound):** money-lens stale-frame
> (giá vẫn server-authoritative int-VND qua core, chỉ lệch vị trí — đã fix qua ①) · focus-loss-on-remove (2.4.3 misapplied, out-of-scope) ·
> mount-skeleton no-aria (skeleton đủ theo §State; live-region không announce SSR-initial) · empty-state/shipping-note fidelity (verbatim hi-fi copy,
> spec-mandated no-checkout). Re-verify sau fix: storefront 70 · typecheck/lint/format green. **spec-guardian PASS: 0 BLOCKER/0 WARN/0 NOTE**
> (money server-authoritative · boundary zero-order/payment/address · i18n key-driven · engrave-fold+personalization-omit khớp `pricing.PriceItem`/
> `validateEngrave` · Cụm 20 `[ ]` EARS-ok). **NEXT:** commit → push → PR → CI green → user merge-gate.

> **✅ PR-P1-k MERGED (PR #43) → `origin/main` `452ff48` (2026-07-04, squash; local `main` ff'd). Phase-1 fan-out continues.**

> **🔨 PR-P1-g (FE · catalog browse `/danh-muc`) — committed `40562e8` · pushed → PR #44 OPEN · CI GREEN (app-gates/selftest/services-gates) · MERGEABLE · chờ user merge-gate. (adversarial review DONE + fixes applied · spec-guardian PASS 0/0/1 · verify+build+guard green.)**
> (branch `feat/phase-1-storefront-p1g` off `main` `452ff48` [P1-k].) The earliest un-done Phase-1 sub-PR; deps P1-c/d/e/f all merged.
> **ROUTE DECISION (user 2026-07-04):** browse lives at **`/danh-muc`** (NOT the plan §3 `/san-pham`) — all 6 existing nav links
> (bottom-nav/header/footer/hero/featured-products/[slug]not-found) + the hi-fi "Danh mục" tab already point there → chose it → **ZERO nav-file churn** (dead links now resolve); detail stays `/san-pham/{slug}`.
> **SCOPE:** category chips + FTS search (`?q=` ADR-016) + sort + **URL-driven pagination** — bounded by the 4 params GET /products accepts
> (category/q/sort/page); the design's price-range/colour filters are OUT (no backend param) and "Bán chạy/Nổi bật" sorts dropped (no Phase-1 column).
> The hi-fi shows a scroll-list w/ NO paginator → added an on-brand paginator to satisfy the plan's explicit "paginate" done-criterion.
> **NEW (10 files):** `lib/catalog-params.ts` (PURE URL state: `parseCatalogParams` clamp/validate · `buildCatalogHref` default-omit + page-reset-on-filter-change · `emptyStateKind` search>filter>catalog · `pageItems` window+ellipsis · `totalPages`) ·
> `lib/catalog.ts` +`fetchCatalog`/`fetchCategories` (server-only, tag `catalog`+300s backstop = Q1 caching) · `lib/product-view.ts` +`CategoryView`/`toCategoryView` ·
> `components/catalog-card.tsx` (server compact card = image+name+price+rating, NO fav/add per design) · `catalog-results.tsx` (server grid OR 3 distinct empty states) ·
> `catalog-toolbar.tsx` (**client** chips[Link]+search[form]+sort[`<details>`+Link menu after review], router.push via buildCatalogHref, input re-syncs to URL) · `catalog-pagination.tsx` (server Link pager, ≥44px cells) · `icons.tsx` +`ChevronDownIcon` ·
> `app/danh-muc/{page,loading}.tsx` (server, reads `searchParams` → **dynamic** render; parallel fetch categories+catalog; heading=active-category-name) · messages `catalog` ns.
> **MONEY:** price via PriceTag/@lumin/core; result-count + page-nums via `formatVnNumber`; NO Intl outside core; NO baked prices. **BOUNDARY (plan §0):** read-only — zero order/payment/checkout/address (grep-clean).
> **Filters persist reload** (URL is source of truth, server reads searchParams) + **empty-filter vs empty-search distinguished** (both P1-g done-criteria met). **NO new dep · NO new ADR · NO migration · NO contract change** (consumes P1-a/c/d/e).
> **Typing trap fixed:** `/categories` declares no error response → openapi-fetch collapses `error` to `never` → TS proves the `error||!data` guard dead → `response` narrows to `never` inside it → hoisted `response.status` read above the guard (contrast fetchCatalog whose /products 400 keeps its guard live).
> **Verify:** storefront **93** test (22 new `catalog-params` incl. pageItems single-hidden-page cases + 1 `toCategoryView`) · root `pnpm verify` 6/6 + prettier clean · `next build` compiles+types-ok, `/danh-muc` = **ƒ dynamic** (`/` prerender fail = pre-existing P1-f home-fetch-to-API-down, not a CI gate) · guard **160** / osm **22**.
> **Adversarial review `wf_95e6d56d-a0e` (6 lens money/i18n-a11y/rsc-boundary/correctness/plan-scope/visual × per-finding refute, 14 agents): 8 raw → 6 confirmed (1 IMPORTANT + 5 NOTE) / 2 refuted, ALL 6 FIXED.** ① (IMPORTANT correctness) `?page=N` beyond last on a non-empty catalog → false empty-state + self-hiding paginator dead-end → **FIX** `redirect()` out-of-range page → last page (keeps filters via `{page}` patch; `total>0` guard no-loop). ② (NOTE a11y) grid cards `<h3>` w/ no intervening `<h2>` → h1→h3 skip → **FIX** sr-only `<h2>` results heading (`catalog.resultsHeading`). ③ (NOTE a11y WCAG 3.2.2) sort `<select>` navigated on change (per-arrow nav on Win, no-JS gap) → **FIX** rebuilt as `<details>`+`<Link>` menu (activation not on-input, keyboard-safe, no-JS, matches design dropdown; added `ChevronDownIcon`). ④ (NOTE a11y) current page announced bare number + orphaned `paginationCurrent` key → **FIX** wired key as aria-label. ⑤ (NOTE correctness) `pageItems` emitted ellipsis for a single hidden page (contradicted its own test) → **FIX** show the number, +2 test cases. **Refuted (sound):** route `/danh-muc`≠plan `/san-pham` (user-approved 2026-07-04, not a defect) · card price cocoa-vs-flame (deliberate PriceTag token — a UI-package change, out of P1-g scope). money-format + rsc-boundary lenses returned 0 findings.
> **spec-guardian PASS: 0 BLOCKER / 0 WARN / 1 NOTE** (the `:` in `{t('sortLabel')}:` sits outside the key — ESLint [ADR-020 arbiter] does NOT flag bare punctuation + locale-safe for vi → accepted-documented, no code change). **NEXT:** user OK → commit → push → PR → CI → user merge-gate.

> **✅ PR-P1-g MERGED (PR #44) → `origin/main` `6fabf95` (2026-07-04, merge-commit; local `main` ff'd). Phase-1 fan-out continues.**
> **Phase-1 sub-PR tally: 15/19 MERGED** (a,b,c,d,e,f,g,h,j,k,l,m,n,o,q — P1-q #47 merged → `origin/main` `c7d52c7`). Remaining: P1-i (360 media — degrade-only, sprite pipeline unconfirmed) · **P1-p (consent analytics — BUILDING this branch)** · P1-r/s (customer auth — BLOCKER-2: needs credentials migration + auth-mechanism decision, gated on user).

> **🔨 PR-P1-m (FE · reviews section on product detail `/san-pham/{slug}`) — BUILT · verify+build+guard green · adversarial review DONE + fixes applied · spec-guardian PASS (0 BLOCKER/1 WARN/1 NOTE, WARN fixed) · chờ user merge-gate.**
> (branch `feat/phase-1-storefront-p1m` off `main` `6fabf95`.) User picked P1-m as next (2026-07-04). Consumes P1-l `GET /products/{slug}/reviews` (published-only, paginated, newest-first) + product data already fetched by P1-h.
> **SCOPE:** render published reviews (stars/date/body/photos) + owner reply + summary (avg+count) + empty state + URL-driven prev/next pager (`?reviewsPage=`). **READ-ONLY** — no review-write path (Phase-2+), no order/payment/address (grep-clean).
> **PDPL (hard):** the Review DTO deliberately OMITS reviewer identity → `ReviewView` has NO author/name/avatar field → the section renders none. Hi-fi shows name+avatar+"✓ Đã mua" badge → **documented deviation** (contract/PDPL-grounded, not missing behavior). Also dropped as unbacked-by-API: "28 có ảnh"/"98% hài lòng" summary stats · relative date "2 ngày" → **absolute `formatVnDate`** (MNY-03 — no relative-date formatter in core) · "Viết đánh giá" CTA (read-only Phase-1).
> **NEW (7 files):** `lib/product-view.ts` +`ReviewView`/`ReviewReplyView`/`toReviewView` (empty-img drop+dedup, null-safe reply) +`parseReviewsPage` (pure, clamp≥1) · `lib/catalog.ts` +`fetchProductReviews(slug,page)` (server-only, tag `catalog`+300s backstop; **404→graceful empty** not throw, since product already resolved) +`ReviewsPage` type +`REVIEWS_PAGE_SIZE`=12 · `components/product-reviews.tsx` (**server component**, no 'use client', no client hooks — imports Rating/@lumin/ui + formatVnDate/formatVnNumber/**formatVnRating**/@lumin/core + totalPages reuse) · `app/san-pham/[slug]/page.tsx` (+searchParams, out-of-range redirect→last page per P1-g pattern, render below ProductDetail) · `messages/vi.ts` +`productReviews` ns · **`packages/core/i18n/formatters.ts` +`formatVnRating`** (review-fix).
> **MONEY/i18n:** dates via `formatVnDate` (TZ-pinned Asia/Ho_Chi_Minh), counts via `formatVnNumber`, rating-avg via new `formatVnRating`; NO Intl outside core; every string a next-intl key. **RSC boundary VERIFIED:** product-reviews imported ONLY by server page.tsx → catalog.ts (`server-only`) never enters client bundle.
> **Adversarial review `wf_65903e50-8d2` (5 lens privacy-pdpl/a11y-i18n/correctness-pagination/rsc-boundary/scope-visual × per-finding refute, 11 agents): 6 raw → 1 confirmed (NOTE) / 5 refuted, FIXED.** ① (NOTE scope-visual) summary big-number used `formatVnNumber(productRating)` on a `float` avg → default-3-decimals (`4,667`) since core-api `rating_avg real` has no server-side round → **FIX: NEW `formatVnRating` in @lumin/core** (`maximumFractionDigits:1` → `4,7`, whole drops decimal → `5`), used for the avg; +4 core test cases (core 66→67). **Refuted (all sound):** Rating aria-label raw-decimal separator (mirrors product-detail/catalog-card/featured siblings — fixing in isolation = inconsistency) · `aria-current="page"` on status span (valid ARIA, non-harmful) · empty reply.body labeled block (contract ReviewReply.body ≠ "may be empty" + Phase-1 unreachable) · section-count vs header-count divergence (backend-dependent, speculative) · +1.
> **spec-guardian PASS (0 BLOCKER / 1 WARN / 1 NOTE).** WARN (MNY-03/consistency, same class as the adversarial finding but on the aria-label the `formatVnRating` fix missed): summary `<Rating label={t('ratingLabel',{value:productRating})}>` passed the RAW float → next-intl auto-format (~3 dp) → screen-reader "4,667 trên 5 sao" beside visible "4,7" (mismatch I introduced with the visible-only fix) → **FIXED: pass `formatVnRating(productRating)` to the label** (aria == visible, routed through core; mirrors summaryCount pre-format; per-review label stays raw `review.rating` = integer, fine). NOTE = the documented PDPL hi-fi deviation (no reviewer identity) — evidence-only, no action.
> **Verify:** storefront **103** test (10 new: `toReviewView` + `parseReviewsPage`) · core **67** (+`formatVnRating`) · root `pnpm verify` ✓ (lint+typecheck+test+format) · `next build` compiles (`/` prerender fail = pre-existing P1-f, not a CI gate) · guard **160** / osm **22** (frontend, no new ARM). **NO new dep · NO new ADR · NO migration · NO contract change.**
> **NEXT:** user OK → commit → push → PR → CI → merge-gate.

> **🔨 PR-P1-q (FE · SEO — server OG + Product/Offer JSON-LD + sitemap/robots/canonical) — BUILT · `pnpm verify` green (lint+typecheck+**111** test, 8 new) · `next build` COMPILES (sitemap graceful-degrade proven; `/` prerender fail = pre-existing P1-f core-api coupling, not a CI gate) · adversarial review `wf_08bde641` DONE (7 raw → 4 confirmed = 2 distinct issues, BOTH FIXED) · spec-guardian PASS (0/0/2) · pushed → **PR #47 OPEN · CI GREEN · MERGEABLE** (merged `origin/main` `518b326` in) · chờ user merge-gate.**
> (branch `feat/phase-1-storefront-p1q` off `origin/main` `25bb5c4`. **P1-o #46 merged first (`518b326`) → merged `origin/main` into this branch (regular merge, NO force-push per the PR-#30 precedent); ONLY `active-context.md` conflicted — as predicted — and `messages/vi.ts` did NOT (P1-q never touched it); resolved.**) User picked P1-q as next (2026-07-05). Consumes P1-c/P1-h (merged). **READ-ONLY** — ZERO order/payment/address/checkout (grep-clean).
> **NEW (7):** `lib/site.ts` (`server-only siteBaseUrl()` — **NEW `SITE_URL` env**, thrown-not-defaulted mirror of CORE_API_URL, strips trailing slash) · `lib/product-jsonld.ts` (pure `buildProductJsonLd` → Product/Offer, availability=**PreOrder**, **NO AggregateRating** per plan §3, price=raw int-VND `String()` NOT formatVnd; `jsonLdScriptContent` escapes every `<` to its `<` unicode form vs `</script>` breakout; `BRAND` const) · `app/robots.ts` (allow public, disallow /gio-hang /tra-cuu-don /api/, sitemap+host) · `app/sitemap.ts` (home+catalog+all product slugs, paged pageSize=48 + cap 50 pages, **degrade-to-static on fetch fail** — proven at build) · `app/opengraph-image.tsx` (`next/og` 1200×630 branded card — **ASCII wordmark only**: satori tofus VN diacritics + no committed font, so VN tagline rides in og:description native-rendered) · `test/product-jsonld.test.ts` (6). **MOD (4):** `layout.tsx` (metadataBase + default openGraph website/siteName/locale) · `page.tsx`+`danh-muc/page.tsx` per-page canonical · `san-pham/[slug]/page.tsx` (canonical + product-photo og:image [absolute-guarded] + JSON-LD `<script>` + **noindex on 404**) · `catalog.ts` +`fetchAllProductSlugs`.
> **NO new i18n key** (OG reuses `meta.title`/`meta.description`; `BRAND`='Lumin Studio' = proper-noun const/og siteName). **NO new dep** (`next/og` ships with Next). **NO ADR · NO migration · NO contract/openapi change · no ARM gate** (FE).
> **Adversarial review `wf_08bde641` (5 lens seo-correctness/money-i18n/rsc-server-only/correctness-security/plan-scope × per-finding refute, 12 agents): 7 raw → 4 confirmed / 3 refuted → the 4 collapse to 2 DISTINCT issues (each found by 2 lenses, both verified against installed next@15.5.19 source), BOTH FIXED.** ① (IMPORTANT ×2 seo+plan-scope) **product detail emitted NO og:image for a photo-less / relative-cover product** — Next 15 FULLY REPLACES `openGraph` when a child sets it (mergeStaticMetadata re-applies the root file-OG only to a segment that OWNS an opengraph-image file; `[slug]` owns none), so omitting `images` stripped the inherited default card AND supplied no photo → blank inbox/MXH share card. My comment claiming "falls through to default card via metadataBase" was FALSE. **FIX:** NEW pure `productOgImages(cover)` in product-jsonld.ts (absolute cover → `[cover]`, else `['/opengraph-image']` default-card route; NEVER `[]`) + detail page always passes `images` + corrected comment + 2 tests. ② (IMPORTANT ×2 correctness-security+plan-scope) **new required `SITE_URL` env undocumented** — `siteBaseUrl()` throws (via `layout.tsx metadataBase`, every route + `next build`) but `.env.example`/`operations.md` never listed it → fresh checkout/CI/deploy 500s every page. **FIX:** added `SITE_URL` to `apps/storefront/.env.example` (via Bash — file-tool denies `.env*`) + `operations.md` §env (thrown-not-defaulted, must include scheme). **Refuted (3, sound):** slug-alias canonical drift (backend is exact-match `WHERE slug=$1`, no alias resolution) · catalog og inherits fine (only child-SET openGraph replaces; catalog sets none) · "OG draws Vietnamese→tofu" (card is ASCII wordmark only — reviewer's own premise was stale).
> **FLAG (user, remaining):** OG image = ASCII brand wordmark, NOT a composited name+price card (defer richer card until a Vietnamese `.ttf` is bundled — can't visually verify the PNG this session, same "live screenshot deferred" as P1-f). SITE_URL doc gap RESOLVED (both files).
> **✅ spec-guardian PASS (0/0/2 NOTE, both non-actionable). committed `ac23856` · pushed → PR #47 OPEN (base main) · CI GREEN (selftest + app-gates + services-gates) · MERGEABLE · chờ user merge-gate.**
> **NEXT:** user merge-gate on PR #47 (now carries the `origin/main` merge). On merge, remaining Phase-1: P1-i (degrade-only), P1-p (consent), P1-r/s (BLOCKER-2, user decision).

> **✅ PR-P1-m MERGED (PR #45) → `origin/main` `25bb5c4` (2026-07-04, squash; local `main` ff'd). Phase-1 fan-out continues.**

> **🔨 PR-P1-o (FE · guest order-lookup `/tra-cuu-don`) — BUILT · verify+build+guard green · 5-lens adversarial review DONE + fixes applied · spec-guardian PASS (0/0/1 NOTE) · chờ user merge-gate.**
> (branch `feat/phase-1-storefront-p1o` off `main` `25bb5c4`.) User picked P1-o as next (2026-07-05). Consumes P1-n `GET /orders/lookup?code=&phone=` (already merged) + P1-f api-client wiring. A code+phone form → status timeline with **auto-poll**. **READ/POLL-only** — no order creation / transition / address / payment (Phase-1/2 boundary, grep-clean).
> **CONTRACT (P1-n):** `PublicOrderTimeline {code,status,milestones[{status,at}],trackingCode?,createdAt}` — safe DTO (NO PII/money/uuid/actor, ADR-032). 404 uniform (unknown code OR phone mismatch — no enumeration) · 429 `RATE_LIMITED` (no Retry-After) · 400. Rate limit = per-code bucket 0.5 req/s + burst 15.
> **POLL cadence (open-q #6 resolved):** 15s interval (~0.07 req/s, well inside budget) · polls ONLY while non-terminal (`isPollableStatus`) · **pauses on `document.hidden`** (don't burn budget) · exponential backoff on transient failure (→60s cap) · 10-min hard ceiling then manual `Làm mới`. `prefers-reduced-motion` stills the spinner only (polling is data, not motion).
> **@lumin/core (shared, P1-o + P1-s):** NEW `orderStatus` i18n ns (7 labels 1:1 w/ OrderStatus) + `formatVnDateTime` (TZ-pinned Asia/Ho_Chi_Minh, date · 24h — sibling of formatVnDate) + **NEW `test/messages.test.ts` completeness gate** (every `ORDER_STATUSES` has a non-empty label, no orphans — the §5 "armed messages.test"). 5 progress milestones PENDING_CONFIRM→PAID→PRINTING→SHIPPING→COMPLETED; CANCELLED/REFUNDED render as a separate close banner (spec §04).
> **NEW/CHANGED (12 files):** `lib/order-lookup-view.ts` (pure `buildTimeline`/`isPollableStatus`/`normalizeLookupInput` + `TimelineData`/`LookupResult` types) · `lib/order-lookup.ts` (`'use server'` action → GET /orders/lookup, maps errors to closed codes, NEVER forwards messageKey — always-must #3, mirrors quote.ts) · `components/order-timeline.tsx` (`'use client'` vertical stepper + close banner + tracking-code + reusable `OrderStatusBadge`) · `components/order-lookup.tsx` (`'use client'` form + poll orchestration) · `app/tra-cuu-don/page.tsx` (server shell, **robots noindex** per storefront §SEO) · `messages/vi.ts` +`lookup` ns · packages/core ×5 (formatters/vi/index + 2 tests).
> **Security VERIFIED:** grep `.next/static` shows **NO `CORE_API_URL` leak** (server-action seam) · no `server-only` import in client graph · directives correct.
> **Adversarial review `wf_89291119-daf` (5 lens security-noleak/contract-fidelity/polling/a11y-i18n/view-logic × per-finding refute, 16 agents): 11 raw → 5 confirmed (0 BLOCKER / 1 IMPORTANT / 4 NOTE) / 6 refuted → 3 distinct defects, ALL FIXED.** ① (IMPORTANT a11y WCAG 3.3.1) "enter both" formError bound only to the phone Input → a blank *code*+filled phone marked the valid phone `aria-invalid` and left the empty code unflagged → **FIX: form-level `<p role="alert">`, no per-field error binding.** ② (NOTE a11y) standalone `Làm mới` Button `size="sm"`=36px (only `size=sm` Button in storefront) < locked 44px → **FIX: default md (h-11).** ③ (NOTE polling) hidden-tab 3s re-check bypassed `MAX_POLL_MS` → stale `live` ≤3s on return (no network/budget leak) → **FIX: honor deadline in the hidden branch.** **Refuted (all sound):** security PASS · nested live-regions ×2 (deliberate + `aria-busy`-mitigated; proposed fix regresses poll announce) · 400→error unreachable (backend funnels malformed phone to 404, never 400) · closed-path "gap" (contract-precluded linear state machine).
> **Verify:** storefront **115** test (12 new: `buildTimeline`/close-states/tracking/`isPollableStatus`/`normalizeLookupInput`) · core **70** (+`formatVnDateTime` cases +orderStatus completeness) · root `pnpm verify` ✓ (lint+typecheck+test+format) · `next build` compiles (`/` prerender fail = pre-existing P1-f home-fetch, not a CI gate) · guard **160** / osm **22** (frontend, no new ARM). **NO new dep · NO new ADR · NO migration · NO contract change** (consumes P1-n/f).
> **spec-guardian PASS (0 BLOCKER / 0 WARN / 1 NOTE).** NOTE = inbox-origin edge: an inbox order (born at PAID, spec §04) renders `PENDING_CONFIRM` as done-without-timestamp on the frontier — benign + honest (order IS past it), not a contract violation → documented in a `buildTimeline` code comment, behavior unchanged.
> **NEXT:** user OK → commit → push → PR → CI → merge-gate.

> **✅ PR-P1-o MERGED (PR #46) → `origin/main` `518b326` (2026-07-05, squash; the P1-q branch merged it in to resolve). Phase-1 fan-out continues.**
> **✅ PR-P1-q (SEO) MERGED (PR #47) → `origin/main` `c7d52c7` (2026-07-05). Local `main` ff'd; branch `feat/phase-1-storefront-p1q` merged (squash), stale.**

> **🔨 PR-P1-p (FE · consent-gated Umami analytics, PDPL) — BUILT · verify green · adversarial review DONE + fixes applied · spec-guardian PASS (0/0/1 NOTE) · chờ push→PR.**
> (branch `feat/phase-1-storefront-p1p` off `main` `c7d52c7`.) User picked P1-p as next (2026-07-05). The last unblocked Phase-1 leaf (P1-i degrade-only gated on sprite URL; P1-r/s on BLOCKER-2 auth decision). **READ-ONLY analytics plumbing — ZERO order/payment/address/checkout (grep-clean).** Consumes nothing (self-contained gate). vn-compliance + ADR-015 loaded.
> **The gate (the PR's whole point):** Umami `<Script>` is NEVER rendered until localStorage consent === `granted` → ZERO analytics network before consent (network-panel-verifiable). **6 files (~205 non-cache lines):** `lib/analytics-consent.ts` (pure `parseConsent` — garbage/legacy ⇒ undecided, never assumes consent · SSR-/private-mode-safe `readConsent`/`writeConsent` · `umamiConfig()` reads `NEXT_PUBLIC_UMAMI_SRC`+`_WEBSITE_ID`, half-config ⇒ null ⇒ no banner/no script = dev default) · `components/consent-banner.tsx` (client; `'pending'` initial state ⇒ null on SSR+first paint = no hydration mismatch/no flash; `<Script strategy=afterInteractive>` only when granted; equal-weight accept/decline, decline one click) · `layout.tsx` mounts it · `messages/vi.ts` `consent` ns (VN privacy notice, honest "không ghi lại thao tác gõ hay quay màn hình", "từ chối vẫn mua sắm bình thường" = no purchase-gate) · `.env.example` +2 PUBLIC vars · `test/analytics-consent.test.ts` (5: parse/config/SSR branches).
> **Session replay OFF by construction (ADR-015):** only the standard tracker loads (pageviews+events), never a replay stream → forced-off everywhere incl. /gio-hang + personalize. `ponytail:` seam marks where per-route suppression goes IF replay is ever enabled in Umami's dashboard. **Guest consent = localStorage only** (consent_grants is customer-scoped; server-side guest audit DEFERRED per plan §5 — no-pre-consent-call gate is all P1-p owes). **Skipped (add-when):** consent-withdrawal UI (no privacy settings page yet) · §08 event instrumentation (pageview auto-track works; wire on first custom event).
> **Verify:** storefront **128** test (+5) · typecheck clean · lint clean · `next build` compiles+types-ok (`/` prerender fail = pre-existing P1-f core-api-down, not a CI gate; sitemap degrades gracefully) · guard unchanged (frontend, no new ARM). **NO new dep · NO new ADR · NO migration · NO contract change.**
> **Adversarial review `wf_762b8232-db8` (4 lens PDPL/react/a11y/scope × per-finding refute, 21 agents): 17 raw → 7 confirmed (dedup = 3 distinct) / 10 refuted, ALL FIXED.** ① (IMPORTANT a11y/contrast) accept button `variant="primary"` = white-on-flame-500 (2.82:1, the locked AA FAIL named verbatim in the a11y rule; only storefront primary= that variant — others use `pop`) → **FIX `variant="pop"`** (cocoa-on-sun 7.67:1, the compliant pattern). ② (IMPORTANT a11y) both buttons `size="sm"` = h-9 = 36px < locked 44px hit-target → **FIX `size="md"`** (h-11 = 44px). ③ (NOTE hygiene) `.eslintcache` staged as artifact → **FIX `git rm --cached` + `.gitignore` +`.eslintcache`.** **Refuted (sound):** zero-network-before-consent HOLDS (traced) · scope grep clean · replay-off claim honest · withdrawal-path + privacy-page-with-retention/rights correctly OUT of scope (deferred) · focus-to-body on dismiss (non-modal, benign) · `bottom-[76px]` nav-coupling (added explaining comment) · component-gate "untested" (pure gate logic IS tested; conditional wiring is trivial).
> **spec-guardian PASS 0/0/1:** NOTE = fuller VN privacy notice (retention period + customer rights + a privacy-notice page — none exists yet) is a **Phase-3/launch** obligation (compliance §1/§2), OUTSIDE P1-p's acceptance (plan line 67 = no-pre-consent gate + replay-off). Same conclusion the peer review reached (privacy-page out of scope). Flag carried to launch, not a P1-p defect.
> **NEXT:** commit → push → PR → CI → user merge-gate.
>
> **✅ PR-P1-p MERGED (PR #48) → `origin/main` `3f128c4` (2026-07-05, squash). Phase-1 tally: 16/19 MERGED (a–q). Remaining: P1-i (360 media, sprite pipeline unconfirmed) · P1-r/s (customer auth).**
>
> **✅ PR-P1-r MERGED (PR #49) → `origin/main` `33bdda6` (2026-07-05, squash; local `main` ff'd; branch `feat/phase-1-storefront-p1r` stale/squash-merged, not yet deleted). BE · storefront customer auth realm — `make verify-go` green · integration RAN vs real Postgres (colima, -race) · guard 161 ARM proven-binding · 6-lens review (wf_a7ffa6a5) + spec-guardian DONE + fixes applied.** User picked P1-r next + **password+bcrypt reusing the admin realm** (AskUserQuestion 2026-07-05). **BLOCKER-2 resolved:** (1) credentials = `ALTER customers ADD password_hash` NULLABLE (guest=NULL, mirrors admin `000009`) — **migration `000013`** (head was 000012; monotonic-above-main) + partial-unique `lower(email) WHERE password_hash IS NOT NULL` (login-email unique across credentialed only; dup→409 `EMAIL_TAKEN` **at the DB**, race-free) + CHECK `password_hash IS NULL OR email IS NOT NULL`; (2) **realm-separate** = own cookie `lumin_customer` + own secret `CUSTOMER_JWT_SECRET` (≠ admin) ⇒ admin token can NEVER validate as a customer session (cryptographic isolation, ADR-030) — `auth.Issuer` parameterized w/ cookieName (reused, not duplicated); (3) **registration = fresh account, does NOT claim guest orders by phone** (claiming an unverified phone = vuln, deferred); (4) `GET /customer/orders` scoped strictly by verified session `customer_id` (`ListOrdersByCustomer`) → SAME `PublicOrderTimeline` projection as guest lookup (no money/PII/address). **resolveCustomer does NO DB read** (token subject IS the scoping id — ponytail: deleted-customer token → empty list, TTL-bounded). Uniform 401 unknown-email/wrong-password (bcrypt always runs). **main.go fail-fast on forgeable `CUSTOMER_JWT_SECRET`** (twin of the admin guard; forgeable → read any customer's orders = PII). 41 constructor call-sites untouched via a **variadic `ServerOption`** (`WithCustomerAuth`). **Files:** migration 000013 (+down) · customers.sql (+2 queries) · orders.sql (+`ListOrdersByCustomer`) · identity.go (`RegisterCustomer` w/ 23505→`ErrDuplicate`, `CustomerByLoginEmail`) · orders.go (`ByCustomer`) · pool.go (`ErrDuplicate`) · auth.go (cookieName param + `CustomerCookieName`) · config.go (`CustomerJWTSecret`/TTL + `UsesForgeableCustomerJWTSecret`) · main.go · server.go (`ServerOption`/`WithCustomerAuth`) · router.go · middleware_auth.go (`authCustomer` class + `resolveCustomer`) · errors.go (`EMAIL_TAKEN`) · openapi.yaml (4 paths + 3 schemas + `customerAuth` scheme) + regen Go+TS · customer.go (4 handlers + ctx helpers) + customer_test.go (Docker-free: realm-isolation, validation, classify, wire-401) + customer_integration_test.go (real-PG: register→login→409-dup→uniform-401, order scoping + router-200 + no-PII-leak). **guard 160→161** (customer-realm ARM: `customerAuth.Verify` + `CustomerCookieName` + `authCustomer` + `customerFrom` + `UsesForgeableCustomerJWTSecret`; PROVEN binding — break `s.customerAuth.Verify`→`s.auth.Verify` → 160/1 RED → restore). acceptance **Cụm 21 CUST-01/02** (Go-gated `[ ]`). operations.md §4b `CUSTOMER_JWT_SECRET`. **No new dep · no new ADR** (implements ADR-030). **Reviews DONE:** spec-guardian **PASS 0/0/2** + 6-lens adversarial `wf_a7ffa6a5` (11 agents, per-finding refute) → **2 distinct confirmed, both FIXED:** (①IMPORTANT ×3 lens) `RegisterCustomer` didn't guard empty email post-normalize → **added `if email==""`→400** (belt-and-suspenders: `openapi_types.Email` already regex-validates at decode → empty/malformed is a 400 over HTTP; guard removes handler asymmetry + a would-be misleading 409 for a non-HTTP caller) + `blank-email` test; (②IMPORTANT auth-lens) `dummyHash, _ = bcrypt.GenerateFromPassword` swallowed its error → nil hash would break timing-equalization (enumeration) → **added `init()` fail-fast** on empty dummyHash (unreachable w/ fixed cost+21B, but hardens BOTH realms' `VerifyPassword(nil)`). spec-guardian NOTE 1 (realms could share a secret) → **added `Config.RealmSecretsCollide()` + main.go fail-fast** when `JWT_SECRET==CUSTOMER_JWT_SECRET` (upholds the cryptographic-isolation claim) + config tests; NOTE 2 (email) = same as ① (decode-validated, refuted + guarded). verify-go + integration + guard 161 all re-GREEN post-fix. **Phase-1 tally: 17/19 MERGED (a–r). Remaining: P1-s (FE customer account, reuses P1-o timeline — next unblocked leaf) · P1-i (360 media, parked on render-worker sprite pipeline; degrade-only fallback available). NEXT = P1-s.**
>
> **🔨 PR-P1-s (FE · customer account + order history /tai-khoan) — BUILT · `pnpm verify` green (lint+typecheck+test, 137 storefront tests incl 9 new) · `next build` compiles+types+lint clean (only `/`+sitemap prerender fail on ECONNREFUSED — no backend, pre-existing) · review DONE · fix applied · chờ commit/push→PR. (branch `feat/phase-1-storefront-p1s` off `main` `33bdda6`.)** User picked P1-s next + **greet-by-name** (AskUserQuestion 2026-07-05: cache identity in an httpOnly profile cookie since no `/customer/me`). Grounded by scope wf `wf_b5ed9dd4` (5 readers→synth). **BFF over the P1-r customer realm** (browser talks ONLY to Next; `CORE_API_URL` server-only). **Scope = only the 4 P1-r endpoints** (register/login/logout + `GET /customer/orders`); the hi-fi design's OAuth / magic-link / forgot-password / addresses / account-edit / avatar / delete-account have **NO backend → deferred, no dead links/stubs** (plan-locked P1-s scope). **Contract-over-design:** `PublicOrderTimeline` omits money/PII/line-items (ADR-032) → history rows show status+code+date+expandable timeline, **no price/item-count/reorder**. **Cookie flow:** login/register `'use server'` actions RE-MINT a first-party `lumin_customer` cookie (core-api's has no Domain → browser never hits that host) — httpOnly, secure-in-prod, **SameSite=Lax**, maxAge parsed from core-api's Set-Cookie — plus a companion httpOnly `lumin_customer_profile` (JSON name/email/phone, display-only; JWT gates orders) — then the hub forwards the JWT verbatim to `GET /customer/orders` (dashboard-fetch.ts idiom). Uniform 401 (no enumeration); raw envelope/messageKey never forwarded (always-must #3). **REUSE VERBATIM** P1-o `OrderTimeline`/`OrderStatusBadge`/`buildTimeline` (each order embeds full milestones → inline-expand, no per-order fetch, **no polling**). No-session/expired → hub renders a **login prompt in place** (not a redirect → no bounce loop; login/register pages don't redirect-if-logged-in). **Files (13): NEW** `lib/customer-session-cookie.ts` (pure: `parseSetCookie`+profile parse, node-unit-tested) · `lib/customer-auth.ts` (`'use server'` login/register/logout — first `cookies().set()` in repo) · `lib/customer-session.ts` (`server-only` `fetchCustomerOrders`/`getCustomerProfile`) · `components/{login-form,register-form,order-history-list}.tsx` · `app/tai-khoan/{page,loading}.tsx` + `dang-nhap/page.tsx` + `dang-ky/page.tsx` · `test/customer-session-cookie.test.ts`; **EDIT** `messages/vi.ts` (+`account` ns, sentence-case/warm) · `app/robots.ts` (+`/tai-khoan` disallow, review fix). **No nav edit** (site-header/bottom-nav already point at `/tai-khoan`). **No new dep · no new ADR · no migration/contract change** (api-client regen'd in P1-r `20a3e6a`). Guest `/tra-cuu-don` + `lookup` ns untouched. **Review:** 4-lens adversarial `wf_ee9f3685` **hit session-limit — auth-cookie + rsc-correctness lenses DIED unrun** (limit resets 4:30pm); i18n-a11y + plan-scope lenses completed → 1 refuted NOTE (mapper dup — deliberate, client-action vs server-only) + **1 CONFIRMED NOTE FIXED (robots.ts `/tai-khoan` backstop + stale comment)**. **Self-reviewed the 2 dead lenses** (author + build-typechecked): auth/cookie + RSC-correctness **no defects**. **✅ COMMITTED (`67d955f`) + pushed → PR #50 OPEN** (user chose "A with B": push now, re-run B before merge). **B DONE — re-ran the 2 dead lenses `wf_bdad6587` (17:01 post-limit-reset, both completed): 5 raw → ALL 5 REFUTED / 0 confirmed / 0 uncertain** (parseSetCookie Max-Age NOTE factually wrong — zero handled, negative unreachable; profile-cookie-PII = httpOnly+display-only+JWT-gates-orders; 2 "clean-sweep" NOTEs = no defect; loading.tsx-async NOTE). **1 consistency tweak applied (not a defect):** `loading.tsx` async+`getTranslations` → sync+`useTranslations` to match the 4 sibling loading.tsx house idiom (`role=status`+`sr-only`+plain `animate-pulse` stilled by global reduced-motion CSS) → verify re-GREEN (137 tests) → committed to branch. **✅ MERGED (PR #50) → `origin/main` `011d28b` (2026-07-05, merge-commit; local `main` ff'd). Phase-1 tally: 18/19 (a–s). Only P1-i remained → now BUILT (below).**

> **🔨 PR-P1-i (FE · on-demand 3D model-viewer, degrade-only) — BUILT · repo-wide `pnpm verify` green (lint+typecheck+test; storefront 138 tests incl +1 threading case; ui 105/core/api-client all green) · `next build` compiles+types+lint clean, prerenders 10/14 (only `/`+sitemap fail on ECONNREFUSED/SITE_URL — pre-existing env, not this PR) · **review DONE + fixes applied** · ✅ **committed `8732991` · pushed → PR #51 OPEN · chờ CI + user merge-gate.** (branch `feat/phase-1-storefront-p1i` off `main` `011d28b`.)** User picked "Build P1-i degrade-only" (AskUserQuestion 2026-07-05) after being told it's dormant today. **Scope = ONLY the on-demand model-viewer** gated on the contract's `Product.model3dUrl` (`.glb` URL, `""` when none). **Sprite-first 360° hover DEFERRED — no `spriteUrl` in the contract** (render-worker doesn't emit sprite-sheets yet; ADR-007 sprite path parked). Since NO product carries a `.glb` today the button is dormant — scaffold ready for when 3D assets exist (user-opted-in). **Files (7): NEW** `components/model-3d-viewer.tsx` (`'use client'`; "Xem mẫu 3D" button → dynamic-imports `@google/model-viewer` **only on click** = code-split, out of initial bundle; `hasWebGL()` gate hides the button when unsupported → static gallery IS the no-WebGL fallback; **reduced-motion honoured by construction** — no auto-rotate + `interaction-prompt="none"` = zero autonomous motion; `webglOk`/`shown` start false ⇒ no SSR/hydration mismatch; loading `role=status` + error `role=alert` states) · **EDIT** `lib/product-view.ts` (thread `model3dUrl`, `''`→undefined mirror of imageSrc) · `product-detail.tsx` (mount viewer when present + fix stale P1-i comments) · `messages/vi.ts` (+4 `view3d*` keys, sentence-case/warm) · `test/product-detail-view.test.ts` (+threading case) · `package.json`/`pnpm-lock.yaml` (**+`@google/model-viewer` ^4.3.1**, first storefront runtime dep beyond workspace/next/react — self-hosted, NO CDN, dynamic-import keeps it lazy). **No new ADR · no migration · no contract/openapi change · no money/auth/PDPL touch.** ponytail: dep-weight-for-zero-current-data is deliberate (feature dormant until `.glb` assets land). **Reviews DONE: spec-guardian PASS 0/0/3** (3 forward-looking NOTEs, no code change) **+ 4-lens adversarial `wf_75a1b9b7`: 24 raw → 4 confirmed → 3 distinct issues, 2 FIXED + 1 DOCUMENTED:** (①IMPORTANT+NOTE, same defect ×2 lenses) model-viewer swallows a bad/404/corrupt `.glb` into an `error` event (does NOT reject the import) → the wired `view3dError` state was unreachable for asset failure → **FIXED: `onError={()=>setFailed(true)}` on the element**; (②NOTE a11y) "Xem 3D" reveal dropped keyboard/SR focus to `<body>` → **FIXED: focus the revealed region (`containerRef` + `tabIndex=-1`)**; (③IMPORTANT dep/PDPL) model-viewer's DEFAULT Draco/KTX2 decoders load from **gstatic.com** — a *compressed* `.glb` would fetch WASM from Google at runtime (post-click) → **DOCUMENTED (ponytail comment + PR follow-up flag):** conditional/latent (uncompressed `.glb` = zero third-party; dormant today) → upgrade path = self-host decoders OR render-worker emits uncompressed `.glb`. Refuted (sound, 20): SSR-never-evals-model-viewer, no hydration mismatch, `alive` StrictMode-safe, genuinely code-split, reduced-motion-by-construction, dep pinned. verify re-GREEN (138 tests, lint+typecheck+build clean). **NEXT:** commit → push → PR → CI → user merge-gate. Then Phase-1 FE = complete (P1-i sprite-hover + Draco self-host remain render-worker-gated follow-ups).

1. **Slice 3 · PR-3k — ✅ MERGED (PR #30) → `origin/main` `cf4c2a8` (2026-07-02, squash; CI green app-gates/selftest/services-gates).**
   Local `main` ff'd to `cf4c2a8`; the merged `feat/core-http-relay-3k` branch + ~19 older squash-merged branches remain
   local (guard blocks `git branch -D` → prune by hand when duyệt). **Flag carried to 3j PR:** openapi `BankAccountUpdate`
   stays looser than server validation (server-authoritative fail-closed; add `pattern`/`minLength` follow-up).
2. **Slice 3 · PR-3j (admin dashboard frontend) — 🔨 BUILT · verify+build+guard green · adversarial review DONE (wf_6700cbed-be7:
   0 lens-confirmed / 4 critic gaps → 3 fixed, 1 refuted-by-existing-decision) · spec-guardian PASS (0/0/1 NOTE) ·
   ✅ **committed `354a9b4` · pushed → PR #31 OPEN · CI running (selftest green, app/services-gates pending) · chờ user merge-gate.**
   **Review fixes:** (a11y/WCAG 1.4.1) highlighted stat card was color-only → sr-only "Cần chú ý" cue + `needsAttention` i18n key
   (border-presence already non-hue for colorblind; sr-only closes the screen-reader gap) · (coverage) added missing-cookie test
   (empty-headers false-branch was untested) · (ops) operations.md §2 flags `CORE_API_URL` must wire into compose/Caddy when the
   admin container lands. **Refuted:** empty/zero render states "untested" — admin `vitest.config.ts` DELIBERATELY defers RSC render
   vetting to Playwright Phase 5 (data paths ARE unit-tested: `toRecentOrders([])→[]`, `highlight:false`). **Documented-deferred:**
   401/expired-session lands on the generic retry boundary (login-redirect belongs with the deferred admin login UI — no login page
   to redirect to yet; code comment + PR flag). 10 tests green.
   (branch `feat/core-http-relay-3j` off `main` `cf4c2a8`.) The LAST slice-3 sub-PR — landing it **closes the entire Core
   HTTP+relay slice**. Replaced `apps/admin/src/lib/demo-dashboard.ts` → real `GET /admin/dashboard` fetch via `@lumin/api-client`.
   **`lib/dashboard.ts`** pure adapters (`toStatCards`/`toRecentOrders`/`toTodos`; reviews-todo synthesized from
   `stats.reviewsWaiting` since API todos has only 2 fields — 3-row design preserved, confirmed vs hi-fi) + **`lib/dashboard-fetch.ts`**
   server-side `fetchDashboard` (reads httpOnly `lumin_session` cookie via `next/headers`, forwards to core-api, `no-store`,
   non-2xx→throw→error boundary; `CORE_API_URL` server-only env, throws if unset) + `page.tsx` async server component
   (route now `ƒ Dynamic`) + 3 components take props (**zero markup/class delta** → visual identical to vetted Phase-0 shell).
   `@lumin/api-client` added to admin deps + `transpilePackages`; `.env.example` added; `demo-dashboard.ts` deleted.
   **10 new Docker-free tests** (adapter slotting · reviews synthesis · empty-state · cookie-forward · missing-cookie · non-2xx-throws ·
   missing-env). `pnpm verify` rc=0 (lint+typecheck+test+format:check) · admin `next build` ✓ · api-client stale-gate ✓
   (no openapi change) · **guard 154 · osm 22** (no new ARM — frontend PR, no Go/services invariant). **No new deps beyond
   the workspace `@lumin/api-client` link · no new ADR.** Deferred by design: live visual-fidelity screenshot (needs running
   core-api + seeded session → integration/QA; markup unchanged so no new visual risk) + admin login UI (401→error boundary).
   **After review PASS:** update this ledger + push → PR → await user merge-gate.
3. **Housekeeping:** prune now-merged local branches `feat/core-http-relay`(3a)/`-3b`/`-3c-1`/`-3c-2`/`-3d`/`-3f`/`-3h` +
   older `feat/core-data-layer-2e/2f/2g`/`feat/core-data-model`/`feat/phase-0-*` when chủ duyệt (all squash-merged → won't
   show under `git branch --merged`; verify by PR#, not sha). Harness follow-ups: the **testcontainers ARM** greps Go
   `_test.go` for `postgres.Run` unanchored → a `//`-commented boot call could false-pass (same comment-out class fixed for
   recipe ARMs); **decisions.md ADR-033 "migration 000008" aside now stale** (3f took 000010) — fix in a harness/doc round
   (hard-blocked file). Sau Core phase: ADR-026 lane B/C/D · REC-20/28/39.

## Open questions
- *(không có cho slice backbone — scope đã chốt "backbone only" với user; ADR đã khoá quyết định.)*

## Task ledger (git-anchored — B3 / ADR-025)
> **Convention:** sau `/compact` hay sang phiên mới, **tin ledger + `git log` hơn trí nhớ** — đừng re-dispatch
> task `done`. Task chỉ `done` khi code chạy + test xanh. Cột commit ghi `<base7>..<head7>`.

| Task | Trạng thái | Commits | Review |
|---|---|---|---|
| Harness audit r2/r3 + ADR-027 (workflow giao-PR) | done | PR #1/#2 (main=f751a41) | guard.test 138 / osm 11 |
| **Phase 0 — backbone (tokens + core + arm gates)** | **done (PR #4 open)** | `feat/phase-0-backbone` `eef1755` | verify rc=0 · guard 139 · osm 22 |
| **Phase 0 — fix ultrareview PR #4 (A/B/C/D, 25 finding)** | **done (PR #4)** | `feat/phase-0-backbone` (+1 commit) | verify rc=0 · 43 test · guard 139 · osm 22 |
| **Phase 0 — compose skeleton** | **merged (PR #5)** | `origin/main` `30c5652` | `docker compose config -q` OK · verify rc=0 |
| **Phase 0 — `packages/ui` 13 primitives + token-coverage gate** | **merged (PR #6)** | `origin/main` `296c44a` | verify rc=0 · ui 105 / tokens 9 / core 37 · guard 139 · osm 22 · spec-guardian + /review: 2+2 a11y fixed |
| **Phase 0 — app shell 1/2: storefront (Next+next-intl+fonts+Tailwind)** | **merged → main** | PR #7 squash → `origin/main` `b77acb7` | `next build` ✓ · verify rc=0 · storefront i18n test + ui 105/tokens 9/core 37 · guard 139 · osm 22 · spec-guardian PASS (0/0/2) |
| **Phase 0 — app shell 2/2: admin (sidebar+dashboard, reuse infra)** | **merged → main** | PR #9 squash → `origin/main` `bf1b7a5` (re-land of #8) | Next 15 + Hanken Grotesk · `next build` ✓ · verify rc=0 · admin i18n test · guard 139 · osm 22 · spec-guardian PASS (0/0/2) · status-Badge map = 7 ORDER_STATUSES |
| **Phase 0 — services backbone (Go core-api + Rust asset-worker scaffold + arm gates)** | **merged (PR #10)** | squash → `origin/main` `ab99360` | make verify-go ✓ (golangci v2.12.2 + `go test -race`) · make verify-rs ✓ · ARM-GUARD .go→verify-go+.rs→verify-rs ✓ · guard 139 · osm 22 · 4-lens review 0 BLOCKER |
| **Core slice 1 — Go domain spine (OrderStatus state machine + money, no DB)** | **merged (PR #11)** | squash → `origin/main` `10b31f6` (2026-06-26 05:01Z) | `make verify-go` ✓ (gofmt+vet+golangci v2+`go test -race`, **17 test**) · 5-lens review wf_3ccae648: 0 BLOCKER · 2 fix proven binding (money overflow-guard + impossible-date test, mutate-run-restore) · 3 NOTE doc'd (Go server intentionally stricter on malformed ts/url) · guard 139 · osm 22 · spec-guardian PASS |
| **Core slice 2 — data layer** | planned (7 sub-PR) | plan `docs/plans/core-data-layer.md` (wf_0952e60c-e3d) | critique: 1 blocker fixed (sqlc up-only glob) + 4 important folded; user chose golang-migrate + defer AssetJob (ADR-028) |
| **Core slice 2 · PR-2a — data-layer infra (migrate + sqlc + pgx pool + gate arming)** | **merged (PR #12)** | squash → `origin/main` `7441072` | `make verify-go` ✓ (gofmt+vet+golangci 0+**sqlc vet+sqlc diff** no-DB+`go test -race`) · guard.test.sh **141** (sqlc ARM-GUARD proven binding mutate→RED) · osm 22 · ADR-028 · pgx v5.7.5/go 1.23/sqlc v1.30.0 · 3-lens review: spec-guardian PASS (0/0/1 NOTE→`extension` doc'd) + Go-correctness SOUND + harness-gate SOUND. Defer→2b: testcontainers + reversibility test (no local Docker) |
| **Core slice 2 · PR-2b — outbox table + tx-insert seam (dual-write spine)** | **merged (PR #13)** | squash → `origin/main` `861808d` | `make verify-go` ✓ (sqlc vet validates `InsertOutbox`; integration tests RAN in CI — services-gates 1m38s); guard **141** (testcontainers real-check ACTIVE → `postgres.Run`) · osm 22 · `EnqueueOutbox(pgx.Tx,…)` tx-first-arg dual-write guard ADR-006 · deps +google/uuid v1.6.0 (runtime) +testcontainers v0.34.0 (test); in-test SQL applier (no golang-migrate dep). Relay→slice 3 · 3-lens review PASS (1 test-isolation fix) |
| **Core slice 2 · PR-2c — catalog (categories/products/colors/options/reviews)** | **merged (PR #14)** | squash → `origin/main` `881bc86` | `make verify-go` ✓ (services-gates 1m16s CI); guard 141 · osm 22 · material TEXT+CHECK; money int8 CHECK≥0; nullable reviews.customer_id→pgtype.UUID (FK in 000004); thin `Catalog` repo; **no new deps**; EARS deferred · 2-lens review PASS/SOUND |
| **Core slice 2 · PR-2d — identity (customers/consent_grants/users + reviews FK)** | **merged (PR #15)** | squash → `origin/main` `59d4f98` | `make verify-go` ✓ (sqlc vet 8 queries; consent append-then-mark + no-district + user-role-no-system tests via testcontainers skip-local/run-CI) · guard 141 · osm 22 · consent partial-UNIQUE active; addresses jsonb NO district (ADR-017); ON DELETE SET NULL reviews FK (PDPL erase); thin `Identity` repo; vn-compliance loaded; **no new deps** |
| **Core slice 2 · PR-2e — order spine (orders/order_items + 3 tx seams)** | **merged (PR #16)** | squash → `origin/main` `cf31cb2` | `make verify-go` ✓ (golangci 0, sqlc vet+diff clean, `go test -race`); **integration tests RAN vs real Postgres (colima)** — 12 order tests incl. `-race` concurrent-reconcile FOR-UPDATE proof, jsonb/enum overrides, outbox atomicity, refund-proof consistency, RBAC, money CHECK · guard 141 · osm 22 · 4-lens review wf_ac186d9c: 14→9 confirmed all fixed (2 IMPORTANT: empty-items guard `ErrNoItems` + concurrent-lock test) · **no new deps** |
| **Core slice 2 · PR-2f — fulfillment/asset (asset_jobs + print_jobs + 3rd emit-seam)** | **merged (PR #17)** | squash → `origin/main` `b1b28a0` | `make verify-go` ✓ (golangci 0, sqlc vet+diff clean, `go test -race`); **9 jobs integration tests RAN vs real Postgres (colima)** — asset_job.created emit + payload pointer, rollback-atomicity, dup-id reject, both job-types, lifecycle mark, print-queue round-trip + stage advance, ON DELETE CASCADE; reversibility re-passes (000006 down drops 2 new enums) · guard 141 · osm 22 · D3 split asset_job_type{model_ingest,sprite_render}/outputs→Product · D6 print stage STORED · **no new deps** |
| **Core slice 2 · PR-2g — config/reference (settings singleton + reply_templates + append-only bank audit)** | **merged (PR #18)** | squash → `origin/main` `ffab5f8` | `make verify-go` ✓ (golangci 0, sqlc vet+diff clean, `go test -race`); **6 settings integration tests RAN vs real Postgres (colima)** — singleton guard, audit seam atomic+rollback+accumulate, **append-only UPDATE+DELETE+TRUNCATE blocked**, validate() rejects null/`{}`/`[]`, seq newest-first + nil-reason→NULL, reply-template round-trip; reversibility re-passes (000007 down drops 2 tables + trigger fn, no new enums) · guard 141 · osm 22 · **closes slice 2** · 5-lens review wf_70129d8e 7 confirmed/5 refuted all fixed (TRUNCATE-bypass + validate hole) · **no new deps** |
| **Core slice 3 — HTTP + relay (plan + ADR-029..033 locked)** | done (plan) | `feat/core-http-relay` `ecd06fa` | 13 sub-PRs / 2 tracks; planning wf_48252601 |
| **Core slice 3 · PR-3a — relay substrate (natsx connect + topology + readyz + lifecycle)** | **merged (PR #19)** | squash → `origin/main` `280e94b` (2026-06-27 11:30Z) | `make verify-go` ✓ (golangci 0, sqlc vet+diff, race); **2 natsx integration tests RAN vs real NATS+JetStream (colima)**; guard **142** (NATS ARM proven binding mutate→RED); osm 22; **nats.go v1.48.0 pinned** (v1.52→go1.25); **4-lens review wf_adea04ba 14→5 confirmed / 0 BLOCKER all fixed** (Docker-free non-fail-fast tests + convergence test + main.go comment + config exact-defaults); CI green (app-gates+selftest+services-gates incl first NATS-in-CI testcontainers) |
| **Core slice 3 · PR-3b — relay drain loop (outbox→NATS publish-on-commit)** | **merged (PR #20)** | merge → `origin/main` `c3b2004` (2026-06-27) | `make verify-go` ✓; **9 relay integration tests RAN vs real PG+NATS (colima, -race)** — pending→published+Nats-Msg-Id, **late-low-seq watermark-loss regression**, no-stream→transient→recover (0 attempts burn), dedup-on-republish, poison→failed head-of-line, + **7 Docker-free unit**; guard **144** (+2 relay ARM PROVEN binding: scan-pending-SET lock + relay-start-in-main); osm 22; REL-01/02 → acceptance.md `[ ]` (Go-gated by guard ARM + Go tests); **no new deps**; **5-lens review wf_81c76244: 12 raw→4 confirmed (0 BLOCKER) ALL FIXED**; CI green (incl relay-vs-NATS-in-CI) |
| **Core slice 3 · PR-3c-1 — OpenAPI contract authoring + 4-way enum parity + spec-sync** | **merged (PR #21)** | squash → `origin/main` `f1b35d2` (2026-06-27 23:45Z) | hand-authored `openapi.yaml` (3.0.3, slice-3 surfaces only, nested Order DTO, **named `CreateOrderInput` oneOf** web/inbox, inputs omit unitPrice/total → server-authoritative, ErrorEnvelope, Settings/STK/ReplyTemplate/Dashboard, cookieAuth) + `internal/contract/{parity_test,structure_test}.go` (**4-way enum parity** OpenAPI==order==packages/core==PG; Role{owner,staff,system} vs UserRole/PG user_role{owner,staff}; + refs-resolve/opId-unique) + `spec.md §02` Review text→body + guard contract ARM; `make verify-go` ✓ (golangci 0, sqlc vet+diff, race incl parity) · **guard 145** (+1 contract ARM, tightened ≥4 Test*Parity+assertSame, PROVEN binding) · osm 22 · **parity PROVEN binding** REFUNDED-drift→RED · yaml.v3 indirect→direct (only dep change) · ADR-031 (no new ADR) · no EARS · **4-lens review wf_a95388f8-5d8: 3 confirmed (1 BLOCKER oapi-codegen opaque-union → named schema, RE-RAN codegen → 10 union methods) / 4 refuted, all fixed** |
| **Core slice 3 · PR-3c-2 — codegen (oapi-codegen strict-server) + `@lumin/api-client` + guard oapi ARM + D13** | **merged (PR #22)** | squash → `origin/main` `d10d30e` (2026-07-01 07:16Z) | `make verify-go` ✓ (golangci 0, sqlc vet+diff, **oapi generate+git-diff stale-check**, race) · `pnpm verify` ✓ (lint+typecheck+test incl new stale-gate + format:check; prettier/eslint ignore `*.gen.ts`) · guard **146** (+1 oapi ARM PROVEN binding: recipe must have `go generate`+`git diff --exit-code`, comment-strip vs `#`-false-pass) · osm 22 · committed `api.gen.go` (strict-server + chi-server, named `CreateOrderInput` union) + `schema.gen.ts` (openapi-typescript 7.13.0) · **go directive 1.23.6 preserved** (runtime v1.1.2 pinned) · D13 `plan.md` ledger checkbox ticked (Go REL-* stay `[ ]`) · **4-lens review wf_58d3da06: 2 confirmed (0 BLOCKER, both NOTE) / 0 refuted, both FIXED** (guard comment-strip + oapi-yaml comment) · deps +oapi-codegen/runtime v1.1.2 +openapi-typescript/openapi-fetch |
| **Core slice 3 · PR-3e-1 — auth self-issued login (migration 000009 + `internal/auth` + login/logout + seed-owner CLI)** | **merged (PR #24)** | squash → `origin/main` `0f665c4` (2026-07-01 15:33Z) | `make verify-go` ✓ (golangci 0, sqlc vet+diff, oapi+sqlc regen committed, `go test -race`) · guard **148** (+1 auth ARM PROVEN binding ×3: HttpOnly · bcrypt.CompareHashAndPassword · login VerifyPassword(nil); each mutate→RED→restore) · TS api-client typecheck+stale-gate+lint ✓ (schema.gen.ts regen for Set-Cookie) · ADR-030 self-issued JWT (no new ADR); user sub-decisions = seed-owner CLI (no committed secret) + 12h/no-refresh · **FAIL-FAST on forgeable dev-secret** · httpOnly+Secure+SameSite=Strict cookie, uniform-401 no-enumeration · AUTH-01/02 acceptance `[ ]` (Go-gated) · **deps +go-chi/jwtauth/v5 v5.4.0 +x/crypto direct; go 1.23.6 HELD** · **5-lens review wf_eab30b50: 4→3 confirmed (0 BLOCKER) / 1 refuted, ALL FIXED** |
| **Core slice 3 · PR-3f — order-intake prereqs (pricing + shipping + code-seq + customer/consent)** | **merged (PR #26)** | squash → `origin/main` `7ab0159` (2026-07-02) | `make verify-go` ✓ (golangci 0, sqlc vet+diff [+3 new queries regen], oapi stale-check clean, `go test -race`) · **integration RAN vs real Postgres (colima, -race):** ProductByID · NextOrderCode (monotonic/unique/#LMN-1000) · FindOrCreateCustomer (idempotent-by-phone) · GrantConsentIfAbsent (idempotent) + reversibility re-passes (renamed migration) · pricing unit+property Docker-free · guard **150** (+1 order-intake ARM PROVEN binding ×3: PriceItem derive BasePrice+PriceDelta · Selection no client-price field · NextOrderCode nextval; each mutate→149/1→restore) · osm 22 · **`internal/pricing`** PriceItem (catalog-derive UnitPrice, never client price, ADR-019) + engrave maxChars(rune) + ShippingFee-from-settings (province, no district ADR-017, 422-not-0) · `GetProductByID`+`nextval` order-code(`#LMN-%04d`)+FindOrCreateCustomer+idempotent-consent · **migration 000010** (renumbered from plan 000008 — spec-guardian WARN: 3e-1 took 000009 first; 3i→000011) · PRC-01/02 acceptance Cụm 8 `[ ]` (Go-gated) · **~290 non-test src (single PR, no split)** · **no new deps · no new ADR** (impl ADR-019/017) · **spec-guardian PASS: 0 BLOCKER / 1 WARN (renumber, FIXED) / 1 NOTE** (find-or-create race disclosed) · decisions.md ADR-033 "000008" aside left stale (hard-blocked file, flag in PR) |
| **Core slice 3 · PR-3e-2 — auth boundary: JWT-verify strict-mw + RBAC + actor injection** | **merged (PR #25)** | squash → `origin/main` `a442757` (2026-07-01) | `make verify-go` ✓ (golangci 0, sqlc vet+diff [+`GetUserByID` regen], oapi stale-check clean [no openapi change], `go test -race`) · guard **149** (+1 auth-boundary ARM PROVEN binding: router wire `StrictMiddlewareFunc{srv.authMiddleware}` non-nil + `resolveActor` `auth.Verify` + role-from-`UserByID`; nil-wire→148/1→restore) · osm 22 · core ledger 43/43 · fills the `nil` StrictMiddlewareFunc seam 3d left → unblocks fan-out {3g/3h/3i/3k→3j} · **fail-closed classify** (unlisted op→require) · public{login,logout} · optional{CreateOrder} · owner-only{UpdateBankAccount}=requireOwner · **role from DB row not token claim, `actorRole` never `system`, `!Active`→401** · Actor{ByUser=users.id,Role,At} ctx-inject · does NOT re-impl RBAC (domain guard source of truth) · errUnauthenticated→401·errForbidden→403·DB-fault→500-no-leak · RBA-01 acceptance `[ ]` (Go-gated) · **no new deps · no new ADR** (impl ADR-030/032) · ~190 non-test src · **spec-guardian PASS: 0 BLOCKER/0 WARN/1 NOTE** (optional path 401s present-but-broken cookie — deliberate, admin-only SameSite=Strict cookie) |
| **Core slice 3 · PR-3d — HTTP foundation (ErrorEnvelope + domain-error→status mapper + Server struct + withTx + strict-server stubs)** | **merged (PR #23)** | squash → `origin/main` `eac9b0f` (2026-07-01 09:29Z) | `make verify-go` ✓ (golangci 0, sqlc vet+diff, oapi stale-check, `go test -race` incl httpapi mapError/withTx/501-envelope/400-body-bind/400-param-bind tests) · guard **147** (+1 error-envelope ARM PROVEN binding [needs BOTH strict+chi seams] · + hardened NATS ARM [exclude tests+strip comments]; mutate→RED→restore) · osm 22 · TS ledger 17/17 · strict-server (ADR-031 D8); ADR-032 one-envelope + no-leak of Vietnamese `TransitionError.Message` NOR raw param/parser strings (BOTH oapi seams overridden) ; 8 endpoints = 501 stubs (3e–3k) · ERR-01 acceptance `[ ]` (Go-gated) · **no new deps · no new ADR** · Docker-free · ~300 lines non-test src · **5-lens review wf_f3cb8fbd: 10→5 confirmed/5 refuted, ALL FIXED** (2×IMPORTANT chi-wrapper plaintext leak on bad path-param → HandlerWithOptions+ChiServerOptions.ErrorHandlerFunc + regression test; 2×BLOCKER self-inflicted ERR-01 EARS line-wrap → reflowed; 1×NOTE NATS ARM widen) |
| **Core slice 3 · PR-3h — transition endpoints (dispatch-footgun + owner-gate + trackingCode-on-SHIPPING)** | **merged (PR #27)** | squash → `origin/main` `5fad85a` (2026-07-02) | Docker-free httpapi (staff-reconcile→403 · shipping-no-tracking→422 · missing-actor→401 · nil-body→400 · `toOrderDTO` full/empty-optionals/malformed-ts) + **integration RAN vs real Postgres (colima, -race):** PENDING→PAID→PRINTING→SHIPPING walk (exactly-one `order.paid` on reconcile · none on non-money edges [footgun] · trackingCode persist atomic · nested-DTO assembly) + invalid-edge→409/missing→404 envelope + `db.TestSetTrackingCode` (RETURNING reflects in-tx flip + ErrNotFound; **caught+fixed a leaked-tx→pool.Close-hang in my own test**) · guard **151** (+1 transition ARM PROVEN binding: `ConfirmPaymentTx`+`order.RoleOwner`+`SetTrackingCodeTx` in transition.go) · **dispatch footgun** `to=PAID`→`ConfirmPaymentTx` (only `order.paid` emitter) else→`AdvanceStatusTx` (locked #9) · **money-in owner-gate at BOUNDARY** (ConfirmPaymentTx hardcodes owner→domain guard can't reject staff→handler 403 pre-tx; money-OUT →REFUNDED stays domain-guarded via actor role) · SHIPPING `trackingCode` required + `SetTrackingCodeTx` same-tx atomic (no migration, col exists 000005) · shared `dto.go` assembler (3g reuses) · Actor from ctx/server-clock never body · PAY-01/SHP-01 acceptance Cụm 9 `[ ]` (Go-gated) · **~150 non-test src · no new deps · no new ADR** (impl locked #9/§6 D12) |
| **Core slice 3 · PR-3g — checkout `POST /orders` (web public + staff-gated inbox + server-priced money)** | **merged (PR #28) → `origin/main` `3fb254e`** | `feat/core-http-relay-3g` `df16b83` + review-fixes → squash `3fb254e` | `make verify-go` ✓ (golangci 0, sqlc vet+diff, oapi stale-check clean, `go test -race`) · **integration RAN vs real Postgres (colima, -race):** web-end-to-end (assemble-in-tx path) · inbox-staff-born-PAID · 7 pricing rejections · transition-walk unregressed · guard **152** (3g ARM intact: pricing.PriceItem+ShippingFee+errForbidden inbox-gate+CreateOrderTx) · **post-build multi-lens review `wf_4364e692-084` (6 money-path lenses × per-finding refute, 17 agents): 11 raw → 8 confirmed ALL NOTE / 0 BLOCKER / 0 IMPORTANT / 1 uncertain / 2 refuted** — fixes: ① `clientMoneyFields` case-fold (`{"Total"}`/`{"Items":[{"UnitPrice"}]}` bypassed exact-case reject; no money impact, restores fail-loud) + regression test · #6 assemble-DTO-inside-tx (post-write read fail rolls back, no dup-on-retry) · #8 missing settings→logged 500 not client 404 · #7-doc email-`@`-check unreached backstop (openapi_types.Email validates at decode) · #3-doc inbox 403 locked CHK-05 · no-action #2/#4/#5/uncertain (locked/deferred/by-design) · scratch verifier files deleted · **no new deps · no new ADR** (impl ADR-019/017/012/030) · CHK-04/05 acceptance Cụm 10 `[ ]` (Go-gated) · **spec-guardian PASS 0/0/1 NOTE** (3h post-commit path out-of-scope) |
| **Core slice 3 · PR-3i — admin dashboard aggregate (`GET /admin/dashboard`, payment-anchored net revenue)** | **merged (PR #29) → `origin/main` `c7ca0bc`** | squash → `c7ca0bc` (2026-07-02) | net-revenue theo `payment_confirmed_at` (đã-từng-PAID) + loại `REFUNDED` (giữ CANCELLED-sau-PAID, spec §04 — KHÔNG `status IN` ngây thơ) + `hcmDayBounds` (Asia/Ho_Chi_Minh UTC+7, `[start,end)`, không cắt UTC-midnight) · migration `000011_dashboard_idx` · guard **153** (+1 dashboard ARM: `dashboard.sql` `payment_confirmed_at`+`REFUNDED` + handler `hcmDayBounds`) · DASH-01 acceptance Cụm 11 `[ ]` (Go-gated) · integration vs real PG |
| **Core slice 3 · PR-3k — admin settings/STK (`GET /admin/settings` + owner-only `PATCH /admin/settings/bank-account` + reply-template reads)** | **✅ MERGED (PR #30) → `origin/main` `cf4c2a8`** | `feat/core-http-relay-3k` merge-commit, base `main` `c7ca0bc` (3i) | `make verify-go` ✓ (golangci 0, sqlc vet+diff, oapi stale-check clean [no openapi change], `go test -race`) · **integration RAN vs real Postgres (colima, -race):** `TestUpdateBankAccountEndToEnd` (column+audit atomic, changed_by from ctx, GetSettings reflects) · `TestGetSettingsSeededDefaults` · `TestListReplyTemplatesEndToEnd` (ORDER BY title) · guard **154** (+1 settings ARM PROVEN binding ×3: `UpdateBankAccountTx` + `order.RoleOwner` + `actorFrom`; each mutate→RED→restore) · **stubs.go DELETED (all 8 handlers implemented; prior session had left 3 duplicate stubs = compile blocker)** · **authz-FIRST** (owner re-assert `order.RoleOwner`→403 defense-in-depth before body validation) + `cleanBankUpdate` **bin đúng 6 napas digits**/accountNumber digits ≤19 + `UpdateBankAccountTx` audit-on-commit + changed_by from actor ctx · **review wf_929df5a0-540 (5 money-out lenses × per-finding refute + critic, 12 agents): 3 raw → 0 confirmed / 3 refuted; critic 1 IMPORTANT (bin-6-digit) + 1 NOTE (authz-order) FIXED, 1 NOTE (append-only) REFUTED (2g covers)** · STK-01 acceptance **Cụm 12** `[ ]` (Go-gated; 3i took Cụm 11) · **no new deps · no new ADR** (impl conventions §57/ADR-012/domain-core RBAC) · **spec-guardian PASS 0/0/2 NOTE** (openapi looser than server = safe fail-closed; unreachable 422) |
| **Core slice 3 · PR-3j — admin dashboard frontend (real `GET /admin/dashboard` fetch + adapters)** | **✅ MERGED (PR #31) → `origin/main` `8377926` (squash; CI green app-gates/selftest/services-gates). CLOSES the Core slice.** | `feat/core-http-relay-3j` `354a9b4` → `main` `8377926` | `pnpm verify` ✓ (lint+typecheck+test+format:check) · admin `next build` ✓ (route `ƒ Dynamic`) · api-client stale-gate ✓ (no openapi change) · guard **154** · osm 22 · **10 Docker-free tests** (adapter slotting · reviews synthesis · empty-state · cookie-forward · missing-cookie · non-2xx-throws · missing-env) · replaced `demo-dashboard.ts` → `lib/dashboard.ts` pure adapters (`toStatCards`/`toRecentOrders`/`toTodos`; reviews-todo from `stats.reviewsWaiting`) + `lib/dashboard-fetch.ts` server-side (httpOnly `lumin_session` cookie via next/headers → core-api, `no-store`, non-2xx→throw; `CORE_API_URL` server-only) + async server `page.tsx` + 3 components take props (**zero markup delta**) + a11y sr-only WCAG-1.4.1 cue · `@lumin/api-client` dep+transpile · **NO new ARM** (frontend, no Go/services invariant) · **no new deps beyond workspace link · no new ADR** · **review wf_6700cbed-be7: 0 lens-confirmed / 3 critic-gaps fixed / 1 refuted** · **spec-guardian PASS 0/0/1 NOTE** (401-retry deferred w/ login UI) · **CLOSES the Core HTTP+relay slice** |
| ADR-026 lane B/C/D · REC-20/28/39 | todo | — | — |

## Lần verify xanh gần nhất
**Core slice 3 · PR-3j — admin dashboard frontend (2026-07-02, PR #31, `354a9b4`):** `pnpm verify` rc=0 (eslint + `tsc --noEmit`
+ vitest + prettier `--check`) · admin `next build` ✓ (route `/` = `ƒ Dynamic` — `cookies()` opts out of static prerender, no
build-time fetch) · api-client stale-gate ✓ (no openapi change) · **guard.test.sh 154 / 0 · osm 22**. **New:** `apps/admin/src/lib/
dashboard.ts` (pure adapters `toStatCards`/`toRecentOrders`/`toTodos`) + `lib/dashboard-fetch.ts` (server-side `fetchDashboard`) +
`.env.example` (`CORE_API_URL`); `page.tsx` async server component; 3 components → props; `demo-dashboard.ts` deleted; `vi.ts`
+`needsAttention`; `next.config`/`package.json` +`@lumin/api-client`. **Tests (10, Docker-free):** adapter slotting · reviews-todo
synthesis from `stats.reviewsWaiting` · zero-state (`toRecentOrders([])→[]`, `highlight:false`) · label-key↔catalog · cookie-forward ·
missing-cookie empty-headers branch · non-2xx→throw · missing-`CORE_API_URL`. **Review fixes:** sr-only WCAG-1.4.1 cue + missing-cookie
test + operations.md CORE_API_URL note. **No new deps (workspace link only) · no new ADR · no new guard ARM** (frontend PR). colima
KHÔNG cần (all Docker-free; no Go/DB touched).
**Core slice 3 · PR-3k — admin settings/STK (2026-07-02, merged main [3i] `c7ca0bc`):** `make verify-go` rc=0 (gofmt + vet + golangci
v2 **0** + sqlc vet + sqlc diff + oapi generate+git-diff stale-check [clean — no openapi change] + `go test -race`) · guard.test.sh **154 / 0** ·
osm 22. **New:** `internal/httpapi/settings.go` (GetSettings/UpdateBankAccount/ListReplyTemplates strict handlers + DTOs +
`cleanBankUpdate`/`isDigits`) + `settings_test.go` (Docker-free unit) + `settings_integration_test.go`; removed 3 duplicate stubs
from `stubs.go`; guard 3k ARM; STK-01 acceptance Cụm 11. **Tests:** 4 Docker-free unit (`TestCleanBankUpdate` incl new bin-len/
accountNumber-numeric cases · `TestUpdateBankAccountRejectsNonOwner` staff→errForbidden · `TestSettingsDTODecodesJSONB`/`EmptyJSONB` ·
`TestReplyTemplatesDTO`). **Integration RAN vs real Postgres (colima, -race):** `TestUpdateBankAccountEndToEnd` (column+audit atomic,
changed_by from ctx) · `TestGetSettingsSeededDefaults` · `TestListReplyTemplatesEndToEnd`. Guard: +1 settings ARM PROVEN binding ×3
(`UpdateBankAccountTx` + `order.RoleOwner` + `actorFrom`; mutate→152/1→restore). **Review fixes:** authz-FIRST reorder + bin-6-digit/
accountNumber-numeric tighten (critic IMPORTANT+NOTE). **No new deps · no new ADR.** **spec-guardian PASS 0/0/2 NOTE.** colima ĐÃ
dùng (đã ở trạng thái running từ phiên trước — dùng as-is, để nguyên).
**Core slice 3 · PR-3f — order-intake prereqs (2026-07-02):** `make verify-go` rc=0 (gofmt + vet + golangci v2 **0** +
sqlc vet + sqlc diff [+`GetProductByID`/`NextOrderCode`/`InsertConsentGrantIfAbsent` regen] + oapi stale-check clean [no
openapi change] + `go test -race`) · guard.test.sh **150 / 0** · osm 22 · packages/core 45/45 (acceptance ledger 22, PRC-01/02
stay `[ ]`). **New:** `internal/pricing/pricing.go` (`PriceItem` catalog-derive UnitPrice + engrave-maxChars rune-count +
`ShippingFee` from settings province, no-district) + `pricing_test.go` (unit + overflow/dup/engrave-boundary + property
`TestPriceItemIsSumOfCatalogParts`) · migration `000010_order_code_seq` (`CREATE SEQUENCE START WITH 1000`) + `NextOrderCode`
query/seam (`#LMN-%04d` via nextval) · `GetProductByID`+`Catalog.ProductByID` · `Identity.FindOrCreateCustomer` +
`GrantConsentIfAbsent` + `InsertConsentGrantIfAbsent` query (ON CONFLICT active partial-idx) · guard order-intake ARM · acceptance
Cụm 8. **Integration RAN vs real Postgres (colima, -race):** `TestProductByID`/`TestNextOrderCode`/`TestFindOrCreateCustomer`/
`TestGrantConsentIfAbsent` + `TestMigrationsReversible` re-passes with renamed migration. Guard: +1 order-intake ARM PROVEN
binding ×3 (PriceItem BasePrice+PriceDelta · Selection no client-price · nextval; mutate→149/1→restore). **No new deps · no new
ADR** (ADR-019/017; §6 D9/D10). **spec-guardian PASS 0/1-WARN(renumber 000008→000010, FIXED)/1-NOTE.** colima ĐÃ dùng (integration
+ reversibility RAN, then stopped).
**Core slice 3 · PR-3e-2 — auth boundary + RBAC (2026-07-01):** `make verify-go` rc=0 (gofmt + vet + golangci v2 **0** +
sqlc vet + sqlc diff [+`GetUserByID` regen committed] + oapi generate+git-diff stale-check [clean — no openapi change] +
`go test -race`) · guard.test.sh **149 / 0** · osm 22 · packages/core 43/43 (ledger 20, RBA-01 stays `[ ]`). **New:**
`internal/httpapi/middleware_auth.go` (`authMiddleware` StrictMiddlewareFunc · `classify` fail-closed · `resolveActor`
verify→uuid→UserByID→role-from-DB · `actorRole` never-system) + `actor.go` (Actor + unexported ctx key) + `auth.Verify`/
`Claims` (jwtauth.VerifyToken sig+exp) + `db.Identity.UserByID` (+`GetUserByID` sqlc) + errors.go 401/403 (+code FORBIDDEN)
+ router wires the mw (non-nil slice). **Tests:** 17 httpapi mw tests (missing/tampered/unknown/inactive cookie · DB-fault→500 ·
public-skip · optional present/absent/invalid · owner-only allow/reject · classify-fail-closed · actorRole-never-system ·
3 wire tests through NewRouter) + fixed `TestDomainRouteReturns501Envelope` (authenticate first via `testAuthedRouter`) +
UserByID folded into `TestUserRoundTrip` (skip-local/run-CI). Guard: +1 auth-boundary ARM PROVEN binding (nil-wire→148/1→restore).
**No new deps · no new ADR** (ADR-030/032). **spec-guardian PASS 0/0/1** (present-but-broken optional cookie → 401, deliberate).
colima KHÔNG cần (mw tests Docker-free; UserByID integration skips local).
**Core slice 3 · PR-3e-1 — auth self-issued login (2026-07-01):** `make verify-go` rc=0 (gofmt + vet + golangci v2 **0** +
sqlc vet + sqlc diff + oapi generate+git-diff stale-check + `go test -race`) · guard.test.sh **148 / 0** · osm 22 · TS
api-client (typecheck + `schema.stale.test.ts` + eslint) ✓ · packages/core 42/42 (acceptance ledger 19, AUTH-01/02 consumed).
**New:** migration `000009_user_credentials` (nullable `password_hash`, pure DDL) + `db/queries/users.sql` `UpsertOwnerCredential`
+ sqlc regen; `internal/auth/auth.go` (`Issuer` jwtauth/v5 HS256 · `Issue`/`Clear` httpOnly+Secure+SameSite=Strict cookie ·
`VerifyPassword` bcrypt timing-equalized · `HashPassword`); `internal/httpapi/auth.go` (`LoginUser`/`LogoutUser`, uniform-401
no-enumeration, 500-no-leak, generated `Headers.SetCookie`); `internal/httpapi/server.go` (`auth`+`users userReader` seam);
`cmd/seed-owner`; config JWT/cookie knobs + `UsesForgeableJWTSecret` fail-fast; `main.go` wiring; `openapi.yaml` Set-Cookie
headers (+api.gen.go/schema.gen.ts regen); guard auth ARM; acceptance Cụm 6; operations.md §4b. **Tests:** auth unit (cookie
flags/claims/foreign-secret-reject/clear/VerifyPassword), httpapi login E2E (success-cookie-not-in-body · wrong-pw/unknown-email
uniform-401 · inactive · DB-fault-500-no-leak · logout-clears), config auth-defaults + `TestUsesForgeableJWTSecret` table, db
`TestUpsertOwnerCredentialRoundTrip` (integration, skip-local/run-CI) + NULL-hash assertion. Guard: +1 auth ARM PROVEN binding ×3
(HttpOnly · bcrypt-compare · VerifyPassword(nil); mutate→RED→restore). **Deps:** +go-chi/jwtauth/v5 v5.4.0 (+lestrrat jwx/v3),
x/crypto→direct; **go directive HELD 1.23.6**. **No new ADR** (ADR-030). **5-lens review wf_eab30b50: 4→3 confirmed / 1 refuted,
ALL FIXED** (dev-secret fail-fast + openapi Set-Cookie header + operations.md docs). colima NOT needed (DB integration skips local).
**Core slice 3 · PR-3d — HTTP foundation (2026-07-01):** `make verify-go` rc=0 (gofmt + vet + golangci v2 **0** + sqlc
vet + sqlc diff + oapi generate+git-diff stale-check + `go test -race`) · guard.test.sh **147 / 0** · osm 22. **New:**
`internal/httpapi/errors.go` (mapError ADR-032 table + `writeError` + strict hooks `handleResponseError`/`handleRequestError`),
`server.go` (`Server{logger,pool,nats}` impl `api.StrictServerInterface` + `(*Server).readiness` + `withTx`+`txBeginner`),
`stubs.go` (8×501 NOT_IMPLEMENTED), rewired `router.go` (`NewStrictHandlerWithOptions`+`HandlerFromMux`, sig unchanged).
Tests: `TestMapErrorTable` (18 cases), `TestMapErrorNeverLeaksDomainMessage`, `TestDomainRouteReturns501Envelope`,
`TestBadJSONBodyReturns400Validation`, withTx commit/rollback/panic/begin-err/commit-err (fake `pgx.Tx`, Docker-free).
Guard: +1 error-envelope ARM **PROVEN binding** (rename `ResponseErrorHandlerFunc`/`mapError`/`ChiServerOptions` token→RED ·
comment-out→RED · restore→147); NATS-readiness ARM widened from pinning `router.go` to grepping httpapi **prod** files (readiness
moved to a `Server` method; `--exclude=*_test.go` + strip comments so a test/comment can't false-PASS). ERR-01 → acceptance.md `[ ]`.
**5-lens review wf_f3cb8fbd (10→5 confirmed/5 refuted, ALL FIXED):** the router mounted via `HandlerFromMux`, leaving the CHI-wrapper
`ErrorHandlerFunc` at oapi-codegen's plaintext default → a non-UUID `{id}` on the transition route leaked `text/plain` + echoed input
(param-binding fires before the strict layer) → now `HandlerWithOptions` w/ `ChiServerOptions.ErrorHandlerFunc` + `TestBadPathParamReturns400Validation`
(revert→RED proven); the `ERR-01` row's line-wrap tripped REC-18 EARS-lint (guard 146/1 — I'd verified guard before adding the row) → reflowed.
**No new deps · no new ADR** (implements ADR-032). colima KHÔNG cần.
**Core slice 3 · PR-3c-2 — codegen + `@lumin/api-client` (2026-07-01):** `make verify-go` rc=0 (gofmt + vet + golangci
v2 **0** + sqlc vet + sqlc diff + **`go generate ./internal/api/…` + `git diff --exit-code` oapi stale-check** + `go
test -race`) · `pnpm verify` rc=0 (turbo lint + typecheck + test incl the NEW `@lumin/api-client` stale-gate +
format:check) · guard **146** · osm 22. **GO codegen:** `oapi-codegen@v2.5.1` (pinned in `//go:generate`; config
`internal/api/oapi-codegen.yaml` = strict-server + chi-server + models) → committed `internal/api/api.gen.go` (1400
dòng; `ServerInterface`/`StrictServerInterface` cho cả 8 op; named `CreateOrderInput` discriminated union — giữ đúng
fix BLOCKER của 3c-1). Dep `github.com/oapi-codegen/runtime v1.1.2` **pinned** (v1.4.2→x/crypto→go 1.24; **go.mod giữ
1.23.6**). `.golangci.yml` `generated:lax` + `paths:'.*\.gen\.go$'`. **TS:** NEW `packages/api-client` (`@lumin/api-client`):
openapi-typescript **7.13.0** → committed `src/schema.gen.ts` + openapi-fetch **0.13.8** `createApiClient` (cookie-cred
default per ADR-030) + `scripts/codegen.mjs` (một render fn) + `test/schema.stale.test.ts` (import chính render fn đó →
byte-equality gate) + `**/*.gen.ts` eslint+prettier-ignore. **Harness:** guard oapi ARM 145→**146** (recipe PHẢI chạy
CẢ `go generate` + `git diff --exit-code`; strip dòng comment nên verb bị `#`-comment không false-pass — hardened
sibling sqlc ARM luôn). **D13:** `docs/plan.md` acceptance-ledger checkbox ✅ (parser `packages/core/test/
acceptance.ledger.test.ts` pre-existed + passes + armed; Go REL-01/02 GIỮ `[ ]` — parser chỉ resolve id TS). **Cả 3
gate mới PROVEN binding** (mutate→RED→restore: oapi ARM drop-enforce→145/1; Go stale-check contract-drift→RED; TS
stale-check schema-drift→RED; comment-out re-proven→RED sau fix). Docker-free (PR này không test DB/NATS). **4-lens
review wf_58d3da06: 2 confirmed (0 BLOCKER, both NOTE) / 0 refuted, BOTH FIXED** — (NOTE) guard ARM unanchored grep để
verb `#`-comment false-pass (cùng class lỗ `//` của 3b) → strip comment lines; (NOTE) `oapi-codegen.yaml` comment tả
embedded-spec nhưng gắn nhầm dòng no-op `skip-prune` → chuyển vào `generate:` + bỏ dòng. (1/4 review lens stalled
no-report; territory của nó — go-1.23 preserved / golangci 0 / CI compatible — đã tự verify.) **Deps:**
+oapi-codegen/runtime v1.1.2 +apapsch/go-jsonmerge/v2 (Go); +openapi-typescript +openapi-fetch (TS). **No new ADR**
(implements ADR-031/§6 D8). **No EARS row** (codegen tooling). colima KHÔNG cần (Docker-free PR).
**Core slice 3 · PR-3c-1 — OpenAPI contract authoring (2026-06-28):** `make verify-go` ✓ (gofmt + go vet + golangci v2
**0** + sqlc vet + sqlc diff + `go test -race`). Docker-free (contract authoring; no DB/NATS test). Hand-authored
`services/core-api/openapi.yaml` (**OpenAPI 3.0.3**) = the single wire contract (ADR-031): paths for
auth(login/logout) · `POST /orders` (oneOf web/inbox + discriminator) · `POST /orders/{id}/transitions` ·
`GET /admin/dashboard` · `GET /admin/settings` · owner-only `PATCH /admin/settings/bank-account` ·
`GET /admin/reply-templates`; schemas = nested `Order` DTO (NOT flat sqlc row) + `OrderItemInput` (omits unitPrice —
server re-derives, always-must #2) + Customer/Address/Personalization/StatusEvent + `ErrorEnvelope{code,messageKey,
fields?}` + Settings/BankAccount{bin,accountNumber,accountName}/ReplyTemplate + Dashboard{stats,recentOrders,todos} +
LoginRequest/AuthUser; cookieAuth securityScheme; money `integer,format:int64`; camelCase. `internal/contract/
parity_test.go` = **4-way enum parity** (OpenAPI == `internal/order` == `packages/core` Zod == PG `000001`) for
OrderStatus(7)/Channel(2)/Role(3), + the `system` asymmetry: actor **Role**{owner,staff,system} vs stored
**UserRole**/PG `user_role`{owner,staff}, asserted explicitly (Role minus system == UserRole). `spec.md §02` Review
field `text`→`body` (DB/Go already `body`; Personalization.text untouched). guard **145** (+1 contract ARM:
openapi.yaml present → parity_test must reference all 4 sources — PROVEN binding: removed parity_test → 144/1);
**parity PROVEN binding** (drift `REFUNDED`→`REFUNDEDX` in openapi → `TestOrderStatusParity` RED → restored). osm 22.
Only dep change: `gopkg.in/yaml.v3` indirect→direct (parity test parses the YAML). **No new ADR** (implements ADR-031,
landed `ecd06fa`). **No EARS row** (contract-authoring, no runtime invariant). **4-lens review wf_a95388f8-5d8: 3
confirmed (1 BLOCKER) / 4 refuted, all fixed** — BLOCKER: inline `oneOf`+discriminator on `POST /orders` made
oapi-codegen v2.5.1 emit an opaque `union json.RawMessage` (unexported, 0 methods) that strict-server can't read →
extracted a NAMED `CreateOrderInput` schema → **re-ran oapi-codegen: 10 union methods, exit 0**; +optionIds `format:uuid`;
+tightened contract ARM (≥4 Test*Parity + assertSame, proven binding). (colima NOT needed — Docker-free PR.)
**Core slice 3 · PR-3b — relay drain loop (2026-06-27):** `make verify-go` ✓ (gofmt + go vet + golangci v2 **0** + sqlc
vet + sqlc diff + `go test -race`). **9 relay tests RAN vs real Postgres + NATS/JetStream** (testcontainers via local
**colima**, -race, not just CI): `TestRelayDrainsPendingToStream` (pending→published, literal event_type subject +
`Nats-Msg-Id`=outbox.id in ORDERS), `TestRelayLateLowSeqDrains` (**the watermark-loss regression** — a lower-seq tx that
commits AFTER a higher-seq tx already published still drains; a `seq>cursor` would lose it = silent money-event loss),
`TestRelayNoStreamTransientThenRecovers` (no-stream → transient: row stays pending + attempts 0 + inline topology
re-ensure → drains next tick), `TestRelayDedupCollapsesRepublish` (crash-after-PubAck → same `Nats-Msg-Id` republish →
stream stays 1 msg) + **7 Docker-free unit** (`isTransient` set, happy, broker-down-skips-publish, transient-no-attempts-burn,
poison-quarantined-head-of-line, **panic-recovered-loop-continues, newRelay-clamps-non-positive-knobs** — 2 latter from review).
`internal/relay/relay.go` (drain loop) + 4 `db/queries/outbox.sql`
queries (`SelectPendingOutbox` scans pending-SET `ORDER BY seq`, **no watermark/SKIP-LOCKED**) + natsx `PublishMsg`/
`ReEnsureOnReconnect` + main.go lifecycle (relay goroutine, stopRelay cancel+join before nc.Close/pool.Close). **publish →
await PubAck → mark** order; transient (conn down / no-stream) leaves batch pending + no attempts burn + re-ensures;
poison (PubAck reject on reachable broker) → `attempts++` → `failed` after `RelayMaxAttempts`, head-of-line preserved;
panic-recovery wraps each tick. guard **144** (+2 relay ARM proven binding mutate→RED→restore), osm 22, **no new deps**.
5-lens adversarial review wf_81c76244 running. NOTE: colima started locally to run integration tests — stopped after.
**Core slice 2 · PR-2g — config/reference (2026-06-26):** `make verify-go` ✓ (gofmt + go vet + golangci v2 **0** +
sqlc vet + sqlc diff + `go test -race`). **6 settings integration tests RAN vs real Postgres** (testcontainers via
local **colima**, not just CI): singleton guard (2nd `id=true`→PK reject / `id=false`→CHECK reject), the
`UpdateBankAccountTx` audit seam (update+audit atomic, rollback leaves neither, history accumulates),
**DB-enforced append-only — UPDATE + DELETE + TRUNCATE all rejected** (row-level + statement-level triggers),
`validate()` rejecting JSON null/`{}`/`[]`/non-object STK, **seq-ordered newest-first** + nil-reason→NULL, reply-template
round-trip; `TestMigrationsReversible` re-passes (000007 down drops both tables + the trigger function; no new enum
types). `000007_settings` + `db/queries/settings.sql` + `internal/db/settings.go` (`Settings` repo + `UpdateBankAccountTx`
seam). **bank_account split off `UpdateSettings`** → only the seam writes it (+ its audit row, conventions §57).
guard 141 · osm 22 · **no new deps**. **Adversarial review wf_70129d8e (5 lenses → per-finding verify): 7 confirmed /
5 refuted, all confirmed fixed** — 2 IMPORTANT money-out (TRUNCATE bypassed the row-level append-only trigger → added
BEFORE TRUNCATE guard + test; `validate()` accepted JSON null/`{}`/`[]` → require non-empty object) + seq/ordering test.
NOTE: colima started locally to run integration tests — stopped after.
**Core slice 2 · PR-2f — fulfillment/asset (2026-06-26):** `make verify-go` ✓ (gofmt + go vet + golangci v2 **0** +
sqlc vet + sqlc diff + `go test -race`). **9 jobs integration tests RAN vs real Postgres** (testcontainers via local
**colima**, not just CI): asset-job create emits `asset_job.created` (payload carries source pointer + jobType, ADR-006),
rollback leaves 0 job + 0 outbox, duplicate job-id rejected (PK; dedup_key UNIQUE backstop), both `model_ingest` +
`sprite_render` queued, NotFound, worker-callback lifecycle mark (queued→processing→ready + completed_at), print-queue
round-trip + staff stage-advance (NEED_PRINT→PRINTING) + `ON DELETE CASCADE` (print job dies with its order item), and
`TestMigrationsReversible` re-passes (000006 down drops `asset_job_status`/`asset_job_type`). `000006_jobs` + `db/queries/
jobs.sql` + `internal/db/jobs.go` (`Jobs` repo + `CreateAssetJobTx`). **D3** (asset shape, user): split `asset_job_type`
{model_ingest, sprite_render}, `source_model_url`+`source_version`, outputs→Product. **D6** (user): print stage STORED.
guard 141 · osm 22 · **no new deps**. NOTE: colima started locally to run integration tests — stopped after.
**Core slice 2 · PR-2e — order spine (2026-06-26):** `make verify-go` ✓ (golangci **0**, sqlc vet+diff clean,
`go test -race`). **Integration tests RAN against real Postgres** (testcontainers via local **colima**, not just CI):
all order tests PASS incl. `TestConcurrentReconcileSerializes` (two goroutines race PENDING_CONFIRM→PAID under
`-race`; FOR-UPDATE lock → 1 commit + 1 INVALID_EDGE, exactly one `order.paid`, no double-append) + jsonb/enum sqlc
override round-trips + outbox rollback-atomicity + refund-proof denormalization consistency + owner-only RBAC + money
CHECK + multi-hop replay. `000005_orders` + `db/queries/orders.sql` (incl. `GetOrderForUpdate` FOR UPDATE) +
`internal/db/orders.go` (3 tx seams) + `internal/order/order.go` (Address/Personalization/GenesisEvent). Totals via
`money.CalcTotals` (no client total). 4-lens adversarial review (wf_ac186d9c): 14 raw → 9 confirmed, **all addressed**
(2 IMPORTANT: `CreateOrderTx` empty-items guard `ErrNoItems` + concurrent-reconcile lock test). guard 141 · osm 22 ·
**no new deps**. NOTE: colima started locally to run integration tests — stop after merge (home box normally Docker-less).
**Core slice 2 · PR-2d — identity + PDPL consent (2026-06-26):** `make verify-go` ✓ — `000004_identity` (customers/
consent_grants/users + ALTER reviews ADD customer_id FK→customers ON DELETE SET NULL) + 8 sqlc queries + thin
`Identity` repo. consent_grants append-then-mark (partial UNIQUE active per customer/scope/channel; withdraw=now(),
no delete); addresses jsonb NO district (ADR-017); user_role owner/staff only (no system). Tests (testcontainers
skip-local/run-CI): customer round-trip + address-no-district + consent grant/withdraw/re-grant + active-uniqueness
+ user round-trip. vn-compliance skill loaded. **No new deps.** guard 141, osm 22.
**Core slice 2 · PR-2c — catalog (2026-06-26):** `make verify-go` ✓ (GOTOOLCHAIN=local go 1.23.6) — `000003_catalog`
(categories/products/colors/options/reviews; material TEXT+CHECK, money int8 CHECK≥0, product_status/option_type/
review_status native enums, reviews.customer_id bare uuid→FK in 000004) + 9 sqlc queries + thin `Catalog` repo
(internal/db/catalog.go, ErrNotFound on slug-get). sqlc vet validates 9 queries; nullable customer_id→pgtype.UUID,
max_chars→*int32, rating_avg→*float32, jsonb→[]byte. Tests (testcontainers skip-local/run-CI): round-trip +
negative-money CHECK + rating-1..5 CHECK + null-customer review. guard 141, osm 22. **No new deps** (reuse pgx/uuid/
testcontainers từ 2b). Catalog không có TS contract (packages/core order-only). EARS deferred (slice-1 precedent).
**Core slice 2 · PR-2b — outbox table + tx-insert seam (2026-06-26):** `make verify-go` ✓ (GOTOOLCHAIN=local
go 1.23.6) — migration `000002_outbox` + `InsertOutbox` query + `EnqueueOutbox(ctx, tx pgx.Tx, ev OutboxEvent)`
(tx-first-arg dual-write guard, ADR-006). sqlc overrides uuid→google/uuid, outbox.payload→json.RawMessage.
Tests: pure `validate` (runs everywhere) + testcontainers atomicity (rollback→0/commit→1/dup-dedup→reject) +
migration-reversibility (in-test SQL applier, no golang-migrate dep) — **skip local (no Docker, recover-guard
quanh `SkipIfProviderIsNotHealthy` panic), RUN in CI**. `sqlc vet` giờ validate `InsertOutbox` vs outbox schema.
guard.test.sh **141** (testcontainers real-check ACTIVE), osm 22. Deps +google/uuid v1.6.0 (runtime) +
testcontainers-go v0.34.0/postgres module (test) — go directive giữ 1.23. go.sum phình (lock-file, docker/otel
transitive). macOS arm64: cảnh báo cgo go-m1cpu vô hại (không có ở CI linux).
**Core slice 2 · PR-2a — data-layer infra (2026-06-26):** `make verify-go` ✓ — gofmt + go vet + golangci v2.12.2
(**0 issues**) + **`sqlc vet`** + **`sqlc diff`** (no-DB: query↔schema compile + generated-code không stale) +
`go test -race ./...` (config 6 / db 3 / httpapi 4 incl readyz-503-khi-DB-chết / money / order; sqlc + cmd no-test).
`tests/harness/guard.test.sh` **141 / 0** (+2: sqlc-vet-in-recipe + testcontainers-arm-when-land; sqlc ARM-GUARD
**proven binding** — gỡ `sqlc vet` khỏi Makefile → guard ĐỎ → restore). `osm-mutation.test.sh` 22 / 0. Toolchain
verify dưới **GOTOOLCHAIN=local go 1.23.6** (CI go-1.23 sẽ qua). go.mod: pgx **v5.7.5** (v5.10 ép go 1.25 → pin
xuống) + x/crypto/sync/text 1.23-compat; sqlc CLI **v1.30.0** (CI `harness.yml` thêm step cài binary pinned).
Bug bắt lúc dựng: query file `_ping.sql` → `_ping.sql.go` bị Go **bỏ qua** (file `_`-prefix) → `*Queries` thiếu
`Ping` → đổi tên `ping.sql`.
**Core slice 1 — Go spine (2026-06-26):** `make verify-go` ✓ (gofmt + go vet + golangci v2.12.2 + `go test -race`,
**17 test**: `internal/order` state machine OSM-01..05 + replay + property; `internal/money` `CalcTotals` MNY-01/02
+ overflow + property). 5-lens adversarial review (wf_3ccae648, 16 agent): 0 BLOCKER, 7 confirmed (2 positive),
fix 2 — (a) money int64 **overflow guard** (`addChecked`/`mulChecked` → `errOverflow` thay vì wrap âm câm; vector
= quantity ác ý) + (b) test ngày bất-khả (`2026-13-99...Z`) ép **time.Parse backstop** của `isISOUTC`; cả hai
**proven binding** (mutate-run-restore → RED). 3 NOTE giữ-nguyên-có-chủ-đích: server Go **strict hơn** TS reference
ở ts/url dị dạng (an toàn hơn — đã ghi comment). guard 139 · osm 22 · spec-guardian PASS.
**Services backbone (2026-06-26):** `make verify-go` ✓ (gofmt-clean + `go vet` + **golangci-lint v2.12.2**
[ADR-020 — local tool nâng v1.64.8→v2, `.golangci.yml` v2-schema] + **`go test -race ./...`** — config 3 /
httpapi 3 = **6** test, `health`/`readyz`/404) · `make verify-rs` ✓ (`cargo fmt --check` + `cargo clippy
--all-targets -D warnings` + `cargo test` — **3** test) · `tests/harness/guard.test.sh` — **139 / 0** (ARM-GUARD
giờ thấy `.go`→`verify-go` + `.rs`→`verify-rs` ✓) · `osm-mutation.test.sh` — **22 / 0** · `pnpm verify` — **rc=0**
(services NGOÀI JS-workspace; `/services/` vào `.prettierignore` để prettier không tranh gofmt/rustfmt).
**Review 4-lens (workflow wf_f5948e52, adversarial-verify):** 0 BLOCKER · 2 WARN đã sửa (CI golangci PATH→
`$GITHUB_PATH`; v1→v2 ADR-020) · notes đã áp (Go timeout/Timeout-cooperative TODO + writeJSON buffer-then-write;
Rust flush-log + warn-on-err + default-pin test). golangci bắt 1 finding thật lúc dựng: `chi middleware.RealIP`
deprecated (SA1019, IP-spoofable) → bỏ, dùng CF-Connecting-IP ở edge-phase. core-api `:8080` (khớp Caddy/compose).
**App shells (2026-06-26, lịch sử):** `pnpm verify` rc=0 · `next build` storefront ✓ · guard 139 · osm 22 ·
spec-guardian PASS (0/0/2).

## Lưu ý git (2026-06-26, cập nhật)
- `origin/main` = **`f1b35d2`** (PR #21 PR-3c-1 OpenAPI contract squash-merged 2026-06-27 23:45Z). Local main ĐÃ ff về
  `f1b35d2`, working tree clean (đang trên nhánh `feat/core-http-relay-3c-2`). **Relay track 3a→3b + contract 3c-1 ALL
  MERGED** (slice 2 2a–2g cũng đã merged trước đó). Verify:
  `git cat-file -t origin/main:services/core-api/openapi.yaml` = blob (contract on main). (lịch sử pointer: PR #20 3b
  `c3b2004`; PR #19 3a `280e94b`; PR #18 2g `ffab5f8`; PR #10 `ab99360`.)
- **Housekeeping nợ (chờ chủ duyệt xoá):** 9 local `:gone` branches (`feat/core-data-layer-2e`, `feat/core-data-model`,
  `feat/phase-0-*` x7, `fix/dev-handoff-refunded`) + the now-merged `feat/core-data-layer-2g` (squashed into `ffab5f8`)
  — prune khi chủ OK. `main` local đã ff `ffab5f8`.
- **Services-backbone slice (nhánh `feat/phase-0-services-backbone` off `bf1b7a5`):** thêm `services/core-api`
  (Go+Chi) + `services/asset-worker` (Rust+tokio+async-nats) + root `Makefile` (verify-go/verify-rs) + CI
  `services-gates` + `/services/` vào `.prettierignore`. Go module = `github.com/huongnguyenduc/lumin-studio/
  services/core-api`. **Scaffold-only:** không DB/NATS-live/domain (await shutdown signal). Dockerfile + mở
  comment compose = DEFERRED (gắn GPU gate). Lock-file (go.sum + Cargo.lock) committed → diff "lớn" nhưng code
  tay nhỏ; diff-size advisory sẽ kêu (bỏ qua, do lock-file).
- **golangci-lint v2 (ADR-020):** local tool ở `~/go/bin` đã nâng **v1.64.8 → v2.12.2** (install.sh) để verify;
  `.golangci.yml` là **v2-schema** (`version: "2"`). CI `services-gates` cài đúng v2.12.2. Máy khác checkout
  repo này **cần golangci-lint v2** (v1 không parse được config v2). `verify-go` = gofmt + go vet + golangci v2
  + `go test -race`. `sqlc vet` (ADR-020) vẫn DEFERRED tới khi có query sqlc (arm-when-land).
- **(lịch sử)** `b77acb7` = PR #7 storefront-shell. Chứa `apps/storefront` + infra.
- **⚠️ STACKED-MERGE FOOTGUN (đã sửa):** PR #8 (admin) base = `feat/phase-0-storefront-shell` (KHÔNG phải
  main). Khi #7 squash-merge vào main *riêng*, GitHub auto-đóng #8 là "MERGED" — nhưng diff #8 chỉ vào nhánh
  storefront-shell đã chết (`c13202d`), **chưa bao giờ tới main**. `git cat-file origin/main:apps/admin` =
  "NOT on main". → Re-land bằng `git rebase --onto b77acb7 5b95786` (4 commit admin, 0 conflict) sang nhánh
  mới **`feat/phase-0-admin`** → **PR #9** (base=main, đã push). Bài học: **đừng tin nhãn "merged" của stacked
  PR — verify `git cat-file <main>:<path>`.** Backup nhánh gốc: tag `backup-admin-pre-reland` (= e0fce89).
- Branch **`feat/phase-0-admin-shell`** (orig, tip `e0fce89`): GIỮ làm backup, đừng force-push (PR #8 ref nó).
- **/review fixes round (2026-06-26, force-push cả 2 PR — chủ duyệt):** (1) `error.tsx` retry (cả 2 app) đổi
  pill thủ công → `@lumin/ui <Button>` (md=h-11=44px, token primary AA) khỏi drift design-system; (2) thêm
  `CtaLink` (storefront) gói pop/outline cho CTA-điều-hướng (Button render `<button>`, không mang href được) +
  ép `min-h-[44px]` → bỏ 3 blob class lặp ở hero/featured; (3) sửa comment "Hanken Grotesque"→"Grotesk" ở
  storefront `tailwind.config.ts`; (4) `TODO(phase-1)` scope client catalog khi `@lumin/core` phình; (5) viết
  lại body PR #7/#8 (xoá claim "Fontsource/Plus Jakarta" cũ — thực tế là `next/font/google` + Hanken Grotesk).
  build/verify/guard 139/osm 22 xanh lại sau fix. Copyright year `© 2026` để **cố ý** baked (deterministic, né
  `new Date()`) — không phải defect.
- **Deferred (ghi để PR sau):** `@lumin/ui` Button `lg` dùng `h-13` không có spacing token → render 0 height;
  shell tránh `lg`. Fix gọn ở packages/ui (thêm token `13`/đổi `h-[52px]`) — KHÔNG trộn vào PR app-shell.
- **Font name fix (2026-06-26):** body font dùng đúng **Hanken Grotesk** (design-system.md/tokens viết sai
  "Hanken Grotesque" — đó là lý do trước đây tưởng không có). **Upgrade Next 14→15** (React giữ 18.3, peer cho
  phép) để next/font/google; bỏ Fontsource. design-system.md/tokens vẫn ghi "Hanken Grotesque" → nên sửa ở PR
  packages sau (literal name bị app override qua CSS-var nên không vỡ). `prettier-plugin-tailwindcss` +
  `@next/eslint-plugin` vẫn deferred — không phải ARM gate.
