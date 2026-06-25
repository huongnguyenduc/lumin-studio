# Active context — focus đang chạy

> **File "đang ở đâu"** (volatile, đổi liên tục). `session-start` echo ~3000 byte đầu khi mở phiên ·
> `pre-compact` ghim làm "plan sống" · `verify-before-stop` nhắc cập nhật khi đổi >1 file source. Giữ phần
> load-bearing (Focus · Next · Ledger) **gần đầu file**. Đây **không** phải nguồn chân lý — chỉ scratchpad phối
> hợp; muốn binding phải thành ADR/luật (`agent-harness.md` §Ranh giới promote memory).

## Focus
**Phase 0 — app shells: BOTH slices built. (1/2 storefront → PR #7; 2/2 admin → PR stacked on #7.)**
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
1. **Chủ review + merge PR storefront-shell** (squash — conventions §Scope&PR; ~1062 dòng source, 1-trục:
   infra app + storefront, không tách được vì infra vô nghĩa nếu đứng riêng). **Visual-fidelity (ADR-027):**
   chạy `pnpm dev` → chụp mobile+desktop → đối chiếu mắt thường vs `designs/Lumin Storefront - Hi-fi.dc.html`.
2. **Phase-0 slice 2/2: ADMIN shell** (`apps/admin`, PR kế) — dùng lại infra trên (preset/fonts/next-intl/eslint).
   Sidebar 9 mục + topbar greeting + dashboard (stat Card + bảng đơn + status Badge map `ORDER_STATUSES`).
   Desktop-first. Nguồn: `designs/Lumin Admin - Hi-fi.dc.html`.
3. Phase-0 tiếp: Go `core-api` (Chi BFF) + Rust `asset-worker`. ARM gate khi `services/**/*.go` land:
   `Makefile verify-go` (plan.md §Phase-0 ARM checklist). GPU gate (operations.md §3) làm trên host WSL2.

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
| **Phase 0 — app shell 1/2: storefront (Next+next-intl+fonts+Tailwind)** | **merged?→PR #7 open** | `feat/phase-0-storefront-shell` (off `296c44a`) | `next build` ✓ · verify rc=0 · storefront i18n test + ui 105/tokens 9/core 37 · guard 139 · osm 22 · spec-guardian PASS (0/0/2) |
| **Phase 0 — app shell 2/2: admin (sidebar+dashboard, reuse infra)** | **done (PR #8 open, stacked on #7)** | `feat/phase-0-admin-shell` (rebased on storefront-shell) | Next 15 + Hanken Grotesk · `next build` ✓ · verify rc=0 · admin i18n test · guard 139 · osm 22 · spec-guardian PASS (0/0/2) · status-Badge map = 7 ORDER_STATUSES |
| ADR-026 lane B/C/D · REC-20/28/39 | todo | — | — |

## Lần verify xanh gần nhất
`pnpm verify` — **rc=0** (lint[ESLint 10 + jsx-a11y + i18next cho apps] + typecheck + test + format:check) ·
`next build` storefront **✓** (4 static page) · `tests/harness/guard.test.sh` — **139 / 0** (ARM-GUARD thấy
`apps/*.tsx` → xác nhận ESLint Intl-ban armed) · `osm-mutation.test.sh` — **22 / 0** (2026-06-26, **storefront
shell**: storefront i18n-catalog test [non-empty + no-baked-price + core namespace] / ui 105 / tokens 9 /
core 37). spec-guardian: **PASS 0 BLOCKER/0 WARN/2 NOTE** (money/i18n/a11y/§State/ARM CLEAN). CI-fresh
`tsc --noEmit` chạy được **không cần** `next-env.d.ts` (verify không phụ thuộc prior build).

## Lưu ý git (2026-06-26)
- `origin/main` = `296c44a` (PR #6 ui-primitives đã merge). Local `main` đã ff sync.
- Branch **`feat/phase-0-storefront-shell`** (off `296c44a`): app shell 1/2 → **PR #7** (tip `5b95786`, đã push).
- Branch **`feat/phase-0-admin-shell`** (stacked trên #7): app shell 2/2 → **PR #8** (tip `e1690e7`, đã push).
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
