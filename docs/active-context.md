# Active context — focus đang chạy

> **File "đang ở đâu"** (volatile, đổi liên tục). `session-start` echo ~3000 byte đầu khi mở phiên ·
> `pre-compact` ghim làm "plan sống" · `verify-before-stop` nhắc cập nhật khi đổi >1 file source. Giữ phần
> load-bearing (Focus · Next · Ledger) **gần đầu file**. Đây **không** phải nguồn chân lý — chỉ scratchpad phối
> hợp; muốn binding phải thành ADR/luật (`agent-harness.md` §Ranh giới promote memory).

## Focus
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
**PR-2f (fulfillment/asset) ✅ DONE — branch `feat/core-data-layer-2f` off `cf31cb2`, PR pending push.**
`000006_jobs` (asset_jobs + print_jobs + 2 new enums) + `db/queries/jobs.sql` + `internal/db/jobs.go` (`Jobs` repo +
3rd emit-seam `CreateAssetJobTx` → `asset_job.created`). **D3 resolved (user):** AssetJob shape inferred (no spec
§02 table) → SPLIT `asset_job_type` {model_ingest, sprite_render}; `source_model_url`+`source_version` (content-hash)
reconstructable (ADR-006); outputs→Product (job input-only). **D6 resolved (user):** `print_jobs.stage` STORED (staff
drag-drop, finer than order status, Pet-Tag NFC stage later). print_jobs no emit-seam (admin-internal SSE slice 3).
`make verify-go` green; **9 jobs integration tests RAN vs real Postgres (colima)** + reversibility re-passes; guard
141 / osm 22; **no new deps**. **NEXT = PR-2g — config/reference** (`000007_settings`: reply_templates + settings
singleton [refund_policy, bank_account VietQR] + `setting_bank_audit` append-only owner-only; NO e-invoice/tax cols);
invoke `vn-compliance`. Then slice 3 (HTTP/relay).

> Lịch sử app-shell/backbone Phase-0 (storefront/admin/services scaffold) đã archive — xem `git log` + PR #5–#10.

## Next steps (1–3)
1. **Slice 2 — data layer** (off `main` `10b31f6`, nhánh mới `feat/core-data-layer`): sqlc models `spec.md §02`
   (Product/Color/Option/Order/OrderItem/PrintJob/AssetJob/Review/Customer/User/ReplyTemplate/Setting) + **outbox**
   + migration + pgx pool; arm `sqlc vet`+testcontainers (ADR-020). Address province→ward→street (ADR-017);
   `channel` enum + zalo; consent record trên Customer.
2. **Slice 3 — HTTP:** `POST /orders` (web→PENDING_CONFIRM+ảnh CK, inbox→PAID) + transition endpoints + RBAC mw +
   outbox publish-on-commit; thay `apps/admin/src/lib/demo-dashboard.ts` placeholder bằng aggregate thật.
3. **Housekeeping:** xoá nhánh đã merge (`feat/core-data-model` local+remote; prune `:gone` local branches) khi
   chủ duyệt. Sau Core phase: ADR-026 lane B/C/D · REC-20/28/39.

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
| **Core slice 2 · PR-2f — fulfillment/asset (asset_jobs + print_jobs + 3rd emit-seam)** | **done (PR pending push)** | `feat/core-data-layer-2f` off `cf31cb2` | `make verify-go` ✓ (golangci 0, sqlc vet+diff clean, `go test -race`); **9 jobs integration tests RAN vs real Postgres (colima)** — asset_job.created emit + payload pointer, rollback-atomicity, dup-id reject, both job-types, lifecycle mark, print-queue round-trip + stage advance, ON DELETE CASCADE; reversibility re-passes (000006 down drops 2 new enums) · guard 141 · osm 22 · D3 split asset_job_type{model_ingest,sprite_render}/outputs→Product · D6 print stage STORED · **no new deps** |
| ADR-026 lane B/C/D · REC-20/28/39 | todo | — | — |

## Lần verify xanh gần nhất
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
- `origin/main` = **`cf31cb2`** (PR #16 PR-2e order-spine squash-merged 2026-06-26 09:39Z). Local main ĐÃ ff về
  `cf31cb2`. **Slice 2 còn 2f (fulfillment/asset) + 2g (settings); branch 2f off `cf31cb2`.** Verify:
  `git cat-file -t origin/main:services/core-api/db/migrations/000005_orders.up.sql` = blob. (lịch sử pointer cũ:
  PR #10 `ab99360`; PR #9 admin `bf1b7a5`; PR #7 storefront `b77acb7`.)
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
