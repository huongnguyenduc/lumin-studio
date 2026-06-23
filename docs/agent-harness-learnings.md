# Học từ các harness coding-agent phổ biến — áp dụng vào Lumin

> **Mục đích:** ghi lại vòng nghiên cứu (2026-06-23, workflow `wf_1a2ff429`) soi các harness coding-agent
> phổ biến và rút ra những cải tiến cho harness của Lumin. Quyết định gói gọn ở [`decisions.md`](decisions.md)
> **ADR-022** (siết file hợp đồng) + **ADR-023** (mở rộng harness vòng 2). Cơ chế chi tiết ở [`agent-harness.md`](agent-harness.md).
> **Phương pháp:** 8 agent đọc rộng (Claude Code lifecycle hooks · Aider · OpenHands · SWE-agent · Cursor/Windsurf ·
> Cline/Roo · Codex/Gemini/Amp · cross-cutting patterns) → tổng hợp gap-analysis → **kiểm chứng đối kháng từng khuyến
> nghị với file thật** trong `.claude/` + `docs/` (loại cái trùng hoặc đụng ADR). 14 ứng viên → 13 giữ, 1 bỏ.

## 1. Khung nhìn

Harness Lumin **đã chắc ở nửa phải** của phổ điều khiển (deterministic): 4 hook, `permissions.deny`,
`verify-before-stop` gate xanh, `spec-guardian`, rules auto-load theo path, stack lint ép tiền/i18n/statusHistory.
Báo cáo này không vẽ lại cái đang chạy tốt — chỉ tìm **đúng những chỗ còn thiếu**. Ba khoảng trống nổi lên:

1. **Đầu trái của phổ** — orient/context bền vững qua `/clear` và `/compact`.
2. **Chống reward-hacking & loop** — green-gate hiện *mặc định tin rằng test suite trung thực*.
3. **Các tier ADR-021 đã đặt tên nhưng chưa dựng** — `skills/`, design-reviewer.

## 2. Lumin đã có gì so với harness ngoài

Bảng này để khỏi làm lại — những chỗ Lumin đã ngang bằng (hoặc hơn) state-of-the-art.

| Năng lực (harness ngoài hay nhấn) | Lumin đã có ở đâu |
|---|---|
| Hook exit-code contract (exit 2 = chặn + stderr→Claude; exit 0 = parse JSON stdout) | Cả 4 hook; `guard-files.sh` phát `hookSpecificOutput`+`permissionDecision` |
| Stop hook ép tiếp tục + chống lặp `stop_hook_active` | `verify-before-stop.sh` — chặn "done" tới khi typecheck/lint/test xanh |
| `permissions.deny` là sàn cứng tuyệt đối (deny thắng allow/ask) | `settings.json` chặn đọc `.env`/secrets/`*.age`/`*.pem`, sửa `.git/**`, `git push --force` |
| Guard lệnh huỷ diệt (`rm -rf`, `mkfs`/`dd`, `DROP/TRUNCATE`, fork bomb, force-push) | `guard-bash.sh` mảng PATTERNS có lý do; exit 2 |
| Chặn cứng sửa secrets; gated cho file hợp đồng | `guard-files.sh` |
| Vòng format+lint per-file, đẩy lỗi ngược lại | `format-and-lint.sh` (Prettier+ESLint --fix / gofmt / rustfmt) |
| Ground-truth bằng rule (typecheck/lint/test) thay vì LLM-judge | `verify-before-stop.sh` + `spec-guardian` chỉ lo cái test không bắt được |
| Reviewer đọc-độc-lập, context sạch, được dặn "đừng over-report" | `spec-guardian.md` (opus, BLOCKER/WARN/NOTE) |
| Rule auto-load theo path (lazy, file-scoped) | `.claude/rules/*.md` với `paths:` frontmatter |
| Phổ điều khiển advisory→deterministic | ADR-021 + `agent-harness.md` |
| Escape hatch có-mục-tiêu cho green-gate | `.claude/.skip-verify` short-circuit |
| Phản hồi lỗi gọn, signal-first (12-Factor #9) | hai hook đều `tail -n 40/50` trước khi đẩy ngược |
| Stack lint/test khoá, hook gọi "verb" độc lập version | ADR-020; `pnpm verify`, `make verify-go/verify-rs` |
| Ép format tiền qua 1 formatter core (lint rule, không phải prose) | conventions §Tiền + ESLint rule (ADR-019/020) |
| `statusHistory` mọi lần đổi state | conventions + CLAUDE.md §6 + transition guard + test P0 |
| Single-thread + verifying-subagent; multi-agent chỉ cho đọc | `agent-harness.md` §Kỷ luật quy trình |
| Auto-memory = MEMORY.md index + topic file, giữ gọn | `~/.claude/.../memory/` |
| Router just-in-time (đọc X→làm Y) | `docs/README.md` |
| Kỷ luật không relitigate + đường Superseded | `README.md` + ADR log |

**Kết luận:** phần **deterministic-end** và **lint kỷ luật tiền/i18n/statusHistory** đã rất tốt. Khoảng trống thật nằm ở
**đầu trái** (orient/context), **chống reward-hacking & loop**, và **tier đã đặt tên nhưng chưa dựng** (skills, oracle).

## 3. Khuyến nghị đã kiểm chứng (nhóm theo chủ đề)

> Cột "Học từ" ghi harness mà ý tưởng đến từ đó. Tất cả đã được sửa cho khớp file thật (xem §5 các điểm sửa).

### A. Trí nhớ & context bền vững

- **REC-01 — SessionStart hook orient-before-start.** *Chặn:* phiên mới `/clear` hoặc sau `/compact` lặng lẽ bỏ
  orientation. *Làm:* `.claude/hooks/session-start.sh` wire vào key `SessionStart`, phát `additionalContext` nhỏ
  (<30 dòng): branch + commit cuối; index `## ` heading + `**Done:**` của `plan.md`; nội dung `docs/active-context.md`
  nếu có. Self-no-op khi vắng. *Học từ:* Claude Code lifecycle hooks, Cline/Roo Memory Bank. **P1 · S.**
- **REC-02 — `docs/active-context.md` volatile + writeback WARN.** *Chặn:* sau `/compact` mất "đang ở đâu" + "đã verify
  gì". *Làm:* file scratch schema cố định (focus · 1-3 bước kế · open question · lần verify xanh gần nhất); reminder
  **không chặn** trong `verify-before-stop.sh` (phát JSON `additionalContext`, không bao giờ exit 2). *Học từ:* Cline/Roo
  (activeContext vs progress), Amp `/handoff`. **P2 · S.**
- **REC-14 — Compaction contract + ranh giới promote memory.** *Chặn:* `/compact` có thể bỏ mất luật always-must;
  "fact tiện tay" trong memory trôi thành "quyết định". *Làm:* mục "keep_first" trong `agent-harness.md` ghim path plan +
  ADR đang chạm + 4 luật always-must + file/lệnh verify; 1 dòng ranh giới: auto-memory là scratchpad, muốn binding phải
  thành ADR/luật. *Học từ:* OpenHands keep_first, Windsurf, SWE-agent. **P1 · S.**

### B. Cổng kiểm chứng (chống reward-hacking & loop)

- **REC-05 — Guard chống bóp méo test (anti-reward-hacking). 🔴** *Chặn:* `verify-before-stop` gate xanh nhưng không
  ngăn agent làm test pass bằng cách xoá case / thêm `.skip` / bỏ assertion — các invariant lõi (statusHistory, money
  int-VND, reconcile→PAID owner-only) sống trong test. *Làm:* nhánh `PreToolUse(Edit|Write)` trong `guard-files.sh` keyed
  theo path test → `permissionDecision:"ask"` (không exit 2 cứng) khi thêm skip-marker / giảm assertion; +1 dòng BLOCKER
  vào `spec-guardian.md` cho xoá test/bỏ assertion. *Học từ:* Anthropic long-running harness, SWE-bench Verified. **P0 · M.**
- **REC-06 — Retry budget + loop detector. ** *Chặn:* không có cap retry per-task; test GPU không thể pass trên GTX 1060
  có thể nhốt agent loop vô hạn. *Làm:* counter `.claude/.verify-attempts` trong `verify-before-stop` (sau 4 fail cùng
  target → surface "cần người", không loop); ring-buffer `.claude/.cmd-history` trong `guard-bash` (lệnh y hệt lặp ≥4×
  → chặn); `session-start.sh` reset cả hai. *Học từ:* OpenHands StuckDetector, Aider bounded-retry. **P1 · M.**
- **REC-08 — Parse-gate Go sớm trong `format-and-lint`.** *Chặn:* đáp file Go vỡ cú pháp chỉ lộ ở Stop hook. *Làm:*
  `gofmt -e` ở **đầu** `format-and-lint.sh` (trước format/lint), parse fail → exit 2 ngay. (Bỏ TS/Rust: ESLint vốn bắt
  parse error; `rustfmt --check` lẫn lộn style.) *Học từ:* SWE-agent lint-gate (+3.0pt). **P2 · S.**

### C. Kỷ luật plan/spec

- **REC-11 — Acceptance ledger kiểu EARS, gate "done" trên test liên kết.** *Chặn:* `plan.md` chỉ có "Done:" mức phase,
  không có criteria per-feature máy-kiểm-được. *Làm:* **một** file `docs/acceptance.md` (3 cụm backbone: order-state-machine,
  money, checkout), mỗi dòng EARS + test id, bắt đầu unchecked; Phase 0 thêm 1 Vitest parse file này → `verify-before-stop`
  tự ép; +rule advisory "zero `[NEEDS CLARIFICATION]` trước khi rời plan mode". *Học từ:* spec-kit/Kiro, Anthropic
  feature-list-starts-failing. **P1 · S–M.**

### D. Reviewer & subagent

- **REC-04 — `spec-guardian` read-only chứng minh được. 🔴** *Chặn:* frontmatter có `Bash` → "reviewer chỉ-đọc" thực ra
  có thể mutate; bảo đảm chỉ dựa prompt. *Làm:* đổi `tools: Read, Grep, Glob` (bỏ Bash); người gọi paste diff vào lúc
  gọi. *Học từ:* Amp Oracle (read-only), Gemini CLI, Claude Code per-agent tools. **P1 · S.**
- **REC-12 — Agent `oracle` design-review.** *Chặn:* spec-guardian soi **compliance** (vi phạm ADR), bị cấm bàn
  **design**; các bề mặt design hóc (outbox idempotency, một-state-machine-xuyên-4-surface, backpressure render trên
  GTX 1060) sai thì lan khắp nhưng không phá ADR nào. *Làm:* `.claude/agents/oracle.md` (opus; `Read, Grep, Glob`), gọi
  tay, **không bao giờ** wire vào hook/gate, neo vào subsystem cụ thể. *Học từ:* Amp Oracle, Factory orchestrator. **P2 · S.**

### E. Permission & sandbox

- **REC-03 — File hợp đồng lõi: ASK → hard-block (qua ADR-022).** *Chặn:* ASK dễ fat-finger "yes", lặng lẽ đổi luật
  binding. *Làm:* **ADR-022 trước**, rồi `guard-files.sh` hard-block (exit 2) **chỉ** `decisions.md`+`conventions.md`
  (tokens+CLAUDE.md vẫn ask), opt-out `.claude/.allow-contract-edit` là đường amend chính thức. *Học từ:* Aider `/read`
  vs `/add`, Claude Code deny>ask. **P1 · S.**

### F. Ergonomics rules & cross-tool

- **REC-07 — Tier `.claude/skills/` cho mối quan tâm cross-cutting.** *Chặn:* knowledge không gắn 1 path (vn-compliance,
  GPU render-worker, outbox idempotency) hiện vô hình. *Làm:* dựng tier skills (pointer mỏng + `when_to_use`, defer về
  doc nguồn): `vn-compliance` (cao nhất — không rule nào surface `compliance.md`), `render-worker-gpu`, `event-outbox`.
  *Học từ:* Cursor Agent-Requested, OpenHands microagents, Claude Code skills. **P2 · S–M.**
- **REC-13 — `AGENTS.md` pointer cross-tool mỏng.** *Chặn:* mọi thứ Claude-specific; người mở repo bằng Cursor/Codex/Aider
  nhận zero guidance. *Làm:* `AGENTS.md` standalone (không symlink CLAUDE.md): context 1 dòng + router → `docs/README.md` +
  3 lệnh verify + 1 dòng trỏ `.claude/`. *Học từ:* Cursor/Codex/Aider/Zed AGENTS.md baseline. **P2 · S.**

### G. Evals / self-check

- **REC-09 — Harness self-test trong CI.** *Chặn:* mọi hook **self-no-op tới Phase 0** → gate no-op không phân biệt được
  với gate pass; một glob ngừng match sau refactor = mất kiểm soát vô hình. *Làm:* `tests/harness/guard.test.sh` (không
  phụ thuộc app toolchain), feed fixture vào hook, assert exit≠0 cho ca phải-bị-chặn + ca dương; check mỗi rule có `paths:`.
  *Học từ:* Harness-Bench (swing 23.8pt từ config), Claude Code InstructionsLoaded. **P1 · M.** *(Verdict sạch duy nhất.)*

## 4. Lộ trình

**P0 — làm trước, đụng guard mạnh nhất:**
- **REC-05** (anti-reward-hacking test guard) — quan trọng nhất; green-gate càng mạnh càng tạo động cơ bóp test để qua nó.

**P1 — cùng / ngay sau Phase-0 harness:**
- **REC-09** (self-test CI) — nền để mọi gate khác không no-op âm thầm.
- **REC-01 + REC-14** (orient + compaction contract) — đôi context-bền-vững.
- **REC-06** (retry budget + loop detector) — trùng hạ tầng SessionStart với REC-01.
- **REC-04** (spec-guardian read-only), **REC-11** (acceptance ledger), **REC-03** (hard-block hợp đồng — kèm ADR-022).

**P2 — bồi thêm, không chặn launch:**
- **REC-02**, **REC-08**, **REC-07**, **REC-12**, **REC-13**.

## 5. Đã cân nhắc nhưng bỏ / sửa

**REC-10 — Harden guard-bash chống evasion qua `;`/`$(...)` — BỎ: tiền đề sai do đọc nhầm.** Khuyến nghị cho rằng regex
neo theo từng lệnh nên `a; rm -rf *` lọt. Thực tế hook đọc nguyên stdin (`INPUT="$(cat)"`) rồi `grep -Eiq` trên toàn chuỗi
**không** neo `^`/`$`, nên token nguy hiểm match ở mọi vị trí — `git status; rm -rf *`, `echo $(rm -rf *)`,
`foo; mkfs.ext4 /dev/sda` đều **ĐÃ bị chặn**. Phần "At minimum" chính là hành vi hiện tại → trùng thuần.

**Các bản gốc bị sửa (revise, không bỏ) khi đối chiếu repo thật:**
- REC-01/05/06 từng dựa vào `docs/active-context.md` vốn **chưa tồn tại** → chuyển sang escape-hatch thật `.skip-verify`,
  active-context strictly optional (REC-01 tự tạo file riêng ở REC-02).
- REC-08 bỏ framing "PreToolUse reject-before-accept" **bất khả thi** (PreToolUse·Edit không có file post-edit) → chuyển
  sang parse-gate ở đầu PostToolUse; bỏ `rustfmt --check` (lẫn style), chỉ giữ Go `gofmt -e`.
- REC-04 bỏ "per-agent Bash sub-scope" **không phải capability thật** → bỏ hẳn Bash, caller paste diff.
- REC-03 buộc đi qua **ADR-022** vì **đụng ADR-021 khoá**.
- REC-12/REC-07 sửa reference cho đúng (spec.md §02/§04, ADR-006/007) và bắt skills **defer-không-restate** để khỏi drift.
