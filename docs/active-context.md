# Active context — focus đang chạy

> **File "đang ở đâu"** (volatile, đổi liên tục). `session-start` echo ~3000 byte đầu khi mở phiên ·
> `pre-compact` ghim làm "plan sống" · `verify-before-stop` nhắc cập nhật khi đổi >1 file source. Giữ phần
> load-bearing (Focus · Next · Ledger) **gần đầu file**. Đây **không** phải nguồn chân lý — chỉ scratchpad phối
> hợp; muốn binding phải thành ADR/luật (`agent-harness.md` §Ranh giới promote memory).

## Focus
**Phase 0 — backbone slice (PR #4 `feat/phase-0-backbone`).** Đã dựng monorepo (pnpm + Turborepo) +
`packages/tokens` (theme từ `tokens/*.css`, **sửa contrast nút coral** → `--primary` = flame-700) +
`packages/core` (OrderStatus state machine + RBAC + statusHistory · money formatter `₫`/`calcTotals` ·
Zod schemas · i18n keys vi) + **arm toàn bộ gate** (root `verify`, `acceptance.ledger.test.ts`, ESLint cấm
`Intl` ngoài core, **OSM + money real-mutation-arm** trong `osm-mutation.test.sh`) + property-test fast-check.
**Đã commit (`eef1755`) + vòng review đa-agent (local ultrareview, 25 finding) → đã sửa A/B/C/D:** gate-
integrity (`/tokens/` un-hide format:check · turbo `globalDependencies` · CI `app-gates` job chạy
real-arm · contrast test khoá `tokens.css` thật · acceptance-ledger đòi `it()` non-skip) · TZ-pin
`formatVnDate` · i18n key hoá message Zod · ESLint 9→10 (ADR-020) · CHK-03 echo-ack · nhiều nit.
Plan: [`plans/phase-0-backbone.md`](plans/phase-0-backbone.md). Spec nguồn: `spec.md §02/§04` · conventions.

## Next steps (1–3)
1. **Chủ review + merge PR cho `feat/phase-0-compose-skeleton`** (off `main`, squash — conventions §Scope&PR).
   Smoke-test thật trên host WSL2 (daemon Docker ở Mac dev đang tắt; chỉ validate được `docker compose config`).
2. Phase-0 tiếp: `packages/ui` primitives + Next app shells (storefront/admin) + next-intl runtime + self-host
   font (subset `vietnamese`). **`go` + `docker` GIỜ đã có ở máy dev** (go1.23.6 darwin/arm64; compose v5.1.0).
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
| **Phase 0 — compose skeleton** | **done (branch open)** | `feat/phase-0-compose-skeleton` | `docker compose config -q` OK · verify rc=0 |
| Phase 0 — packages/ui + app shells + next-intl/fonts | todo | — | — |
| ADR-026 lane B/C/D · REC-20/28/39 | todo | — | — |

## Lần verify xanh gần nhất
`pnpm verify` — **rc=0** (lint[ESLint 10] + typecheck + **43 test** + format:check) · `tests/harness/guard.test.sh` —
**139 / 0** · `tests/harness/osm-mutation.test.sh` — **22 / 0** (toy + REAL OSM + REAL money mutants đều bị
KILL) (2026-06-25, Phase-0 backbone + vòng sửa ultrareview). **Compose skeleton (2026-06-25):**
`pnpm verify` rc=0 (FULL TURBO) + `docker compose config -q` OK (`infra/`) — daemon Docker tắt nên chưa `up`.

## Lưu ý git (2026-06-25)
- PR #4 đã **merge** vào `origin/main` (squash → `cd6c171`). Local `main` từng kẹt 2 commit sau →
  đã `ff-only` lên `cd6c171`. Branch hiện tại: **`feat/phase-0-compose-skeleton`** (off main mới).
- Branch cũ `feat/phase-0-backbone` (local) **stale, content đã trong main** nhưng git coi là chưa-merge
  (squash). Xoá tay: `git branch -D feat/phase-0-backbone` (guard-bash chặn `-D` trong phiên — chạy ngoài).
