# Agent harness — cách điều khiển Claude Code ở repo này

> **Mục đích:** mô tả tầng "điều khiển" để mọi phiên Claude làm đúng ý, ít lệch. Bổ trợ cho [`conventions.md`](conventions.md) (luật) và [`decisions.md`](decisions.md) (vì sao). Quyết định nền: **ADR-020** (stack lint/test) + **ADR-021** (kiến trúc điều khiển) + **ADR-022** (siết file hợp đồng) + **ADR-023** (mở rộng vòng 2) + **ADR-024** (vòng 2 methodology) + **ADR-025** (học chọn lọc từ Superpowers). Bối cảnh "học từ harness ngoài": [`agent-harness-learnings.md`](agent-harness-learnings.md) · [`agent-harness-learnings-r2.md`](agent-harness-learnings-r2.md) · [`agent-harness-learnings-superpowers.md`](agent-harness-learnings-superpowers.md).
> **Nguyên lý:** CLAUDE.md/rules là *advisory* (model cố theo, không đảm bảo). Luật "luôn-phải" được đẩy xuống tầng *deterministic* (hook/deny/test). Claude dừng khi việc *trông như* xong ⇒ phải có verification chạy được + chặn dừng tới khi xanh.

## Phổ điều khiển (yếu → mạnh)
chat → CLAUDE.md → `.claude/rules/` + `.claude/skills/` → plan đã duyệt → **permission deny → hook → test/typecheck → sandbox**

**Thứ tự ưu tiên khi xung đột (tie-break — B5/ADR-025).** Khi hai nguồn guidance mâu thuẫn, giải theo thứ tự:
1. **Tier deterministic thắng tuyệt đối** — hook/permission-deny/test/sandbox là *cơ chế*; không "lý luận" qua được. Nếu một advisory bảo làm điều hook chặn ⇒ hook đúng, advisory sai/lỗi thời.
2. **Hợp đồng > advisory** — `decisions.md`/`conventions.md`/`spec.md` thắng `rules`/`skills`/`CLAUDE.md`/chat. Mâu thuẫn với hợp đồng ⇒ không tự sửa code theo advisory; sửa qua đường amend ADR (`.allow-contract-edit`) hoặc hỏi.
3. **Cụ-thể-hơn > tổng-quát** — rule path-scoped khớp hẹp thắng `CLAUDE.md` chung; giá trị "đặc thù feature" trong plan thắng mặc định.
4. **Luật cứng > prose** — LLM-judge (spec-guardian/oracle) là tier **yếu nhất**, chỉ WARN; không bao giờ override test/hook.
> Không echo thứ tự này vào session-start (giữ orient gọn) — nó là tham chiếu khi gặp xung đột, không phải nhắc mỗi phiên.

## Cái gì nằm ở đâu
| Thành phần | File | Vai trò |
|---|---|---|
| Guidance phổ quát | `/CLAUDE.md` §6 | Luật áp mọi nơi (tiền, i18n, statusHistory, reduced-motion) |
| Guidance theo bề mặt | `.claude/rules/*.md` | Load **chỉ khi** chạm file khớp `paths:` (storefront/admin/extension/asset-worker/domain-core/a11y-i18n) |
| Knowledge theo chủ đề | `.claude/skills/*/SKILL.md` | Model tự gọi theo `description` (frontmatter — mang trigger **WHEN** "Đọc trước khi…") cho mối quan tâm **cross-cutting** (compliance, GPU, outbox) |
| Hợp đồng & vì sao | `docs/decisions.md`, `docs/conventions.md`, `spec.md` | Nguồn chân lý — đừng relitigate |
| Acceptance máy-kiểm | `docs/acceptance.md` | Criteria EARS theo feature, gắn test id (xương sống) |
| Rào chắn cứng | `.claude/settings.json` + `.claude/hooks/*.sh` | Chặn/định dạng/kiểm/orient tự động; `env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1` strip cred khỏi subprocess (REC-22) |
| Reviewer độc lập | `.claude/agents/spec-guardian.md` | Soi diff theo hợp đồng (compliance), ngữ cảnh sạch |
| Cố vấn thiết kế | `.claude/agents/oracle.md` | Ý kiến thứ hai về **design** (gọi tay, không phải gate) |
| Self-test harness | `tests/harness/guard.test.sh` | CI kiểm chính các hook còn chặn đúng (chống gate no-op) |

## Hooks (deterministic — xem `.claude/hooks/`)
- **`session-start.sh`** (SessionStart, REC-01/06): khi mở/`/clear`/`/compact`, (a) **reset** state loop/retry (`.cmd-history`, `.verify-attempts`) **+ dọn van-xả** `.skip-verify`/`.allow-contract-edit` (audit 2026-06-23: van là check-tồn-tại-file, tạo-rồi-quên = tắt gate vĩnh viễn ⇒ mỗi van chỉ sống MỘT phiên, buộc re-arm); (b) phát một khối `additionalContext` **nhỏ (<30 dòng)** để orient — nhánh + commit cuối, index `## ` heading + `**Done:**` của `plan.md`, và `docs/active-context.md` nếu có. **Không** suy ra "phase đang chạy" (plan.md không có marker máy đọc). (c) nếu có snapshot `.claude/.precompact-state` (do PreCompact ghi), phát **verbatim TRƯỚC tiên** rồi xoá (one-shot) — phục hồi keep_first sau `/compact`. **(d) Front-load 4 luật always-must (REC-SP-01/ADR-025)** ở nhánh *không có* snapshot precompact (startup/clear/resume) — vì OSM xuyên 4 surface, phiên sửa path không auto-load `domain-core.md` khởi động mù; gate `[ -f .precompact-state ]` tránh trùng sau `/compact`, giữ **đồng bộ literal** với `pre-compact.sh` dòng 17. **(e) Liệt kê skill-index (REC-SP-10/ADR-025)** — glob động `.claude/skills/*/`, pointer thuần, **không** auto-invoke. **(f) Harness version-stamp (REC-37/REC-SP-08/ADR-025)** — commit `.claude/**` cuối từ `git log -1 -- .claude/` (KHÔNG plugin.json/VERSION — doNotAdopt plugin polyglot; harness là file commit nên git LÀ version) để phát hiện phiên cũ chạy harness cũ. Self-no-op khi vắng git/file.
- **`pre-compact.sh`** (PreCompact·manual+auto, REC-19/ADR-024): TRƯỚC `/compact`, snapshot keep_first thành `.claude/.precompact-state` — path plan đang dùng · 4 luật always-must · file `git` đã đổi + verify-cmd theo ngôn ngữ đổi · ADR id chạm (heuristic grep diff). `session-start` (fire `source=compact`) phát lại ⇒ keep_first thành **deterministic** thay vì chỉ prose. **Không bao giờ** block compaction (exit 0); self-no-op khi vắng git.
- **`guard-bash.sh`** (PreToolUse·Bash): chặn lệnh huỷ diệt — `rm -rf /|~|*|.|./*`, `docker compose down -v` (kể cả `docker-compose` gạch-nối + cờ `-f` xen giữa; mất data Garage/Postgres, ADR-018), `git push --force` (kể cả `git -C … push --force`; cho phép `--force-with-lease`), `git reset --hard`/`git clean -f`/`git checkout -- .`, `find … -delete`, `shred`, `truncate -s 0`, `: > file`, `mkfs`/`dd`/`--no-preserve-root`, DROP/TRUNCATE, fork bomb. Exit 2 = chặn. **+ Secret-bypass guard (audit 2026-06-23):** `permissions.deny Read(.env)` chỉ chặn **tool Read**, không chặn `cat .env`/`source .env` qua Bash, và env-scrub chỉ lọc ENV var (không lọc nội dung file) ⇒ guard-bash nay chặn (a) **đọc/exfil** secret (`cat|grep|source|base64|…` nhắm `.env`/`*.age`/`*.pem`/`id_rsa`/`secrets/`) và (b) **ghi-redirection** (`>`/`tee`/`sed -i`/`dd of=`) vào file **hợp đồng** (`decisions.md`/`conventions.md`) hoặc secret — vốn đi vòng `guard-files` (chỉ match Edit|Write). Chừa `.env.example`. **+ Loop-detector (REC-06):** cùng một lệnh lặp **≥4 lần liên tiếp** → exit 2 ("no-progress loop, đổi cách"). Đặt **sau** pattern huỷ diệt nên an toàn ưu tiên.
- **`guard-files.sh`** (PreToolUse·Edit|Write): **chặn cứng** sửa secrets (`.env`, `*.age`, `*.pem`, `*.dec.*`…). **Hard-block (REC-03/ADR-022)** `decisions.md`+`conventions.md` — trừ khi có van xả `.claude/.allow-contract-edit`. **Ask** khi sửa `tokens/*.css`, `CLAUDE.md`, `AGENTS.md`. Mọi quyết định `ask` đi qua `ask()` có **JSON-escape** giá trị nội suy (audit 2026-06-23: trước đây `$FILE`/`$lit` chứa `"`/`\` làm JSON vỡ → Claude Code bỏ qua decision → guard **fail-open**; nay escape như `session-start.sh`). **Anti-reward-hacking (REC-05):** **ask** khi file test bị làm yếu (thêm `.skip`/`t.Skip`/`xit`/`xdescribe`, hoặc Write giảm số assertion so với git HEAD). **Anti-overfit / special-casing (REC-16/ADR-024 nháp):** **ask** khi file SOURCE (ngoài `packages/core`) thêm literal "output đã-tính" (chuỗi `₫` · số nhóm-nghìn · int ≥5 chữ số) **trùng y nguyên** fixture/expected của test **đang sửa trong working tree** — bắt cheat ngược của REC-05 (hardcode output để qua test thay vì cài logic). Cần `jq`+`git`; `packages/core/**` exempt (formatter tiền/i18n/literal transition-table sống ở đây hợp lệ). Van self-test: `GUARD_SPECIALCASE_TESTROOT`.
- **`format-and-lint.sh`** (PostToolUse·Edit|Write): **parse-gate Go** (`gofmt -e`) **trước tiên** — file vỡ cú pháp → exit 2 ngay (REC-08); rồi format + lint **file vừa đổi** (Prettier + ESLint `--fix` cho TS; gofmt/gofumpt cho Go; rustfmt cho Rust). Lỗi lint → đẩy lại cho Claude tự sửa.
- **`verify-before-stop.sh`** (Stop): chặn kết thúc tới khi `typecheck/lint/test` xanh **với ngôn ngữ có file vừa đổi**. Tự bỏ qua nếu chỉ đổi docs hoặc chưa có tool. Van xả: `.claude/.skip-verify`. **Retry budget (REC-06):** sau **4 lần fail cùng target** → cho dừng + cảnh báo "cần người" (không loop vô hạn, không "done" ngầm) — quan trọng cho ca môi trường như test GPU không pass nổi trên GTX 1060. **Writeback nhắc (REC-02):** đổi >1 file source mà chưa đụng `docs/active-context.md` → nhắc cập nhật (**non-blocking**, phát qua `additionalContext`, không exit 2).

> Mọi hook **tự no-op** khi tool/script chưa cài → an toàn trước khi Phase 0 dựng xong codebase. Chúng gọi *script trừu tượng* (`pnpm verify`, `make verify-go`) nên không phụ thuộc version cụ thể.

## Reviewer: spec-guardian (compliance)
Trước khi coi task là "done" cho thay đổi nhiều file, gọi subagent **spec-guardian** (hoặc skill `/code-review`) để soi diff. Nó chạy ngữ cảnh sạch ⇒ không thiên vị code vừa viết, bắt được vi phạm ADR/conventions + thay đổi ngoài scope + **bóp méo test** (xoá case/thêm skip/bỏ assertion trên invariant lõi = BLOCKER). Giới hạn vào correctness/hợp đồng, không bàn style. **Read-only chứng minh được** (REC-04): bộ tool chỉ `Read, Grep, Glob` (không Bash/Edit) — người gọi **dán diff** vào lúc gọi.

## Cố vấn thiết kế: oracle (design — gọi tay)
`.claude/agents/oracle.md` là **ý kiến thứ hai về design**, khác vai spec-guardian: spec-guardian hỏi "có vi phạm ADR không" (compliance); oracle hỏi "cách tiếp cận có đúng/idiomatic/an toàn cho bất biến không" (design). Read-only, **gọi tay**, neo vào subsystem xương sống (một-state-machine-xuyên-4-surface, NATS+outbox, render-worker GPU). **Không bao giờ** wire vào hook hay làm cổng `verify-before-stop` — LLM-judge là tier verification yếu nhất, chỉ để hỏi câu design khó.

## Review hai verdict tách riêng + hand-off qua file (B2 / ADR-025)
Một lần review = **hai câu hỏi khác nhau, hai verdict riêng** (Superpowers tách rõ; Lumin có sẵn mảnh ghép nên chỉ làm rõ):
1. **Spec-compliance** — *"có vi phạm ADR/conventions/spec không?"* → **spec-guardian** (hoặc `/code-review`). Vi phạm hợp đồng / bóp méo test (xoá case·thêm skip·bỏ assertion invariant lõi) = **BLOCKER**. Đây là gate mềm bắt buộc trước "done" cho thay đổi nhiều-file.
2. **Code-quality** — *"cách tiếp cận idiomatic/an toàn cho bất biến không?"* → **oracle** (gọi tay) hoặc `/code-review`. **Advisory** — ý kiến, không chặn.

Đừng trộn hai verdict thành một "nhìn-ổn" mơ hồ: một PR có thể **pass compliance** nhưng vẫn cần sửa quality (và ngược lại). Compliance là điều kiện *cần* để done; quality là khuyến nghị.

**Hand-off qua FILE, không paste (B2):** mọi thứ dán vào prompt **nằm lại context và bị đọc lại mỗi turn** — diff lớn paste inline làm phình token + nhiễu. Với diff/đầu-vào lớn: ghi ra file gitignore (vd `.claude/.review-diff`) rồi **truyền path** để reviewer `Read` (spec-guardian có `Read`); main-loop giữ context gọn. Áp cùng nguyên tắc cho mọi artifact lớn truyền giữa các bước/subagent.

## Skills (topic-scoped, model tự gọi)
`.claude/skills/*/SKILL.md` cho knowledge **cross-cutting** không gắn một path (nên `rules/` path-scoped không phủ): mỗi skill = `description` frontmatter 1 dòng (field thật, mang trigger WHEN — **không** có field `when_to_use` riêng) + **pointer** tới doc nguồn (defer, **không restate** để khỏi drift), ~0 token tới khi nhắc chủ đề. Đã đăng ký:
- **`vn-compliance`** → `docs/compliance.md` (online.gov.vn, PDPL, đổi-trả, hoá đơn) — không rule nào surface doc này.
- **`render-worker-gpu`** → `docs/operations.md` §GPU + `.claude/rules/asset-worker.md` (ràng buộc GTX-1060/VRAM khi task ops chạm render ngoài `services/asset-worker/**`).
- **`event-outbox`** → `.claude/rules/domain-core.md` + ADR-006 (publish-on-commit/idempotency cho path admin-reconcile & checkout không auto-load domain-core).

> **Không** đặt luật always-must vào skills (những luật đó ở hook/lint per ADR-021). Skills chỉ là knowledge gợi-nhớ-đúng-lúc.
> **ADR-025 (học từ Superpowers):** `description` mỗi skill nay mang trigger **"Đọc trước khi &lt;action&gt;"** (consult sớm nơi cost-of-miss cao nhất — mất NATS job / OOM render / ship consent sai); session-start front-load 4 luật + skill-index. Chuẩn mô tả skill = **WHEN-to-use, KHÔNG phải WHAT** (Superpowers chứng minh: tóm tắt workflow vào description khiến agent theo description thay vì đọc skill). **Loại rõ:** KHÔNG port cơ chế mandatory-skill kiểu Superpowers ("1%"/"not negotiable"/skill-check-before-clarify) — enforcement bằng wording cực đoan là tier verification yếu nhất, sẽ đảo ngược ADR-021.

## Authoring craft — viết hook/rule/skill/doc (B4 / ADR-025)
Thu hoạch *writing-skills* của Superpowers (bản thân nó tái khẳng định ADR-021). Khi cần "dạy" agent một hành vi, **chọn hình thức khớp với kiểu lỗi** — sai hình thức thì tài liệu không ăn:

| Kiểu lỗi quan sát được | Hình thức đúng | Ở Lumin |
|---|---|---|
| **Ràng buộc cơ học** (regex/validate được) | **Tự động hoá** — hook/deny/lint/test | guard-bash, guard-files, ESLint cấm `Intl` ngoài core |
| Agent **lý luận vòng** qua một luật | Bảng **red-flags chống-ngụy-biện** (liệt kê đúng câu chống chế) | REC-SP-05 ở §Kỷ luật; anti-reward-hacking |
| **Output sai shape** | **Recipe dương** (ví dụ đúng, copy được) | template `implementation-plan.md`, formatter `390.000₫` |
| **Thiếu element bắt buộc** | **Slot REQUIRED** / checklist | §6 Self-review của plan-template; `statusHistory{from,to,at,byUser}` |
| Hành vi **theo điều kiện** | **Conditional tường minh** ("WHEN x → y") | acceptance EARS; transition table |
| Cần **phán đoán** (không cơ học hoá được) | **Document** (rule/skill pointer) | rules path-scoped, 3 skill |

**Quy tắc gốc (= ADR-021):** *mechanical → automate; judgment → document.* Luật regex-được mà còn nằm dạng prose ⇒ đẩy xuống hook/lint. Thứ cần phán đoán mà bị nhét vào gate cứng ⇒ sẽ false-positive, gỡ ra thành advisory.

**Chuẩn mô tả skill/rule:** `description` = **WHEN-to-use, không phải WHAT-it-does** — nhồi tóm tắt workflow vào description khiến agent theo description thay vì đọc nguồn → drift. Pointer-not-restate để khỏi lệch nguồn chân lý.

## Acceptance ledger (`docs/acceptance.md`)
Criteria **EARS** cho 3 cụm xương sống (order-state-machine, money, checkout), mỗi dòng gắn **test id**, bắt đầu **chưa tick**. Là dạng máy-kiểm-được của "Test P0" trong `plan.md`, **không** phải nguồn chân lý mới. **Phase 0:** thêm test `acceptance.ledger.test.ts` parse file này và fail nếu một dòng `[x]` thiếu test pass → `verify-before-stop` tự ép. spec-guardian chỉ **WARN** (LLM enforce phủ định yếu); **test là gate**.

## Harness self-test (CI)
`tests/harness/guard.test.sh` (**85 assertion**, audit 2026-06-23) feed fixture vào TỪNG hook và assert cổng chặn **fire** (rm -rf + data-loss `git reset --hard`/`clean`/`find -delete`/`shred`/`:>`, **secret-read + protected-write qua Bash**, sửa .env/`*.dec.*`, hard-block decisions.md, test bị làm yếu, **special-casing REC-16** cả đường van lẫn đường git-status thật, loop detector vòng đầy đủ, **van-xả tự dọn**, **retry-budget 4× surface**, **Go parse-gate**, **pre-compact content**, **REC-02 nhắc**, **ask() JSON hợp lệ khi path có `"`** chống fail-open, **4-luật literal đồng bộ 2 hook**…) + ca dương (lệnh lành / `.env.example` đi qua) + mỗi rule có `paths:` + osm-mutation tồn tại/hợp-cú-pháp. Test cần toolchain (Go/make/git) tự **skip sạch** khi vắng. Chạy **được pre-Phase-0** (không phụ thuộc app toolchain). **Đã wire CI** (`.github/workflows/harness.yml`) chạy khi `.claude/**`·`tests/harness/**`·`docs/agent-harness.md` đổi — vì mọi hook self-no-op tới Phase 0, "gate no-op" trông y hệt "gate pass"; self-test là cái phân biệt. Khi sửa hook, cập nhật fixture tương ứng.

## Mutation kill-gate OSM (`tests/harness/osm-mutation.test.sh`, REC-15/ADR-024 nháp)
Em ruột **deterministic** của `guard.test.sh` (KHÔNG phải LLM-judge) — chứng minh test OSM *ràng buộc* transition, không chỉ *pass* (coverage% mù với test vacuous; OSM là xương sống xuyên 4 surface ⇒ điểm mù cao nhất). **Self-check (luôn chạy, 11 assertion):** áp bộ mutant cố định — `allow-all guard` · `swap from/to` · **`drop-edge`** · **`add-illegal-edge`** · **`terminal-escape`** (→ OSM-01, gồm bất biến terminal CANCELLED/RETURNED không cạnh-ra) · `drop statusHistory` (→ OSM-02) · `drop reason-check` (→ OSM-03) — lên một toy-OSM pure-bash + toy-test, assert mỗi mutant bị **KILL** (test tương ứng chuyển đỏ). Họ mutant cấu-trúc-cạnh (drop/add/terminal, audit 2026-06-23) bắt test over-/under-constrains transitions. Mutant sống = test không ràng buộc → fail. **Real-arm:** tự kích khi Phase-0 land `packages/core` (áp cùng họ mutant lên OSM thật + chạy `order_state.*`); self-no-op khi OSM chưa có. Chạy ở **CI lane `.claude/**` cùng `guard.test.sh`** — **KHÔNG** wire vào inner-loop của `verify-before-stop` (giữ vòng agent nhẹ).

## Stack lint/test đã chốt (ADR-020) — script surface để hook gọi
| Lớp | TS/JS | Go | Rust |
|---|---|---|---|
| Format | Prettier 3 (+ `prettier-plugin-tailwindcss`) | gofmt/gofumpt | rustfmt |
| Lint | **ESLint 10 flat** + typescript-eslint + `eslint-config-next` + `jsx-a11y` + `eslint-plugin-i18next` + rule cấm `Intl.NumberFormat`/`toLocaleString` ngoài `core` | **golangci-lint v2** + `sqlc vet` (db-prepare) | clippy `-D warnings` |
| Typecheck | `tsc -b` (project references, qua Turborepo) | `go build ./...` | `cargo check` |
| Test | **Vitest 3** + **@fast-check/vitest** (bất biến tiền/state) + **Playwright** (e2e) | `go test -race` + testcontainers-go | `cargo test` (tuỳ chọn nextest) |

**Script chuẩn (đặt khi Phase 0):**
- Root `package.json`: `lint`, `lint:fix`, `format`, `format:check`, `typecheck`, `test`, `test:e2e`, `verify` (= `turbo run lint typecheck test` + `format:check`), `lint:file` (ESLint 1 file, có `--cache`, cho PostToolUse).
- `Makefile`: `verify-go` (gofmt+golangci-lint+go build+sqlc vet+go test), `verify-rs` (fmt+clippy+test).

**Không enforce được bằng linter** (làm bằng test/CSS-lint): sentence-case microcopy (test trên message catalog), `prefers-reduced-motion` (Playwright/Stylelint).

## Trạng thái cục bộ & van xả (đều gitignore)
| File | Hook dùng | Ý nghĩa |
|---|---|---|
| `.claude/.skip-verify` | verify-before-stop · session-start dọn | Bỏ qua green-gate một lần (ca môi trường) — **chỉ sống một phiên** (session-start xoá) |
| `.claude/.allow-contract-edit` | guard-files · session-start dọn | **Đường amend** file hợp đồng lõi: tạo → sửa (chỉ thêm ADR/Superseded) → xoá — **chỉ sống một phiên** (session-start tự dọn nếu quên) |
| `.claude/.verify-attempts` | verify-before-stop | Đếm fail/target (retry budget); session-start reset |
| `.claude/.cmd-history` | guard-bash | Ring buffer phát hiện loop lệnh; session-start reset |
| `.claude/.precompact-state` | pre-compact → session-start | Snapshot keep_first ghi TRƯỚC `/compact`; session-start phát lại + xoá (one-shot, REC-19) |

## Compaction contract + bộ ghim keep_first (REC-14 → REC-19 deterministic)
Khi `/compact`, những thứ sau **phải sống sót** (đừng để summary bỏ mất). **REC-19/ADR-024:** hook `pre-compact.sh` nay **tự snapshot** bộ này vào `.claude/.precompact-state` để `session-start` phát lại sau `/compact` — keep_first thành *deterministic*, không còn chỉ là prose phải nhắc tay. Vẫn nên nhắc trong prompt/PLAN.md khi muốn chắc:
1. **Path file plan đang dùng** (`PLAN.md` / `docs/active-context.md`) — vì context chat mất khi nén.
2. **ADR id đang chạm** phiên này (để không vô tình relitigate).
3. **4 luật always-must** (`conventions.md`): statusHistory mọi lần đổi trạng thái · money = int VND qua **một** formatter `core` · i18n key không hard-code · tôn trọng `prefers-reduced-motion`.
4. **Danh sách file đã đổi + lệnh verify** (`pnpm verify` / `make verify-go|verify-rs`).

**Ranh giới promote memory:** auto-memory (`MEMORY.md` / `lumin-*.md`) là **scratchpad** — đồng bộ *facts* hai chiều với docs (`README.md` quy tắc sync), nhưng **KHÔNG bao giờ binding**. Muốn ràng buộc phiên sau thì phải thành **ADR** trong `decisions.md` hoặc **luật** trong `conventions.md` (cả hai đã được `guard-files.sh` canh — decisions/conventions ở mức hard-block).

## Kỷ luật quy trình (advisory nhưng quan trọng)
- Việc nhiều-file/không-chắc → **Plan mode trước, ghi plan ra file** — dùng khung [`docs/templates/implementation-plan.md`](templates/implementation-plan.md) (B1/ADR-025: Global Constraints verbatim · Interfaces Consumes/Produces · No-Placeholders · Self-review vs spec), lưu thành `docs/plans/<feature>.md`. Focus đang chạy thì ghi `docs/active-context.md`. Việc 1-câu-diff → bỏ qua plan.
- **Red-flags ngụy biện ở done/skip-gate (REC-SP-05):** "thay đổi nhỏ" · "chỉ refactor" · "không liên quan logic" **KHÔNG** phải lý do bỏ verify — `verify-before-stop` chạy bất kể, chỉ có van xả ghi-rõ (`.skip-verify` ca môi trường · retry-budget 4 lần) mới qua. Tự thấy mình đang lý luận để khỏi chạy test ⇒ đó là tín hiệu phải chạy.
- **Zero `[NEEDS CLARIFICATION]` trước khi rời plan mode** (spec-kit/Kiro): nếu plan còn chỗ mơ hồ, hỏi cho rõ rồi mới code.
- Cập nhật **`docs/active-context.md`** khi đổi nhiều file (focus · 1-3 bước kế · open question · lần verify xanh gần nhất) — Stop hook sẽ nhắc.
- Sửa sai 2 lần cùng chỗ → `/clear` + viết lại prompt (đừng cố trong phiên đã ô nhiễm).
- `/clear` giữa task không liên quan; `/compact` giữ bộ keep_first ở trên.
- Mặc định **single-thread + subagent kiểm chứng** cho việc *viết code*; multi-agent song song chỉ cho *nghiên cứu đọc rộng* (tốn ~15× token).
- Ranh giới kiểu "đừng push" muốn chắc thì để thành **deny rule**, đừng chỉ nói trong chat.
