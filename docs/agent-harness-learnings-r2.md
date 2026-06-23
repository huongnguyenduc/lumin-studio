# Học từ harness coding-agent — VÒNG 2 (methodology-level)

> **Mục đích:** ghi vòng nghiên cứu thứ 2 (2026-06-23, workflow `wf_57240dd3`) — nối tiếp
> [`agent-harness-learnings.md`](agent-harness-learnings.md) (vòng 1). Vòng 1 soi các *coding-agent harness*
> (Aider · OpenHands · SWE-agent · Cursor/Windsurf · Cline/Roo · Codex/Gemini/Amp · Claude Code lifecycle hooks).
> Vòng 2 **đổi trục sang methodology-level** và framework mới hơn.
> **Phương pháp:** 8 agent đọc rộng (spec-driven · agentic-SDLC đa-vai · essay engineering Anthropic · eval/verification-driven ·
> memory/context · parallel-orchestration · Claude Code/SDK 2026 · autonomous-loops 12-factor) → 31 ứng viên →
> **verify đối kháng từng cái với file thật** (kiểm claim đúng sự thật + dedup vs harness đang có) → **26 giữ, 5 bỏ**.
> Quyết định gói ở **ADR-024** (nháp ở cuối file này — chờ review, merge vào `decisions.md` qua `.allow-contract-edit`).

> **Trạng thái implement (cập nhật khi làm):** ADR-024 **Accepted (user 2026-06-23)** — đã merge vào `decisions.md`.
> - ✅ **REC-15** (mutation kill-gate OSM) — `tests/harness/osm-mutation.test.sh` + self-test wiring. **Đã dựng.**
> - ✅ **REC-16** (anti-overfit / special-casing) — nhánh trong `.claude/hooks/guard-files.sh` + fixtures `guard.test.sh` + dòng WARN `spec-guardian.md` + §Test integrity `conventions.md`. **Đã dựng.**
> - ✅ **REC-19** (PreCompact deterministic) — `.claude/hooks/pre-compact.sh` + tiêu thụ trong `session-start.sh` + đăng ký `settings.json` + fixtures. **Đã dựng.**
> - ✅ **REC-22** (env-scrub subprocess) — `env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1` trong `settings.json` + §Bảo mật `conventions.md` + assertion self-test. **Đã dựng.**
> - ⏳ REC-17/18/20/21/23..37 — chờ, theo lộ trình cuối file (P1: REC-17/18/20/21/33/34; P2/P3: còn lại).

---

## Khung nhìn vòng 2

Vòng 1 (`wf_1a2ff429`) đã khai thác các *coding-agent harness* — tức cách một agent *làm việc trong repo*.
Vòng 2 đổi trục: nhắm vào **methodology-level** và các framework mới hơn — spec-driven dev (Spec Kit / Kiro / Tessl),
agentic-SDLC (BMAD / Agent OS / APM / Vibe Kanban), bộ essay engineering của Anthropic, dòng verification eval-driven
(ImpossibleBench / Meta-ACH mutation / SWE-bench overfit), memory/context (Beads / Cline / Letta-mem0),
parallel-orchestration (multi-agent vs Cognition single-thread / Dagger-Sculptor / Factory), các tính năng Claude Code/SDK
2026 (sandboxed Bash · full hook lifecycle · plugins · headless), và autonomous-loops 12-factor (Ralph / gh-aw).

Sau khi đối kháng với file thật và bỏ trùng theo *dedup bar* "bất kỳ bullet hiện có nào đã giao cơ chế đó dù tên khác →
trùng", **bốn khoảng trống thật** sống sót: (1) **truy vết hai chiều requirement↔task↔test** — `acceptance.md` mới chỉ
chứng minh một chiều acceptance→test; (2) **green-gate vẫn mặc định test trung thực** — chưa có kill-gate (mutation) lẫn
anti-overfit/special-casing để chứng minh test *ràng buộc* hành vi; (3) **đầu trái còn mềm ở một số seam** — keep_first là
prose (chưa có PreCompact deterministic), chưa nén được phần *lý do/dead-ends*, và còn thiếu eval regression cho hành vi của
chính agent qua model bump; (4) **sàn bảo mật chỉ là string-match** — `permissions.deny`/`guard-bash` không thấy secret
resident trong ENV của subprocess con, cũng không cô lập runtime cho render-worker.

Nhấn lại cho rõ: **nửa phải (deterministic-end) không cần vẽ lại** — 5 hook, `permissions.deny`, green-gate, spec-guardian,
rules path-scoped, lint ép tiền/i18n/statusHistory vẫn là state-of-the-art; vòng này chỉ bồi đúng những seam còn hở và
**không relitigate** ADR-021/023 (single-thread cho code, advisory→deterministic, LLM-judge không bao giờ là gate).

## Khuyến nghị mới (đã kiểm chứng)

> Cột "Học từ" ghi nguồn ý tưởng; mọi đề xuất đã neo vào file thật và đã được sửa cho khớp ADR đang khoá. Sắp theo ưu tiên.

### A. Cổng kiểm chứng — chứng minh test *ràng buộc*, không chỉ *pass*

- **REC-15 — Mutation kill-gate trên OrderStatus state machine. 🔴 ✅** *Gap:* green-gate chỉ chứng minh test PASS, không
  phân biệt test vacuous với test thật; OSM là xương sống xuyên 4 surface nên một suite "pass mà không ràng buộc transition"
  là điểm mù cao nhất, coverage% không bắt được. *Làm:* `tests/harness/osm-mutation.test.sh` (em ruột deterministic của
  `guard.test.sh`, KHÔNG phải LLM-judge), scope CHỈ vào transition-guard + statusHistory-writer của `packages/core`; áp một
  bộ mutant tay cố định (bỏ guard cho cặp `from×to` bất hợp lệ; bỏ append statusHistory; swap `from/to`; bỏ check reason khi
  cancel/return) và assert OSM-01..03 PHẢI đỏ; mutant sống → fail. Wire cùng lane CI với `guard.test.sh` — **KHÔNG** vào
  inner-loop `verify-before-stop`. *Học từ:* Meta-ACH mutation-guided (kill-rate ≠ coverage), SWE-Mutation (suite tự
  overestimate ~71%→40%). **P2 · M.** *(Đã dựng — self-check toy-OSM chạy xanh ngay; real-arm tự kích ở Phase-0.)*
- **REC-16 — Anti-overfit guard: chặn hardcode literal khớp fixture (special-casing detector). 🔴 ✅** *Gap:* anti-reward-hacking
  REC-05 chỉ fire khi test *yếu đi* (`.skip`/xit/giảm assertion). Nó câm với cheat ngược của ImpossibleBench: làm test
  đỏ→xanh bằng cách **special-case implementation** — hardcode đúng `input→output` test kiểm (vd `if total == 390000 return
  '390.000₫'`); test vẫn xanh, assertion-count không đổi. *Làm:* nhánh trong `guard-files.sh` (kế REC-05): trên
  `PreToolUse(Edit|Write)` file SOURCE, trích literal "output đã-tính" (chuỗi `₫` · số nhóm-nghìn · int ≥5 chữ số) trong diff
  thêm, đối chiếu với fixture trong test đang sửa working-tree → `ask`. EXEMPT `packages/core/**`. +1 dòng WARN `spec-guardian.md`
  + fixtures `guard.test.sh`. *Học từ:* ImpossibleBench (special-casing né được LLM-monitor → cần gate cấu trúc). **P2 · M.**
  *(Đã dựng — fire trên ca khớp fixture, im trên core-exempt + enum + literal-không-khớp.)*

### B. Truy vết & shape của acceptance ledger

- **REC-17 — Coverage-map test: truy vết hai chiều requirement↔task↔test.** *Gap:* `acceptance.md`→test chứng minh mỗi dòng
  EARS có test, nhưng KHÔNG có gì chứng minh chiều ngược + ngang: mỗi acceptance có một TASK trong plan, và không task nào mồ
  côi. Cả một transition OSM có thể ship với zero acceptance line — không gate nào fire; spec-guardian chỉ WARN. *Làm:*
  **trước hết** 1 dòng convention (qua `.allow-contract-edit`) buộc mỗi task trong `plan.md`/`active-context.md` mang ≥1
  acceptance id; rồi `packages/core/coverage-map.test.ts` parse + assert: mỗi acceptance id ↔ ≥1 task **và** ≥1 test-id; mỗi
  task ↔ ≥1 acceptance id. Wire vào green-suite, scope 3 cụm backbone. *Học từ:* Spec Kit `/speckit.analyze` — hạ từ
  LLM-report xuống Vitest deterministic. **P2 · M.**
- **REC-18 — EARS-grammar lint trên `acceptance.md`.** *Gap:* viết EARS nhưng không ép mỗi dòng well-formed (1/5 template) với
  outcome đo được. *Làm:* mở rộng `acceptance.ledger.test.ts`: assert mỗi dòng bắt đầu 1/5 EARS shape + đúng một mệnh đề SHALL
  (hard-fail); warn-list mềm cho từ không định lượng (fast/nhanh) chỉ `console.warn` để không làm `verify-before-stop` flaky.
  *Học từ:* Spec Kit `/analyze` ambiguity pass + Kiro/EARS 5-template. **P2 · S.**

### C. Trí nhớ & context bền vững (bồi đầu trái)

- **REC-19 — PreCompact hook làm keep_first thành deterministic.** *Gap:* contract sống-sót-qua-`/compact` hiện là PROSE; không
  gì *chạy* lúc `/compact` để bảo đảm nó sống — đúng anti-pattern "always-must chỉ trong prose" ADR-021 bác. *Làm:*
  `.claude/hooks/pre-compact.sh` (matcher `manual`+`auto`) snapshot plan-path · 4 luật · changed-files · verify-cmd vào
  `.claude/state/precompact.md`; `session-start.sh` (đã fire `source=compact`) echo verbatim rồi xoá. Self-no-op khi vắng,
  **không bao giờ** block compaction. +fixture `guard.test.sh`. *Học từ:* Claude Code PreCompact + SessionStart `source=compact`.
  **P2 · S.**
- **REC-20 — Reasoning-digest + archive-on-pressure.** *Gap:* keep_first giữ *skeleton* nhưng KHÔNG nén phần giữa giàu thông
  tin (why-rejected-X, dead-ends, constraint vừa phát hiện); trên long single-thread chi tiết đó âm thầm rơi ở `/compact` →
  agent tái phạm lỗi đã học. *Làm:* thêm section "Reasoning digest" vào schema `active-context.md`; đổi nudge thành "trước
  `/clear`/`/compact`, append snapshot timestamp vào `active-context.history.md` (append-only, không hook nào đọc)". Giữ
  single-volatile-scratchpad. *Học từ:* Cognition compression-LLM + APM Handoff. **P2 · S.**
  **[ADR-026 · lane B, ưu tiên #1]** MemPalace xác nhận pre-compaction = điểm-save giá-trị-cao-nhất; chốt nội dung block: `## <ISO-ts>` + changed-files + ADR-id chạm + free-text "why-X-rejected/dead-ends". `active-context.history.md` git-tracked, **cold** (không hook đọc, lấy tay như learnings); +assert `guard.test.sh` append-only (line-count vs HEAD không giảm). Git-anchored inert tới Phase-0.
- **REC-21 — Eval regression cho hành vi chính agent (golden tasks).** *Gap:* có self-test hook nhưng KHÔNG có eval regression
  cho hành vi end-to-end; model bump / sửa rule không gì bắt drift (agent ngừng ghi statusHistory, ngừng i18n-key…). *Làm:*
  `docs/agent-evals/` (người curate, **không bao giờ** agent tự viết ground-truth) 15–25 golden task = prompt + assert
  final-state deterministic + verify-cmd, rút từ failure thật; chấm OUTCOME (vd thứ tự row outbox: statusHistory trước publish
  NATS), KHÔNG khung trajectory tool-call; ghi model-id mỗi run. Chạy `make agent-evals`/Cron — **KHÔNG** wire
  `verify-before-stop`, **không** LLM-judge. Cap ≤25. *Học từ:* Anthropic "Demystifying evals". **P2 · M.**

### D. Sàn bảo mật & isolation (tier "sandbox" đã đặt tên, chưa dựng)

- **REC-22 — Scrub creds khỏi ENV subprocess (`CLAUDE_CODE_SUBPROCESS_ENV_SCRUB`).** *Gap:* `permissions.deny` chặn FILE
  secret nhưng Bash subprocess **kế thừa ENV cha** — gồm `ANTHROPIC_API_KEY` + token Garage/NATS/Cloudflare export trong shell;
  `echo $ENV` là lộ, deny-list file không chạm. *Làm:* `"env": { "CLAUDE_CODE_SUBPROCESS_ENV_SCRUB": "1" }` vào
  `.claude/settings.json` + 1 dòng mitigations `conventions.md`. **Caveat:** chỉ match cred Anthropic + cloud-provider nhận-diện-được;
  token tự-đặt-tên (`NATS_TOKEN`) giữ trong SOPS/age, đừng export. +assertion key-tồn-tại `guard.test.sh`. *Học từ:* Claude Code
  sandboxing doc §Scope. **P2 · S.**
- **REC-23 — OS-enforced Bash sandbox cho path render-worker/ops.** *Gap:* sàn Bash chỉ match COMMAND/PATH STRING; không ngăn
  lệnh được phép (hay child / npm postinstall / Blender build dep) đọc `~/.ssh`/`~/.aws`/token Cloudflare hay exfil. *Làm:*
  block `sandbox` trong `settings.json`: `filesystem.denyRead` (`~/.ssh`,`~/.aws`,`~/.config/cloudflared`,`~/.claude`),
  `network.allowedDomains` (npm/crates/go proxy), `excludedCommands` (`docker *`/`gh *`/`gcloud *` — sandbox-incompatible).
  **CHƯA** set `failIfUnavailable`/`allowUnsandboxedCommands:false` ở file checked-in — quyết SAU khi đối chiếu `render-worker-gpu`
  skill. Document WSL2 (`bubblewrap`/`@anthropic-ai/sandbox-runtime`) trong `operations.md §GPU`. *Học từ:* Claude Code sandboxed Bash.
  **P2 · M.**
- **REC-24 — Container throwaway cho experiment-loop render-worker.** *Gap:* denylist không cho process/network/credential
  isolation; render-worker là chỗ chạy code untrusted (asset khách, CUDA install). *Làm:* 1 dòng pointer vào
  `render-worker-gpu/SKILL.md`: asset UNTRUSTED hoặc install tuỳ ý → chạy trong container throwaway dẫn xuất `asset-worker`
  (`operations.md §2`), **dưới lock concurrency=1**, cred unset, `--network none`. Tái dùng compose đã khoá — không Dagger,
  không chạm device-passthrough. **P3 · S.** *(Tránh tension ADR-007/009 vì scope vào throwaway, không phải production render.)*

### E. Plan store, story payload & risk gate

- **REC-25 — Story-file ephemeral: PACK payload cho code session.** *Gap:* `plan-to-file`/`active-context.md` là *router* trỏ
  WHERE-to-read; session vẫn re-read spec/decisions/conventions giữa task — đốt context, mời drift. *Làm:* `compile-story`
  template sinh `docs/stories/story-[slug].md` **ephemeral** (gitignored, regen per-story): snippet verbatim CHỈ ADR đang chạm
  + shape `statusHistory` + token design liên quan + test-id link + changed-files/verify-cmds. **COMPILED VIEW trỏ ngược id**,
  không claim authority (decisions/conventions vẫn hard-block). Wire vào orient + keep_first. *Học từ:* BMAD story-file, Agent OS
  Specs layer. **P2 · M.**
- **REC-26 — Risk-axis pre-code: chọn test-depth theo blast-radius TRƯỚC khi code.** *Gap:* gate đều ở stop-time/review-time;
  không gì đánh giá TRƯỚC khi code rằng change chạm vùng high-blast-radius (OSM/money/outbox/VRAM/PDPL). *Làm:* block risk-axis
  ~5 dòng vào schema `active-context.md`, catalog từ artifact sẵn có; mỗi axis tag đòi test-id *đã tồn tại* trong `acceptance.md`
  trước khi land — mở rộng `acceptance.ledger.test.ts` để fail "done" nếu thiếu. Tag không bao giờ block (advisory); Vitest là gate.
  **Không** điểm risk số. *Học từ:* BMAD Test Architect risk-profile. **P2 · S.**
- **REC-27 — Durable issue-graph (Beads-style) BỔ SUNG plan-to-file.** *Gap:* plan-file phẳng; không bản máy-đọc *việc nào còn*
  + *cái nào block cái nào* xuyên phiên; sau `/clear`, "next" re-derive từ prose. *Làm:* `.beads/issues.jsonl` git-tracked
  (KHÔNG service): `{id,title,status,blocked-by[],touched-ADR-ids[]}` + `scripts/ready.sh` in item mọi blocker đã closed; wire
  top-N vào orient block. **Bổ sung chứ không thay**; không UI/daemon/auto-mutate. *Học từ:* Beads (`bd ready`, decay). **P3 · M.**

### F. Insight store, budget & API-for-agents

- **REC-28 — Insight store non-binding, relevance-retrieved.** *Gap:* MEMORY.md non-binding (đúng) nhưng insight vận-hành
  hard-won ("Garage S3 multipart fail qua CF Tunnel trên X MB", "Blender CUDA OOM ở Y poly") quá tình huống để thành ADR, quá giá
  để mất. *Làm:* append "## Insights (non-binding, advisory)" vào mỗi `SKILL.md` (`render-worker-gpu`/`event-outbox`/`vn-compliance`,
  fallback `docs/insights.md`); skill load theo description-match nên insight tự surface đúng lúc. **Không bao giờ** wire hook/gate;
  muốn binding vẫn lên ADR. *Học từ:* mem0 + Beads `bd remember`/`bd prime`. **P2 · S.**
  **[ADR-026 · lane C]** Chốt format 1 dòng/insight: `date | trigger | finding | mitigation | nguồn` (vd `2026-06-23 | Garage upload >100MB qua CF Tunnel | 100MB body-cap ⇒ multipart fail | presigned-PUT part<100MB | ADR-005`); cap số entry/section để không thành MEMORY.md thứ hai. Surface = description-match SKILL.md (đã là 'relevance retrieval' native của Lumin).
- **REC-29 — Convention thiết kế tool/API agent-facing cho BFF / inbox-assistant.** *Gap:* harness governs cách Claude làm IN repo,
  không nói gì cách Lumin THIẾT KẾ tool surface mà LLM-agent consume; roadmap đẩy inbox-assistant drive BFF như tool. *Làm:*
  ADR mới + subsection "§Agent-facing tool/API design" trong `conventions.md` + rule path-scoped cho `services/core-api/**`:
  operation task-shaped (`create_inbox_order`) · namespace by resource · field human-readable (money qua MỘT core formatter) ·
  list paginate/filter/truncate · error steering. Layer ON OpenAPI→codegen (ADR-003), áp WHEN inbox-assistant (ADR-013) bật.
  *Học từ:* Anthropic "Writing tools for agents" + "Code execution with MCP". **P3 · M.**
- **REC-30 — Token-budget mềm (context-rot) cho `/compact` & `/clear`.** *Gap:* trigger hiện event/capacity-based, không ngưỡng
  token proactive; Chroma context-rot 2025 cho thấy accuracy giảm monotonic xa dưới giới hạn window. *Làm:* 1 dòng advisory vào
  keep_first + orient header: coi budget mềm (offload ở một phân số window) là mặc định. **Không** token-count hook/gate
  (brittle, vi phạm advisory→deterministic). *Học từ:* Chroma "Context Rot" + Anthropic just-in-time retrieval. **P3 · S.**

- **REC-38 — Budget tier always-on bằng số thật + guard cliff (lane A, ADR-026).** *Gap:* `session-start.sh:72` cap orient `head -c 3000` đo CHAR chưa từng đo token (MemPalace cùng bệnh: "170-token wake-up" thực ~810); `active-context.md` đang **38/40 dòng** sát cliff `sed -n '1,40p'` — một edit nữa tràn câm, cắt mất chính phần load-bearing. *Làm:* assertion `guard.test.sh` (a) `active-context.md ≤ 40 dòng`; (b) 4-luật-literal + dòng `## Focus` sống sót khi active-context chạm trần (correctness-critical KHÔNG bao giờ là phần bị `head -c 3000` cắt) — nếu cần, đổi tail-drop mù thành ghép section theo ưu tiên. Deterministic-tier, **không** hook token-count (REC-30 vẫn advisory). *Học từ:* MemPalace issue #39 (budget chưa đo) + kiến trúc keep_first của Lumin. **P1 · S.** Rẻ nhất + không phụ thuộc Phase-0 ⇒ làm mechanically trước nếu cần win nhanh.
- **REC-39 — Luật memory-scoping: topic-slice + pointer-surface, không monolith load-nguyên-khối (lane D, ADR-026).** *Gap:* path-scoped rules đã "route-to-scope-rồi-đọc" đúng, nhưng corpora KHÔNG-scope vẫn bơm nguyên khối: `MEMORY.md` + `lumin-agent-harness.md` (9.3KB) mỗi phiên, ~52KB learnings kéo cả file khi trích một REC — đúng anti-pattern flat-load MemPalace deflate-về. *Làm:* (1) `session-start.sh` coi index 4-dòng `MEMORY.md` là **scope-router** (dùng làm pointer thay vì kéo file linked); (2) tách `lumin-agent-harness.md` memory thành "current state" gọn (bảng REC-status) + đuôi provenance run-ID/assertion-count on-demand; (3) learnings phình thì slice theo §/REC có addressing. Convention/doc-only, **không** retrieval infra, **không** vector. *Học từ:* MemPalace scope-then-search/thin-index (đã bóc hạ tầng). **P2 · S.**

### G. Kỷ luật quy trình & autonomous lane (advisory, không relitigate single-thread)

- **REC-31 — Fan-out budget heuristic cho research read-only.** *Gap:* discipline nói "multi-agent CHỈ cho research" nhưng không
  cho số lượng/cost; Anthropic thấy subagent-count là failure-mode #1. *Làm:* mở rộng dòng `agent-harness.md §Kỷ luật`: count theo
  task-shape (1 fact-find / 2–4 comparison / 10+ chỉ research thật rộng); mỗi read-subagent nhận objective+output-format+scope.
  Advisory-tier, **không** chạm rule single-thread cho code. *Học từ:* Anthropic multi-agent research. **P3 · S.**
- **REC-32 — Hygiene clean-tree: worktree+branch throwaway, STRICTLY SERIAL.** *Gap:* research WRITE scratch, hoặc 2 task code
  độc lập queue back-to-back, chia một working tree không isolation. *Làm:* note vào `§Kỷ luật`: task detached/queued hoặc
  research-write-scratch chạy trong `wt/<task-id>`; **nói thẳng đây là hygiene serial, KHÔNG license parallel code writer**
  (single-thread ADR-021/023 đứng nguyên). *Học từ:* Vibe Kanban — reshape về serial-only. **P3 · S.** *(Giá trị biên solo-home.)*
- **REC-33 — Turn/cost budget gate với steering + escalation.** *Gap:* `verify-before-stop` có retry-budget (4 fail cùng target),
  `guard-bash` có loop-detector (cùng lệnh ≥4×), nhưng không cap tổng turn/cost; model có thể churn hàng trăm turn tốn mà không
  trip "same target 4×". *Làm:* trần turn per-session: `session-start.sh` reset `.claude/.turn-count`; `guard-bash.sh` tăng mỗi
  lần, ngưỡng mềm N → 1 dòng steering (exit-0, không block); trần cứng M trong `verify-before-stop` surface "cần người" như
  retry-budget. Deterministic counter, không LLM-judge. *Học từ:* gh-aw cost-management. **P2 · S.**

### H. Autonomous batch lane & self-healing (đã reshape khỏi đụng ADR)

- **REC-34 — Repair-event artifact feed vào fresh-context discipline (KHÔNG spawn repair-writer).** *Gap:* mỗi retry là CÙNG
  agent CÙNG context tích luỹ tái-công failure — đúng context-decay mode Ralph/gh-aw tránh. *Làm (reshape khỏi spawn — vì
  repair-writer đụng single-thread):* fail cuối, `verify-before-stop.sh` ghi `.claude/.repair-event` (failing-target · tail-50
  compacted error · `git status --porcelain` · last-green cmd); `session-start.sh` emit nó → khi operator theo discipline đã khoá
  "/clear + viết lại prompt", phiên fresh re-orient từ CHỈ compacted-failure + changed-files. TEST vẫn là gate. Clear ở green đầu.
  *Học từ:* gh-aw self-healing + 12-factor F9. **P2 · S.** *(Atom non-conflicting = repair-EVENT artifact; nhánh spawn bị bỏ.)*
- **REC-35 — Stateless-reducer batch lane (Ralph) cho backlog cơ học, gate bởi manifest riêng + verify-before-stop.** *Gap:*
  single-thread mạnh cho interactive nhưng không có lane autonomous cho backlog lớn well-specified low-judgment (extract i18n key,
  scaffold empty/loading/error, EARS test stub); constraint "home GPU + accept-downtime" thực ra HỢP Ralph. *Làm:*
  `docs/autonomous-loop.md` + ADR scope lane OPT-IN cho việc fully-EARS-spec cơ học CHỈ. Runner: refuse trừ khi cwd là
  worktree/container fresh; mỗi iteration spawn Claude fresh; pop 1 task từ manifest cơ học MỚI (`docs/loop-backlog.md`, KHÔNG
  phải `acceptance.md` invariant ledger); task phải pass `verify-before-stop` trước khi advance; tái dùng nguyên guard-bash/
  guard-files/spec-guardian. Cron deferred. *Học từ:* Ralph Wiggum + 12-factor F12. **P3 · L.** *(Cần ADR scope; tránh tension
  vì mỗi iteration sequential single-thread + test thật là gate.)*

### I. Subagent-stop & harness packaging

- **REC-36 — SubagentStop hook advisory.** *Gap:* `verify-before-stop` fire trên Stop của MAIN; subagent return về parent với
  zero gate — research subagent có thể trả path bịa; counter reset per-session, không per-subagent. *Làm:* `.claude/hooks/
  subagent-stop.sh` NON-blocking — emit `additionalContext` nhắc parent: coi path/claim subagent là UNVERIFIED tới khi Read/Grep;
  loop/retry budget per-session nên Stop của parent vẫn là check thật. **Bỏ** nhánh blocking. Advisory tier. *Học từ:* Claude Code
  SubagentStop (dùng dạng non-blocking). **P3 · S.**
- **REC-37 — Đóng gói harness thành plugin version SHA-pinnable (version-identity + CI-validate).** *Gap:* toàn control layer đặt
  tay dưới `.claude/` không version identity — không pin "harness vN", không rollback độc lập app, harness lớn dần → drift giữa
  `agent-harness.md` và disk. *Làm (downscope — KHÔNG migrate vào plugin cache vì `../` prohibition phá spec-guardian đọc
  `docs/*`):* `.claude-plugin/plugin.json` (name `lumin-harness`, `version`) làm version-stamp + `claude plugin validate --strict`
  như 1 assertion `guard.test.sh`. Defer marketplace/seed tới khi có máy/contributor thứ 2. *Học từ:* Claude Code plugins. **P3 · S.**

### J. Session-retro — vòng tổng hợp (nghiên cứu vòng 6, 2026-06-23, run wf_15aa1762)

- **REC-40 — Session-retro = tầng TỔNG HỢP nối 7 REC thành một vòng, KHÔNG hệ mới.** *Bối cảnh:* user hỏi "sau phiên thu thập + phân tích tốt/chưa-tốt + cải thiện phiên sau". 5 finder song song (reflection/experiential · trace-optim · CC-native · memory-arch · retro-discipline) + map + verify đối kháng + synth.
  *Gap:* harness đã THU THẬP tín hiệu phiên giá-trị-cao (`.verify-attempts`, `.cmd-history`, các ask guard-files, git diff, test xanh/đỏ ở Stop, transcript `.jsonl`) rồi VỨT ĐI cuối mỗi phiên; 7 REC chạm việc này (REC-20/21/28/33/34/38/39) nằm rời, chưa ai đóng-khung thành một vòng.
  *Nguyên tắc quyết-định (có bằng chứng cứng):* **advisory→deterministic + agent KHÔNG BAO GIỜ tự-bind luật cho mình** — Huang 2023 (ICLR 2310.01798: self-correct không-oracle âm ròng +7.6/−8.8) · self-preference 2410.21819 (vừa-sinh-vừa-chấm tự-cho-điểm-cao, **tệ-nhất-đúng-lúc-sai**) · Honesty→Subterfuge (NeurIPS24: reflection thuần → tự-sửa-reward/checklist).
  *Khảo sát (fact-checked, trừ-hao headline):* Reflexion/ExpeL/GEPA/ACE = **ADAPT** (lấy score-vs-feedback split / delta-append-không-rewrite / edit-on-contradiction; bỏ tự-trị + vector — ACE dedup bằng embedding = conflict); transcript-`.jsonl` + BM25-exact-key + SRE-blameless + agile-action-tracking = **CLEAN**; **memory-bloat (chọn-lọc 248→39% vs add-all 2400→13%, gấp 3×) = kết-quả-âm robust DUY NHẤT, xác nhận cap của Lumin**; Self-Refine/ADAS/TextGrad/Memory-tool/Cursor-gen-rules/Cline-bank/Letta = **CONFLICT** (LLM-judge-gate / auto-bind / vector / monolith — chỉ làm ví dụ phản diện). Mọi số vendor "self-improving memory" (mem0 92.5, Anthropic 84%/39%) single-vendor/beta.
  *Làm — 3 tầng (skeptic ĐÃ SỬA 7 điểm: 4 cắt-lớn + strip-nudge + log-tự-xoay-vòng + gate `stop_hook_active`):* **(1) COLLECT deterministic, zero LLM** — gấp lazy-compute vào `session-start.sh` SẴN CÓ (**KHÔNG** hook SessionEnd: chưa verify bắn-khi-Ctrl-D/crash ⇒ sẽ âm thầm bỏ lỡ đúng phiên tệ): phiên trước để lại signal-file mà thiếu dòng log → tìm `.jsonl` theo mtime, append 1 dòng pipe vào `docs/session-log.md` (append-only, **tự-xoay-vòng** bằng cap-dòng trong `guard.test.sh`, KHÔNG dọn-tay-hàng-tuần). **Noise-floor:** chỉ ghi khi phiên **không-sạch** (`guard-asks>0 ∨ loops>0 ∨ outcome≠green ∨ diff>N file`) — ngưỡng do NGƯỜI đặt, KHÔNG để LLM quyết "thú vị"; phiên xanh-sạch ghi 0 dòng + 0 one-shot (chống bloat). `outcome` từ ORACLE (`.verify-attempts` rỗng ở Stop), không bao giờ tự-chấm. `guard-asks` nhặt bằng `rg`/`jq` trên transcript (`permissionDecisionReason`), **KHÔNG mutate `guard-files.sh`** (gate hook giữ thuần một-việc). Dòng: `<ISO> | <sess8> | model=<id> | outcome=green|red|none | stuck=<tgt>x<n> | loops=<n> | guard-asks=<n> | tools=<n> | tool-errors=<n> | tokens=<in>/<out>/<cacheR> | diff=<f>f,+<a>/-<d> | commits=<b7>..<h7> | adrs=<…> | turns=<n>`. **(2) ANALYZE advisory/người-duyệt/opt-in** — skill `/retro` gọi-tay (Skill tool, KHÔNG hook/schedule), **pull-không-push**; v1 chỉ in facts deterministic + ứng-viên-gắn-route; **CẮT subagent why-analysis transcript** (=trajectory-grading + tự-soạn-chỉ-thị; NẾU sau này thêm: chỉ đọc `history.md` người-curate, KHÔNG transcript thô, output inline KHÔNG file-diff); **CẤM agent phát code assertion `guard.test.sh`** (file này KHÔNG guard-files-protect ⇒ paste vào = gate không-ADR) — chỉ "nêu pattern bằng văn xuôi". Hai tường deterministic: guard-files hard-block decisions/conventions + bước người-paste. **(3) FEED-FORWARD** — tái dùng one-shot `.precompact-state`: `.session-retro-pending` mang ĐÚNG payload REC-34 (failing-target + last-green + git-status), session-start phát verbatim rồi rm; **BỎ nudge "chạy /retro"**.
  *Nối REC:* REC-34 *subsumes* (nhánh outcome-đỏ = repair-event) · REC-20 *extends* (kênh lý-do `history.md` ↔ kênh outcome) · REC-28/21/39 *depends-on* (route insight 1-dòng / model-stamp drift→golden-task người-curate / topic-slice-không-monolith) · REC-33/38 *overlaps* (turn-count chỉ là 1 trường / cliff 40-dòng là gate, digest WARN). Taxonomy episodic/semantic/procedural = NHÃN gọi tên thứ Lumin đã có (history+transcript / `## Insights` / hooks+skills) ⇒ đường promote DUY NHẤT: quan-sát → insight-advisory → (người viết ADR) → luật.
  *Route feed-forward (5, theo binding-level):* **(a) mechanizable always-must** → NGƯỜI viết hook/lint + assertion `guard.test.sh` (agent CHỈ nêu-pattern-văn-xuôi, không phát code) = đúng promote advisory→deterministic · **(b) insight vận-hành** → `## Insights` SKILL.md 1-dòng `date|trigger|finding|mitigation|nguồn` (edit-on-contradiction: grep trigger-key → UPDATE) · **(c) lý-do/dead-end** → `active-context.history.md` (cold, append-only) · **(d) drift theo model** → `docs/agent-evals/` golden-task NGƯỜI-curate (agent KHÔNG viết ground-truth) · **(e) ràng-buộc thật** → ADR/luật qua NGƯỜI + `.allow-contract-edit`. (a)+(e) bước-NGƯỜI là bắt buộc — agent không tự đi.
  *Right-size (phản biện mạnh nhất, honest):* pre-Phase-0, repo CHƯA `git init` ⇒ chưa có vòng sửa-code nơi retro sinh lời ⇒ bản đầy đủ = over-engineering cho solo. **Chỉ làm Phase A** (lát COLLECT+re-orient, = thực thi REC-34 + phần REC-33 đã Accepted ⇒ **KHÔNG cần ADR mới**, zero hook/contract/LLM/chore; +fixture `guard.test.sh`: block `session-start` mới **self-no-op pre-Phase-0 + KHÔNG-bao-giờ-chặn** · cap-dòng `session-log` ép-rotate); **hoãn** Phase B (REC-20 kênh lý-do) · C (`/retro` chỉ khi có code-workload) · D (từ-vựng-promotion viết-không-tự-động). *Tiền-điều-kiện:* `stop_hook_active` còn hit hôm nay (rg xác nhận) nhưng cách 1 schema-change là âm thầm đảo `outcome=` ⇒ mở rộng test dòng 71 `guard.test.sh` khẳng định suy-ra-outcome trước khi tin.
  *Reject-list bổ sung:* hook SessionEnd làm trigger load-bearing · write side-effect trong gate hook · subagent why-analysis trên transcript thô · agent soạn assertion `guard.test.sh` · log append-only chỉ chặn bằng dọn-tay. *Học từ:* Reflexion/ExpeL/GEPA/ACE + SRE-blameless + agile-action-tracking + memory-bloat literature; verify đối kháng vs ADR-021/023/025/026 (harness-only — KHÔNG chạm ADR-011/013, không surface Meta-DOM/customer-data). **P1 · S (Phase A) / P3 (ANALYZE — defer).** *User đồng ý đóng-khung (2026-06-23); chưa build — findings, chờ Phase-0/git-init.*

## Đã cân nhắc nhưng bỏ

- **Spec-task lifecycle event (pre/post-task writeback)** — BỎ: đã giao bởi REC-02 + keep_first + plan-to-file; delta (per-task
  granularity) bất khả thi trên Claude Code (không có "spec task" transition event như Kiro); thêm prose-marker → relitigate
  advisory→deterministic. (Kiro)
- **Sequential role-HATS làm mode đặt-tên** — BỎ: mọi cơ chế đã có dưới tên khác. Review-hat = spec-guardian+oracle; dev-hat =
  single-thread "implement only" đã khoá; architect-hat = "zero [NEEDS CLARIFICATION]" + "name touched ADR" + story-file (REC-25).
  Còn lại thuần relabel. (BMAD/APM)
- **Eval-driven tool-description loop cho inbox-assistant** — BỎ: referent không tồn tại. Per ADR-011 inbox-assistant là panel
  deterministic gọi BFF qua REST typed; không có NL tool description để eval. Surface đó đã eval-gate bởi acceptance + Playwright +
  Testcontainers. (Anthropic writing-tools)
- **Metamorphic invariant test 4-surface shared state** — BỎ: tiền đề sai theo ADR-001 — MỘT state machine/RBAC/money trong Go
  Core-API, 4 surface consume qua MỘT OpenAPI client generated; không có implementation thứ 2 để relate → metamorphic vacuous.
  R1/R2/R3 collapse vào OSM-01/02/05. (MTF 2025)
- **Split scratchpad volatile vs progress ledger** — BỎ: "durable progress ledger" đã là `plan.md` (per-phase `**Done:**` marker,
  committed, sống qua `/clear`+`/compact`, `session-start.sh` grep heading+Done); volatile-half = `active-context.md`. `progress.md`
  riêng sẽ duplicate role plan.md + tạo two-file drift. (Cline Memory Bank)

## Lộ trình gợi ý

Tôn trọng ADR khoá: **single-thread cho code · advisory→deterministic · LLM-judge không bao giờ là gate**. Mọi item giữ TEST làm
gate, LLM chỉ WARN/NOTE; không relitigate ADR-021/023.

**P0 — guard mạnh nhất, làm trước (siết đúng chỗ green-gate tạo động cơ gian lận):**
- ✅ **REC-15** (mutation kill-gate OSM) + **REC-16** (anti-overfit special-casing) — **ĐÃ DỰNG**; chứng minh test *ràng buộc*
  không chỉ *pass*. (Cả hai 🔴; chạy off inner-loop/ASK-tier nên không làm chậm vòng agent.)

**P1 — cùng / ngay sau Phase-0 harness:**
- **REC-19** (PreCompact deterministic) + **REC-22** (env-scrub) — hai win deterministic rẻ, biến prose/gap thành cơ chế thật.
- **REC-17** (coverage-map hai chiều) + **REC-18** (EARS shape lint) — đóng vòng truy vết; REC-17 cần dòng convention task-id trước.
- **REC-20** (reasoning-digest) + **REC-21** (eval regression agent-behavior) — bồi đầu trái + bắt drift qua model bump.
- **REC-33** (turn/cost budget) + **REC-34** (repair-event) — chặn churn vô bound + feed fresh-context; cùng hạ tầng
  `guard-bash`/`session-start`/`verify-before-stop`.

**P2 — bồi thêm, không chặn launch:**
- **REC-25** (story-file ephemeral) + **REC-26** (risk-axis pre-code).
- **REC-23** (OS sandbox render-worker — sau khi đối chiếu render-worker-gpu skill) + **REC-28** (insight store) + **REC-27**
  (issue-graph additive).

**P3 — giá trị biên / forward-looking / cần ADR scope:**
- **REC-37** (harness plugin version-stamp) + **REC-36** (SubagentStop advisory) + **REC-31** (fan-out budget).
- **REC-24** (container experiment-loop) + **REC-30** (context-rot budget) + **REC-29** (agent-facing API — chờ inbox-assistant
  ADR-013) + **REC-32** (worktree hygiene).
- **REC-35** (Ralph batch lane) — L-effort, cần ADR scope; chỉ làm khi backlog cơ học đủ lớn.

**Lộ trình memory MemPalace (ADR-026) — khoá thứ tự B→A→C→D (cắt ngang P1–P2 trên):** **B = REC-20** (giá trị #1, P1) → **A = REC-38** (rẻ nhất, không phụ thuộc — làm mechanically trước cũng được) → **C = REC-28** (P2) → **D = REC-39** (P2). Tất cả advisory/doc/test, không gate mới, không đổi kiến trúc; Loại rõ vector DB/pluggable-backend/namespace/verbatim-product/on-device-embedding (chi tiết `decisions.md` ADR-026 §Loại).

**Vòng session-retro (REC-40, 2026-06-23, run wf_15aa1762) — đóng khung, KHÔNG ADR mới:** retro = **tầng tổng hợp** nối REC-20/21/28/33/34/38/39 thành một vòng 3 tầng (COLLECT deterministic / ANALYZE advisory-người-duyệt / FEED-FORWARD one-shot), không silo mới. **Right-size: chỉ Phase A** (COLLECT gấp vào `session-start.sh`, *subsumes* REC-34 + *overlaps* REC-33; P1·S) — làm khi repo `git init`/Phase-0; tầng ANALYZE (`/retro`) + Phase B/C/D **hoãn** tới khi có code-workload thật. Bằng chứng cứng "agent-không-tự-bind-luật" (Huang 2023 · self-preference 2410.21819 · Honesty→Subterfuge) + kết-quả-âm memory-bloat (chọn-lọc gấp 3× add-all) độc lập **xác nhận** hướng deterministic/no-vector/cap của Lumin. Chi tiết §J/REC-40.

---

## ADR-024 (ĐÃ CHỐT 2026-06-23 — đã merge vào `decisions.md`)

> Bản chốt nằm ở `docs/decisions.md` (status Accepted; REC-15/16/19/22 Implemented, REC-17/18/20/21/23–37 chờ implement).
> Block dưới là bản nháp lịch sử giữ lại để tham chiếu — nguồn chân lý là `decisions.md`.

```markdown
### ADR-024 — Mở rộng harness từ nghiên cứu vòng 2 (chứng minh test ràng buộc · truy vết acceptance · bồi đầu trái · sàn sandbox) · Proposed
Từ vòng nghiên cứu harness thứ 2 (2026-06-23, run wf_57240dd3) soi methodology-level + framework mới hơn vòng 1
(spec-driven dev: Spec Kit/Kiro/Tessl · agentic-SDLC: BMAD/Agent OS/APM/Vibe Kanban · essay engineering Anthropic ·
eval-driven: ImpossibleBench/Meta-ACH mutation/SWE-bench · memory: Beads/mem0/Cline · parallel-orchestration ·
Claude Code/SDK 2026 · 12-factor/Ralph). Bảng "đã có vs còn thiếu" + lý do từng REC ở **`agent-harness-learnings-r2.md`**
(31 ứng viên → verify đối kháng → 26 giữ, 5 bỏ vì trùng/đụng ADR/sai sự thật). **Giữ nguyên** advisory→deterministic
(ADR-021) và **không** relitigate single-thread-cho-code / LLM-judge-không-bao-giờ-gate; chỉ bồi 4 seam còn hở:

(1) **Green-gate chứng minh test RÀNG BUỘC, không chỉ PASS** — *đã dựng:* mutation kill-gate `osm-mutation.test.sh`
   (REC-15, mutant cố định lên OSM → assert OSM-01..03 chuyển đỏ; em deterministic của guard.test.sh, off inner-loop) +
   anti-overfit/special-casing trong `guard-files.sh` (REC-16, ask khi SOURCE hardcode literal output khớp fixture test
   đang sửa; core exempt) + dòng WARN special-casing trong spec-guardian.
(2) **Truy vết acceptance hai chiều** — coverage-map test requirement↔task↔test (REC-17, cần thêm 1 dòng convention task-id)
   + EARS-grammar lint trên acceptance.md (REC-18).
(3) **Bồi đầu trái** — PreCompact hook làm keep_first deterministic (REC-19) + reasoning-digest/archive (REC-20) +
   eval regression hành vi agent (REC-21, golden tasks người-curate, off green-gate) + turn/cost budget (REC-33) +
   repair-event artifact (REC-34).
(4) **Sàn sandbox (tier ADR-021 đặt tên chưa dựng)** — env-scrub subprocess (REC-22) + OS Bash sandbox render-worker/ops
   (REC-23) + container throwaway experiment-loop (REC-24).
Cùng: story-file ephemeral (REC-25) · risk-axis pre-code (REC-26) · insight store non-binding (REC-28) · issue-graph
additive (REC-27) · context-rot budget (REC-30) · fan-out heuristic (REC-31) · worktree hygiene serial (REC-32) ·
SubagentStop advisory (REC-36) · harness plugin version-stamp (REC-37). Forward-looking chờ inbox-assistant (ADR-013):
convention tool/API agent-facing (REC-29). Opt-in cần scope riêng: Ralph batch-lane cơ học (REC-35).

**Loại (đã verify đối kháng, bỏ):** spec-task lifecycle event (không có transition-event như Kiro) · sequential role-hats
(thuần relabel) · eval-driven tool-description cho inbox-assistant (panel REST typed, không LLM tool) · metamorphic 4-surface
(MỘT core, không có impl thứ 2 để relate) · split progress.md riêng (đã là plan.md). **Mọi REC giữ TEST làm gate**, LLM
(spec-guardian/oracle) chỉ WARN/NOTE. Lộ trình P0→P3 ở `agent-harness-learnings-r2.md`. Trạng thái: REC-15+REC-16 Accepted &
Implemented; REC-17..37 Proposed.
```
