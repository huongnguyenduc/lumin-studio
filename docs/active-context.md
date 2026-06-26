# Active context — focus đang chạy

> **File "đang ở đâu"** (volatile, đổi liên tục). `session-start` echo ~3000 byte đầu khi mở phiên ·
> `pre-compact` ghim làm "plan sống" · `verify-before-stop` nhắc cập nhật khi đổi >1 file source. Giữ phần
> load-bearing (Focus · Next · Ledger) **gần đầu file**. Đây **không** phải nguồn chân lý — chỉ scratchpad phối
> hợp; muốn binding phải thành ADR/luật (`agent-harness.md` §Ranh giới promote memory).

## Focus
**Phase 0 — app shells DONE trên main: storefront (#7=`b77acb7`) + admin (#9=`bf1b7a5`, **MERGED** 2026-06-25,
base=main; stacked-merge footgun đã xử lý — git-note dưới). Slice ĐANG CHẠY = services backbone
(`feat/phase-0-services-backbone` off main): Go `core-api` (Chi v5 BFF) + Rust `asset-worker` scaffold + ARM
`Makefile verify-go|verify-rs` + CI job `services-gates`. Đây là slice CUỐI của Phase 0.** (Context app-shell
bên dưới giữ làm lịch sử.)
Admin (`apps/admin`, branch `feat/phase-0-admin-shell` off storefront-shell): reuse 100% infra slice-1; chrome
= sidebar 9 mục (`usePathname` active) + topbar greeting (Avatar + `formatVnDate` demo) + dashboard (4 stat
Card: count`formatVnNumber`/tiền`formatVnd` · bảng đơn gần đây + `OrderStatusBadge` map 7 `ORDER_STATUSES`→
Badge tone · "Cần xử lý" list) + `loading`/`error` + empty-state bảng. Desktop-first (sidebar fixed ≥lg).
Built qua subagent mirror storefront → tự verify lại (build/verify/guard/osm green) + spec-guardian PASS.
Merge order: **#7 (storefront, có infra) TRƯỚC**, rồi rebase admin lên main.

### Slice 1/2 — STOREFRONT (PR #7, branch `feat/phase-0-storefront-shell`, off main=296c44a).
Dựng `apps/storefront` (Next 14.2 App Router + React 18) — app đầu tiên boot bằng `pnpm dev`, là nơi
**mount 13 primitive** `@lumin/ui` lần đầu trên surface thật (visual-fidelity ADR-027 deferred từ PR #6).
Wiring nền (dùng lại cho admin): `pnpm-workspace` thêm `apps/*` · `turbo` thêm `dev`/`build` · **Tailwind 3.4
+ `luminPreset`** (content scan `packages/ui/src` để primitive class không bị tree-shake) · **next-intl (vi +
ICU, không locale-routing)** — catalog = chrome `messages/vi.ts` + `@lumin/core` domain dưới namespace `core`
· **self-host font qua `next/font/google` (Next 15)** (Bricolage Grotesque display · **Hanken Grotesk** body ·
Space Mono; subset `vietnamese`, CSS-var → tailwind fontFamily) · **ESLint arm
cho `apps/**`**: `jsx-a11y` recommended + `i18next/no-literal-string` (jsx-text-only) — luật i18n/a11y giờ có
enforcement. Shell = header sticky (logo+search+nav) · bottom-nav mobile · hero (pop CTA) · featured grid
(ProductCard + empty state) · trust · footer · `loading`/`error` route states. Tiền chỉ qua PriceTag/`@lumin/core`
· mọi copy qua i18n key · a11y (skip-link, aria, focus-visible, hit≥44, motion-reduce, heading leading 1.18).
**spec-guardian: PASS (0 BLOCKER/0 WARN/2 NOTE).** Nguồn: `designs/Lumin Storefront - Hi-fi.dc.html` ·
`design-system.md` · conventions §A11y/§i18n/§Tiền/§State/§Visual-fidelity.

## Next steps (1–3)
1. **Chủ review + merge PR services-backbone** (squash, base=`main`). Scaffold-only, không có domain/DB/NATS-live.
   Diff lớn do lock-file sinh (go.sum + Cargo.lock) — code tay nhỏ. Sau merge: **Phase 0 DONE.**
2. **Còn nợ trong Phase 0 (ops, không phải code):** GPU gate (operations.md §3) trên host WSL2 — driver Win +
   cuda-toolkit + nvidia-container-toolkit + **Blender thấy GPU trong container** (skill `render-worker-gpu`).
   Đây là việc của chủ trên máy nhà, không scaffold được. Cũng còn: Dockerfile cho 2 service (deferred — ảnh
   asset-worker = CUDA+Blender, gắn với GPU gate) → mở comment block trong `infra/docker-compose.yml`.
3. **Phase 1** (Core data model + OrderStatus, rồi Storefront): Core API aggregates thật thay
   `apps/admin/src/lib/demo-dashboard.ts` placeholder; sqlc models (`spec.md §02`) + outbox; ADR-026 lane
   B/C/D · REC-20/28/39.

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
| **Phase 0 — services backbone (Go core-api + Rust asset-worker scaffold + arm gates)** | **done (PR open)** | `feat/phase-0-services-backbone` off `bf1b7a5` | make verify-go ✓ (golangci-lint **v2.12.2** + `go test -race`) · make verify-rs ✓ (go test 6 / cargo test 3) · ARM-GUARD .go→verify-go + .rs→verify-rs ✓ · guard 139 · osm 22 · pnpm verify rc=0 · CI `services-gates` · 4-lens review 0 BLOCKER |
| ADR-026 lane B/C/D · REC-20/28/39 | todo | — | — |

## Lần verify xanh gần nhất
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
- `origin/main` = **`bf1b7a5`** (PR #9 admin re-land squash-merged 2026-06-25). Chứa `apps/storefront` +
  `apps/admin` + toàn bộ infra. **PR #9 ĐÃ MERGED** (active-context cũ ghi nhầm "open" → đã sửa). Verify:
  `git cat-file -t origin/main:apps/admin/package.json` = blob; `services/` chưa có trên main (slice này thêm).
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
