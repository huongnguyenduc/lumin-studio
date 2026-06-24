# Active context — focus đang chạy

> **File "đang ở đâu"** (volatile, đổi liên tục). `session-start` echo 40 dòng đầu khi mở phiên · `pre-compact`
> ghim làm "plan sống" · `verify-before-stop` nhắc cập nhật khi đổi >1 file source. Giữ phần load-bearing
> (Focus · Next · Ledger) **trong 40 dòng đầu**. Đây **không** phải nguồn chân lý — chỉ scratchpad phối hợp;
> muốn binding phải thành ADR/luật (`agent-harness.md` §Ranh giới promote memory).

## Focus
**ADR-027 — vòng cải tiến workflow giao-PR (2026-06-24, run wf_00bf70da):** best-practice ngoài (Anthropic
explore→plan→code→commit · spec-driven · property/mutation · PR hygiene · context-eng) + 3 lăng kính phản biện
vs file thật. Kết luận: harness đã chín; lỗ hổng #1 = **thiếu visual-fidelity** (shop design-heavy). **Đang
thực thi A+B (user duyệt):** B = doc/template (không gate); A = ADR-027 · conventions §Visual-fidelity/§Scope/
§Session · settings `plansDirectory` · spec-guardian WARN · verify-before-stop risk-banner + guard.test. 2 item
CODE hoãn về **Phase-0 ARM** (mutation→money · property-test backbone). **Đã commit** — tách 2 PR off `main`:
A=`chore/harness-workflow-adr027` (harness/workflow), B=`feat/pet-tag-nfc-spec` (spec+Pet Tag); merge A trước.

## Next steps (1–3)
1. Hoàn tất A: thêm test risk-banner → `guard.test.sh` xanh (≥ cũ + 2); xoá van `.allow-contract-edit`.
2. Bắt đầu **Phase 0** (scaffold) — verify-before-stop & lint sống thật + arm 2 item ADR-027.
3. ADR-026 lane B (REC-20): `pre-compact.sh` → `active-context.history.md` (kênh dead-ends; spec-sync gối vào).

## Open questions
- *(không có — ADR-026 khoá B→A→C→D; ADR-027 user đã duyệt A+B. Không relitigate.)*

## Task ledger (git-anchored — B3 / ADR-025)
> **Convention:** sau `/compact` hay sang phiên mới, **tin ledger + `git log` hơn trí nhớ** — đừng re-dispatch
> task `done`. Task chỉ `done` khi code chạy + test xanh. Cột commit ghi `<base7>..<head7>`.

| Task | Trạng thái | Commits | Review |
|---|---|---|---|
| Harness audit 2026-06-23 + ADR-025 B1–B5 + Tier A | done | 53c311c + follow-up | guard.test 85 / osm 11 |
| Harness audit r3 + ADR-026 lane A (REC-38) | done | PR A `chore/harness-workflow-adr027` | guard.test 136 / osm 11 |
| ADR-027 workflow giao-PR (visual·risk-banner·spec-sync·plan-drift) | done | PR A `chore/harness-workflow-adr027` | guard.test 138 / osm 11 |
| ADR-026 lane B/C/D · REC-20/28/39 | todo | — | — |
| REC-40 Phase A · COLLECT session-log (chờ Phase-0 code) | todo | — | — |

## Lần verify xanh gần nhất
`bash tests/harness/guard.test.sh` — **138 pass / 0 fail** (2026-06-24, ADR-027) · `osm-mutation.test.sh` — **11 / 0**.
