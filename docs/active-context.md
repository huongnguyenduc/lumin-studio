# Active context — focus đang chạy

> **File "đang ở đâu"** (volatile, đổi liên tục). `session-start` echo ~3000 byte đầu khi mở phiên ·
> `pre-compact` ghim làm "plan sống" · `verify-before-stop` nhắc cập nhật khi đổi >1 file source. Giữ phần
> load-bearing (Focus · Next · Ledger) **gần đầu file**. Đây **không** phải nguồn chân lý — chỉ scratchpad phối
> hợp; muốn binding phải thành ADR/luật (`agent-harness.md` §Ranh giới promote memory).

## Focus
**Phase 0 — `packages/ui` primitives slice (branch `feat/phase-0-ui-primitives`, off main=30c5652).**
Dựng `packages/ui` (React 18 + cva + clsx/tailwind-merge `cn()`, vitest+jsdom+Testing-Library) — **13
primitive** từ `design-system.md §Component`: Button · IconButton · Badge · Tag · Avatar · Card · Input ·
Switch · Checkbox · QuantityStepper · Rating · PriceTag · ProductCard (composite). Tiền/số **chỉ qua
`@lumin/core`** (PriceTag→`formatVnd`, Rating→`formatVnNumber`; ESLint cấm `Intl` ngoài core) · không
hard-code copy (label/aria qua props) · a11y (role/label, focus-visible, `motion-reduce`, hit ≥44px). Mở
rộng `@lumin/tokens` preset: `danger` (=danger-600 cho AA), soft tints `accent-*-soft`, `accent-sky-strong`,
alias `on-dark`/`surface-sunken`/`border-default`/`text-subtle`. **Gate mới:** `token-coverage.test.ts`
(mọi util class màu phải map preset key — chống "silent no-op" vì chưa có Tailwind chạy) + lock contrast
badge-solid trong `tokens.contrast.test`. **Build qua workflow đa-agent (1 agent/primitive) → spec-guardian
review → sửa 2 a11y finding** (Badge solid teal/sky/danger fail AA; QuantityStepper md 36→44px).
Spec nguồn: `design-system.md` · `tokens/*.css` · conventions §A11y/§i18n/§Tiền.

## Next steps (1–3)
1. **Chủ review + merge** branch `feat/phase-0-ui-primitives` (off main, squash — conventions §Scope&PR).
   *(Chưa push/PR — chờ chủ duyệt trước khi đẩy.)* Chưa có app surface nên fidelity check để PR app-shell.
2. Phase-0 tiếp: **Next app shells (storefront/admin)** mount primitives + **next-intl runtime (vi + ICU)** +
   self-host font (subset `vietnamese`, leading heading ~1.15–1.2) + wire Tailwind preset. Đối chiếu thị
   giác vs `designs/*.dc.html` (ADR-027) — đây là nơi verify visual-fidelity các primitive.
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
| **Phase 0 — `packages/ui` 13 primitives + token-coverage gate** | **done (branch, uncommitted)** | `feat/phase-0-ui-primitives` | verify rc=0 · ui 103 / tokens 9 / core 37 · guard 139 · osm 22 · spec-guardian 2 a11y fixed |
| Phase 0 — app shells (storefront/admin) + next-intl/fonts | todo | — | — |
| ADR-026 lane B/C/D · REC-20/28/39 | todo | — | — |

## Lần verify xanh gần nhất
`pnpm verify` — **rc=0** (lint[ESLint 10] + typecheck + **149 test** + format:check) · `tests/harness/guard.test.sh`
— **139 / 0** · `tests/harness/osm-mutation.test.sh` — **22 / 0** (2026-06-25, **`packages/ui` primitives**:
ui 103 [13 primitive + token-coverage] / tokens 9 [+2 lock contrast badge-solid] / core 37). spec-guardian
review: money/i18n/controlled/ADR/exports CLEAN; 2 a11y finding (Badge solid AA · stepper 44px) đã sửa + khoá
bằng gate. Chưa có app surface → visual-fidelity check để PR app-shell.

## Lưu ý git (2026-06-25)
- PR #5 (compose skeleton) đã **merge** vào `origin/main` (squash → `30c5652`). Local `main` đang **sau**
  origin (cd6c171) — `git fetch && git checkout main && git merge --ff-only origin/main` khi cần.
- Branch hiện tại: **`feat/phase-0-ui-primitives`** (off `origin/main`=30c5652). **Chưa commit/push** —
  work-tree có 28 file mới (`packages/ui/**`) + edit `packages/tokens/src/{theme,preset}.ts` +
  `tokens.contrast.test` + `pnpm-lock`. Chờ chủ xác nhận trước khi commit+push+PR.
- Branch cũ stale (content đã trong main qua squash, git coi chưa-merge): `feat/phase-0-backbone`,
  `feat/phase-0-compose-skeleton`. Xoá tay ngoài phiên: `git branch -D <branch>` (guard-bash chặn `-D`).
