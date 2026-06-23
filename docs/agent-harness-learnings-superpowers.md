# Học từ obra/Superpowers — nghiên cứu harness vòng 3 (2026-06-23)

> Nguồn: [github.com/obra/Superpowers](https://github.com/obra/Superpowers) (clone + đọc source trực tiếp).
> Phương pháp: workflow `wf_cb144264` (map 2 phía → synthesis → **adversarially verify từng REC vs file thật**).
> Quyết định gói: **ADR-025** (`decisions.md`). Bổ trợ: [`agent-harness.md`](agent-harness.md), [`agent-harness-learnings.md`](agent-harness-learnings.md), [`agent-harness-learnings-r2.md`](agent-harness-learnings-r2.md).
>
> ⚠️ Workflow bị chạm session-limit giữa chừng (6/7 agent map chết); phần *bootstrap* + *synthesis* + *verify* vẫn đủ.
> Dimension *methodology* (brainstorm/plan/TDD/subagent-dev/writing-skills) được đọc skill trực tiếp bù vào (mục §5).

## 1. Superpowers là gì
Framework **"methodology-as-mandatory-skills"** cho coding agent đa nền (Claude Code, Cursor, Codex, Gemini…):
- **Quy trình 7 bước**, mỗi bước một `SKILL.md`: brainstorm → git worktree → writing-plans → subagent-driven-dev → TDD → code-review → finishing.
- **Cơ chế ép dùng:** `session-start` hook + skill `using-superpowers` nhồi đầu phiên một hợp đồng *"bạn KHÔNG có lựa chọn — phải tra skill trước khi làm"* (ngưỡng "1%", "not negotiable").
- **Meta-skill `writing-skills`:** "viết skill CHÍNH LÀ TDD cho tài liệu" — RED (xem agent fail khi chưa có skill) → GREEN (viết skill) → REFACTOR (bịt loophole).
- **Enforcement:** gần như **toàn bộ là advisory prose** (Iron Law + bảng chống-ngụy-biện). Rất ít gate cứng.

## 2. Verdict
**Lumin KHÔNG nên "cài" Superpowers, và đã mạnh hơn nó ở tầng quan trọng nhất.** Mô hình enforcement của Lumin (deterministic tier) là *bản nâng cấp* của mô hình advisory-prose của Superpowers. Superpowers thậm chí **tự tái khẳng định nguyên lý ADR-021**:
> writing-skills: *"Mechanical constraints — if it's enforceable with regex/validation, automate it; save documentation for judgment calls."* = `advisory→deterministic`.

Việc cần làm: **thu hoạch có chọn lọc *process craft* + *authoring craft***, không đổi kiến trúc.

## 3. Lumin đã mạnh hơn ở đâu (ĐỪNG-REGRESS)
| Khía cạnh | Lumin | Superpowers |
|---|---|---|
| Tier enforcement | hook cứng: guard-bash/guard-files/**verify-before-stop green-gate**/**mutation kill-gate OSM**/anti-reward-hacking | hầu hết chỉ prose "you must…" |
| Toàn vẹn test | chặn `.skip`/giảm assertion + mutation gate chứng minh test *ràng buộc* | không có — agent có thể làm yếu test thoải mái |
| Thứ bậc verification | LLM-judge (spec-guardian/oracle) là tier **yếu nhất**, chỉ WARN, không bao giờ gate | đảo ngược: cơ chế chính là LLM theo prompt cực đoan |
| Compaction | `pre-compact.sh` snapshot **state thật** (file đổi + verify-cmd + ADR) → replay one-shot | chỉ re-inject text skill tĩnh |
| Phạm vi rule | `rules/*.md` path-scoped, load theo path → ít context-rot | nhồi 1 skill global, fuzzy-match |
| Reviewer độc lập | spec-guardian context sạch, Read/Grep/Glob | không có tier review độc lập |
| Bảo mật | env-scrub subprocess + deny đọc secrets | không có |

## 4. REC-SP-01..11 — đã adversarially verify vs file thật
| ID | Đề xuất | Verdict | Hành động (ADR-025) |
|---|---|---|---|
| **REC-SP-01** | session-start front-load 4 luật always-must lúc startup, không chỉ post-compact | **confirmed-gap** (high) | ✅ **Implemented** — nhánh else PCF, gate tránh trùng, +assert guard.test |
| **REC-SP-04** | thêm "Đọc trước khi &lt;action&gt;" vào description 3 skill | **confirmed-gap** (adopt) | ✅ **Implemented** — sửa 3 SKILL.md (giá trị cao nhất: event-outbox + render) |
| **REC-SP-10** | surface skill-index trong orient (glob động, không auto-invoke) | **confirmed-gap** | ✅ **Implemented** — +assert guard.test |
| **REC-SP-09** | mục authoring + **fix drift** (`when_to_use` vs `description`); chuẩn "description = WHEN không phải WHAT" | partially-exists | 🔜 B4 — phần "Loại rõ mandatory-skill" đã ghi vào agent-harness.md |
| **REC-SP-03** | mục tie-break precedence nhỏ trong agent-harness.md (**BỎ** echo session-start) | partially-exists | 🔜 B5 |
| **REC-SP-08** | version-stamp runtime trong orient | partially-exists | 🔜 **gộp REC-37** (chỉ thêm dòng đọc `plugin.json`); đừng tạo `.claude/VERSION` |
| **REC-SP-02** | behavioral test (clean session → rule/laws engage) | partially-exists | 🔜 thu còn ~2 dòng content-check `extension.md` ADR-011; phần startup-laws đã có ở guard.test |
| **REC-SP-05** | red-flags chống-ngụy-biện ở done/skip-gate | partially-exists | 🔜 chỉ vế "thay đổi nhỏ vẫn qua gate" là mới (GPU/flaky đã ship) |
| **REC-SP-06** | todo-per-state (empty/loading/error) | partially-exists | 🔜 1 dòng `frontend-a11y-i18n.md` (marginal; spec-guardian:23 đã check outcome) |
| **REC-SP-07** | subagent carve-out injection | **REJECT** | ❌ canh injection path **không tồn tại** (Task-subagent không nhận SessionStart); lo ngại thật = REC-36 |
| **REC-SP-11** | SKIP mandatory-skill apparatus | skip (đúng) | ✅ **ghi "Loại rõ"** vào agent-harness.md + ADR-025 |

## 5. Methodology harvest (ngoài 11 REC — đọc skill trực tiếp; lộ trình ADR-025)
- **B1 · plan-template kiểu `writing-plans`** (adapt, M — ROI cao nhất chưa khai thác). Lumin có `plan.md`(phase)+`active-context.md`(focus) nhưng **thiếu format plan triển khai feature**. Mượn khung SP, đúng nhu cầu OSM-xuyên-4-surface: **Global Constraints** copy verbatim từ spec · block **Interfaces: Consumes/Produces** (chữ ký liên-task) · luật **No-Placeholders** · **Self-review vs spec** (phủ spec? type khớp?).
- **B2 · two-stage review verdict** (adapt, S–M). SP tách rõ **spec-compliance ✅ + code-quality** (2 verdict). Lumin có sẵn mảnh ghép (spec-guardian=compliance; `/code-review`/oracle=quality) → làm rõ **hai verdict riêng**. Kèm: *"mọi thứ paste vào prompt nằm lại context, bị đọc lại mỗi turn — đưa artifact qua FILE"* → ghi diff cho spec-guardian **ra file, truyền path** thay vì paste.
- **B3 · ledger git-anchored** (adapt, S). SP: `Task N: complete (commits <base7>..<head7>, review clean)`; *"sau compaction tin ledger+`git log` hơn trí nhớ; đừng re-dispatch task đã xong"*. Nâng convention `active-context.md` (bổ trợ snapshot REC-19).
- **B4 · writing-skills craft**. Bảng **"Match the Form to the Failure"**: discipline-fail → bảng chống-ngụy-biện; output sai shape → recipe dương; thiếu element → slot REQUIRED; behavior theo điều kiện → conditional. + "mechanical→automate, judgment→document" (= ADR-021, dẫn làm validation ngoài).

## 6. doNotAdopt (giữ lập trường đã chốt)
- **mandatory-skill apparatus** ("1%"/"not negotiable"/skill-check-before-clarify) — nâng tier yếu nhất thành law, đảo ADR-021.
- **mandatory-worktree-mọi-task** — đụng REC-32 (worktree serial-only).
- **multi-agent cho code-writing** — đã chốt single-thread + 1 subagent kiểm chứng (ADR-021/023, Cognition "Don't Build Multi-Agents").
- **plugin/marketplace polyglot đa-harness** — Lumin chỉ Claude Code, harness là file commit có chủ đích.
- **nhét full methodology vào body SKILL.md** — phá kỷ luật pointer-not-restate → drift.
- **gate "hoãn câu hỏi làm rõ tới khi skill-check"** — hại đúng luồng order/compliance cần hỏi rõ.

## 7. Trạng thái & lộ trình
- **Implemented (Tier A — 2026-06-23):** REC-SP-01 · REC-SP-04 · REC-SP-10 + "Loại rõ" REC-SP-11 + đồng bộ doc.
- **Implemented (Tier B/C — 2026-06-23, cùng phiên — TOÀN BỘ lộ trình còn lại):**
  - **B1** plan-template → `docs/templates/implementation-plan.md` (Global Constraints verbatim · Interfaces Consumes/Produces · No-Placeholders · Self-review vs spec).
  - **B2** two-stage review + file-handoff → `agent-harness.md` §"Review hai verdict tách riêng" (compliance BLOCKER vs quality advisory; diff lớn ghi `.claude/.review-diff` truyền path, không paste).
  - **B3** ledger git-anchored → **tạo mới** `docs/active-context.md` (trước đó MISSING dù 3 hook trỏ tới — nay session-start/pre-compact/verify-before-stop đi từ self-no-op → live).
  - **B4** authoring craft → §"Authoring craft" bảng *Match the Form to the Failure* + `mechanical→automate; judgment→document`.
  - **B5** tie-break precedence → §"Phổ điều khiển" mục *Thứ tự ưu tiên khi xung đột* (KHÔNG echo session-start).
  - **REC-37/REC-SP-08** version-stamp → session-start `git log -1 -- .claude/` (commit-anchored; KHÔNG plugin.json/VERSION — doNotAdopt plugin polyglot; self-no-op khi `.claude/` chưa có commit).
  - **REC-SP-06** todo-per-state (1 dòng `frontend-a11y-i18n.md`) · **REC-SP-05** red-flags done-gate (`agent-harness.md` §Kỷ luật) · **REC-SP-02** content-check `extension.md` ADR-011 (guard.test) · **drift-fix** `when_to_use`→`description`.
  - **guard.test.sh: 49 assertion** (44→49), tất cả xanh. session-start reorder skill-index TRƯỚC block lớn để sống sót cap 3000.
- **KHÔNG đổi `decisions.md`:** đây là *thực thi* ADR-025 (đã Accepted) — không phải quyết định mới ⇒ **không** cần van xả/amend. Trạng thái thực thi sống ở `active-context.md` (ledger) + mục này.
- **Đã loại:** REC-SP-07 + doNotAdopt §6. **Đừng re-research Superpowers.**
