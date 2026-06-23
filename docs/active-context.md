# Active context — focus đang chạy

> **File "đang ở đâu"** (volatile, đổi liên tục). `session-start` echo 40 dòng đầu khi mở phiên · `pre-compact`
> ghim làm "plan sống" · `verify-before-stop` nhắc cập nhật khi đổi >1 file source. Giữ phần load-bearing
> (Focus · Next · Ledger) **trong 40 dòng đầu**. Đây **không** phải nguồn chân lý — chỉ scratchpad phối hợp;
> muốn binding phải thành ADR/luật (`agent-harness.md` §Ranh giới promote memory).

## Focus
**Harness audit 2026-06-23 — đã thực thi 4 cụm:** (1) sửa bug + vá guard · (2) commit harness + CI lane ·
(3) đồng bộ doc/memory drift · (4) self-test holes + van-xả. Repo **đã `git init` + commit đầu** (rev
`53c311c`) ⇒ version-stamp REC-37 + lane git-anchored **đã sống**; `.github/workflows/harness.yml` chạy 2
self-test khi `.claude/**` đổi. Lộ trình memory **ADR-026** (B→A→C→D = REC-20·38·28·39) vẫn là roadmap đứng;
**REC-40 Phase A** tiền-điều-kiện đổi từ "chờ git init" (xong) → **chờ Phase-0 code workload**.

## Next steps (1–3)
1. Bắt đầu **Phase 0** (scaffold: package.json/tsconfig/node_modules + Makefile) — khi đó verify-before-stop & lint sống thật.
2. ADR-026 lane A (REC-38): assertion `guard.test.sh` — `active-context.md ≤40 dòng` + 4-luật/`## Focus` không bị `head -c 3000` cắt.
3. ADR-026 lane B (REC-20): `pre-compact.sh` → `active-context.history.md` (cold, append-only) — kênh lý-do vòng retro.

## Open questions
- *(không có — ADR-026 khoá B→A→C→D; REC-40 đóng-khung. Không relitigate.)*

## Task ledger (git-anchored — B3 / ADR-025)
> **Convention:** sau `/compact` hay sang phiên mới, **tin ledger + `git log` hơn trí nhớ** — đừng re-dispatch task
> `done`. Task chỉ `done` khi code chạy + test xanh. Cột commit ghi `<base7>..<head7>` (repo đã có commit từ 2026-06-23).

| Task | Trạng thái | Commits | Review |
|---|---|---|---|
| Harness audit 2026-06-23 (bug+guard · commit+CI · doc-sync · self-test) | done | 53c311c + follow-up | guard.test 85 / osm 11 xanh |
| ADR-025 B1–B5 + Tier A + REC-37 + thu REC-SP | done | 53c311c | guard.test 85 xanh |
| ADR-026 lane A · REC-38 budget + guard-cliff | todo | — | — |
| ADR-026 lane B · REC-20 reasoning-digest | todo | — | — |
| ADR-026 lane C/D · REC-28 insight · REC-39 scoping | todo | — | — |
| REC-40 Phase A · COLLECT session-log (chờ Phase-0 code) | todo | — | — |

## Lần verify xanh gần nhất
`bash tests/harness/guard.test.sh` — **85 pass / 0 fail** (2026-06-23, sau audit) · `osm-mutation.test.sh` — **11 / 0**.
