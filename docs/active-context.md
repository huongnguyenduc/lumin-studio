# Active context — focus đang chạy

> **File "đang ở đâu"** (volatile, đổi liên tục). `session-start` echo 40 dòng đầu khi mở phiên · `pre-compact`
> ghim làm "plan sống" · `verify-before-stop` nhắc cập nhật khi đổi >1 file source. Giữ phần load-bearing
> (Focus · Next · Ledger) **trong 40 dòng đầu**. Đây **không** phải nguồn chân lý — chỉ là scratchpad phối hợp;
> muốn binding phải thành ADR/luật (`agent-harness.md` §Ranh giới promote memory).

## Focus
Lộ trình memory **ADR-026** (B→A→C→D = REC-20·38·28·39, advisory/doc/test) — đang chạy. **Vòng 6 (session-retro,
REC-40, run wf_15aa1762, 2026-06-23)** đóng khung lại: retro **không hệ mới** — nối REC-20/21/28/33/34/38/39 thành
MỘT vòng 3 tầng (COLLECT deterministic / ANALYZE advisory-người-duyệt / FEED-FORWARD one-shot). **Right-size: chỉ
Phase A** (COLLECT, *subsumes* REC-34 + *overlaps* REC-33; gấp vào `session-start.sh`, KHÔNG hook SessionEnd) là
deliverable kế — inert tới khi repo `git init`/Phase-0; tầng ANALYZE (`/retro`) **hoãn** tới khi có code-workload.

## Next steps (1–3)
1. Lane A (REC-38, rẻ nhất): assertion `guard.test.sh` — `active-context.md ≤40 dòng` + 4-luật/`## Focus` không bị `head -c 3000` cắt.
2. Lane B (REC-20): `pre-compact.sh` append `active-context.history.md` (cold, append-only) — = kênh lý-do của vòng retro.
3. REC-40 Phase A (chờ `git init`/Phase-0): COLLECT → `docs/session-log.md` 1 dòng pipe/phiên-không-sạch, tự-xoay-vòng, `outcome` từ oracle; one-shot `.session-retro-pending` (payload REC-34).

## Open questions
- *(không có — ADR-026 khoá B→A→C→D; REC-40 đóng-khung, Phase A inert tới `git init`. Không relitigate.)*

## Task ledger (git-anchored — B3 / ADR-025)
> **Convention:** sau `/compact` hay sang phiên mới, **tin ledger + `git log` hơn trí nhớ** — đừng re-dispatch task đã
> `done`. Một task chỉ `done` khi code chạy + test xanh. Cột commit ghi `<base7>..<head7>`; repo chưa init git ⇒ `(chưa commit)`.

| Task | Trạng thái | Commits | Review |
|---|---|---|---|
| ADR-025 B1–B5 + Tier A + REC-37 + thu REC-SP | done | (chưa commit) | guard.test 49 xanh |
| Vòng 6 session-retro — thiết kế + REC-40 đóng-khung | done (findings) | (chưa commit) | wf_15aa1762 verify đối kháng |
| ADR-026 lane A · REC-38 budget + guard-cliff | todo | — | — |
| ADR-026 lane B · REC-20 reasoning-digest | todo | — | — |
| ADR-026 lane C/D · REC-28 insight · REC-39 scoping | todo | — | — |
| REC-40 Phase A · COLLECT session-log (chờ `git init`) | todo | — | — |

## Lần verify xanh gần nhất
`bash tests/harness/guard.test.sh` — *(cập nhật pass/fail sau lần chạy mới nhất)*.
