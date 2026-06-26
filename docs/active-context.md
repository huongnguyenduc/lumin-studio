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

**ĐANG CHẠY = Phase "Core · Data model + OrderStatus" (xương sống). Branch `feat/core-data-model` off main.**
Plan: `docs/plans/core-data-model.md` (3 slice tuần tự). **Slice 1 (PR này) = domain spine THUẦN Go, KHÔNG DB:**
`services/core-api/internal/order` (state machine port từ `packages/core/order-state.ts` — edges/RBAC/reason/
owner-only/statusHistory/replay/channel-entry) + `internal/money` (`CalcTotals` server-authoritative, port nửa
server của `money.ts`; `formatVnd` DEFER tới surface email/OG). Test: OSM-01..05 + MNY-01/02 + property-test
(`testing/quick`, KHÔNG thêm dep). `make verify-go` xanh (gofmt+vet+golangci v2+`go test -race`, **15 test**).
ADR-003 (Go re-implement spine server-side; OpenAPI là hợp đồng TS↔Go). Slice 2 = sqlc+migration+outbox;
slice 3 = HTTP `POST /orders`+transition endpoints+RBAC mw.

> Lịch sử app-shell/backbone Phase-0 (storefront/admin/services scaffold) đã archive — xem `git log` + PR #5–#10.

## Next steps (1–3)
1. **Slice 1 (Go spine): review xong (workflow wf_3ccae648 + spec-guardian PASS) → sửa finding nếu có → commit
   → PR (squash, base=main).** Chưa push/commit khi chưa được chủ duyệt.
2. **Slice 2 — data layer:** sqlc models `spec.md §02` (Product/Color/Option/Order/OrderItem/PrintJob/AssetJob/
   Review/Customer/User/ReplyTemplate/Setting) + **outbox** + migration + pgx pool; arm `sqlc vet`+testcontainers
   (ADR-020). Address province→ward→street (ADR-017); `channel` enum + zalo; consent record trên Customer.
3. **Slice 3 — HTTP:** `POST /orders` (web→PENDING_CONFIRM+ảnh CK, inbox→PAID) + transition endpoints + RBAC mw +
   outbox publish-on-commit; thay `apps/admin/src/lib/demo-dashboard.ts` placeholder bằng aggregate thật. Sau đó:
   ADR-026 lane B/C/D · REC-20/28/39.

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
| **Core slice 1 — Go domain spine (OrderStatus state machine + money, no DB)** | **done (review PASS · 2 fix)** | `feat/core-data-model` off `ab99360` (chưa commit) | `make verify-go` ✓ (gofmt+vet+golangci v2+`go test -race`, **17 test**) · 5-lens review wf_3ccae648: 0 BLOCKER · 2 fix proven binding (money overflow-guard + impossible-date test, mutate-run-restore) · 3 NOTE doc'd (Go server intentionally stricter on malformed ts/url) · guard 139 · osm 22 · spec-guardian PASS |
| ADR-026 lane B/C/D · REC-20/28/39 | todo | — | — |

## Lần verify xanh gần nhất
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
- `origin/main` = **`ab99360`** (PR #10 services-backbone squash-merged 2026-06-26 03:28Z). Chứa app-shells +
  infra + `services/core-api`+`services/asset-worker` scaffold. Local main ĐÃ ff về `ab99360`. Verify:
  `git cat-file -t origin/main:services/core-api/go.mod` = blob. **Slice Core off `ab99360`.** (cũ: PR #9 admin
  `bf1b7a5` 2026-06-25; PR #7 storefront `b77acb7`.)
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
