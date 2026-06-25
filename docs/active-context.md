# Active context — focus đang chạy

> **File "đang ở đâu"** (volatile, đổi liên tục). `session-start` echo ~3000 byte đầu khi mở phiên ·
> `pre-compact` ghim làm "plan sống" · `verify-before-stop` nhắc cập nhật khi đổi >1 file source. Giữ phần
> load-bearing (Focus · Next · Ledger) **gần đầu file**. Đây **không** phải nguồn chân lý — chỉ scratchpad phối
> hợp; muốn binding phải thành ADR/luật (`agent-harness.md` §Ranh giới promote memory).

## Focus
**Phase 0 — backbone slice (nhánh `feat/phase-0-backbone`).** Đã dựng monorepo (pnpm + Turborepo) +
`packages/tokens` (theme từ `tokens/*.css`, **sửa contrast nút coral** → `--primary` = flame-700) +
`packages/core` (OrderStatus state machine + RBAC + statusHistory · money formatter `₫`/`calcTotals` ·
Zod schemas · i18n keys vi) + **arm toàn bộ gate** (root `verify`, `acceptance.ledger.test.ts`, ESLint cấm
`Intl` ngoài core, **OSM + money real-mutation-arm** trong `osm-mutation.test.sh`) + property-test fast-check.
Plan: [`plans/phase-0-backbone.md`](plans/phase-0-backbone.md). Spec nguồn: `spec.md §02/§04` · conventions.

## Next steps (1–3)
1. **Review + commit slice này** (1 PR `feat/phase-0-backbone`, off `main`, squash — conventions §Scope&PR).
   Chủ là người merge.
2. Phase-0 tiếp: **docker-compose skeleton** (Postgres/NATS/Garage/Caddy/cloudflared) + **app-CI lane**
   (node + `pnpm verify` + chạy real-mutation-arm trong CI — hiện CI harness-lane toolchain-free nên real-arm
   *skip rõ ràng* ở CI, chỉ chạy local).
3. Phase-0 tiếp: `packages/ui` primitives + Next app shells (storefront/admin) + next-intl runtime + self-host
   font (subset `vietnamese`). Sau đó Go `core-api` (toolchain `go` chưa có ở máy này) + Rust `asset-worker`.

## Open questions
- *(không có cho slice backbone — scope đã chốt "backbone only" với user; ADR đã khoá quyết định.)*

## Task ledger (git-anchored — B3 / ADR-025)
> **Convention:** sau `/compact` hay sang phiên mới, **tin ledger + `git log` hơn trí nhớ** — đừng re-dispatch
> task `done`. Task chỉ `done` khi code chạy + test xanh. Cột commit ghi `<base7>..<head7>`.

| Task | Trạng thái | Commits | Review |
|---|---|---|---|
| Harness audit r2/r3 + ADR-027 (workflow giao-PR) | done | PR #1/#2 (main=f751a41) | guard.test 138 / osm 11 |
| **Phase 0 — backbone (tokens + core + arm gates)** | **done (chưa commit)** | nhánh `feat/phase-0-backbone` | verify rc=0 · guard 139 · osm 22 |
| Phase 0 — compose skeleton + app-CI lane | todo | — | — |
| Phase 0 — packages/ui + app shells + next-intl/fonts | todo | — | — |
| ADR-026 lane B/C/D · REC-20/28/39 | todo | — | — |

## Lần verify xanh gần nhất
`pnpm verify` — **rc=0** (lint + typecheck + 38 test + format:check) · `tests/harness/guard.test.sh` —
**139 / 0** · `tests/harness/osm-mutation.test.sh` — **22 / 0** (toy + REAL OSM + REAL money mutants đều bị
KILL) (2026-06-25, Phase-0 backbone).
