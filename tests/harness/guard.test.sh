#!/usr/bin/env bash
# Harness self-test (REC-09 / ADR-023) — feed fixture vào các hook và assert cổng chặn FIRE.
# Chạy ĐƯỢC pre-Phase-0 (không phụ thuộc app toolchain pnpm/golangci-lint). Wire vào CI khi .claude/** đổi.
# Mục tiêu: gate "no-op âm thầm" sẽ FAIL ở đây thay vì trông như pass.
set -u
ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
HOOKS="$ROOT/.claude/hooks"
pass=0; fail=0
export TURN_COUNT_FILE="$(mktemp)"   # audit-r3: cô lập counter REC-33, tránh ghi .claude/.turn-count THẬT khi test
ok()  { printf '  \033[32m✓\033[0m %s\n' "$1"; pass=$((pass+1)); }
bad() { printf '  \033[31m✗\033[0m %s\n' "$1"; fail=$((fail+1)); }

run_hook() { OUT="$(printf '%s' "$2" | bash "$HOOKS/$1" 2>/dev/null)"; RC=$?; }
expect_block() { run_hook "$1" "$2"; [ "$RC" -eq 2 ] && ok "$3" || bad "$3 (exit=$RC, kỳ vọng 2)"; }
expect_pass()  { run_hook "$1" "$2"; [ "$RC" -eq 0 ] && ok "$3" || bad "$3 (exit=$RC, kỳ vọng 0)"; }
expect_ask()   { run_hook "$1" "$2"; printf '%s' "$OUT" | grep -q '"permissionDecision":"ask"' \
                   && ok "$3" || bad "$3 (không thấy ask; exit=$RC)"; }
# ask() phải emit JSON HỢP LỆ kể cả khi path/literal chứa " hoặc \ — nếu vỡ JSON, Claude Code
# bỏ qua decision => guard FAIL-OPEN. Cần jq để xác minh (skip sạch nếu vắng jq).
expect_ask_valid_json() { run_hook "$1" "$2"
  if ! command -v jq >/dev/null 2>&1; then ok "$3 (skip: vắng jq)"; return; fi
  if printf '%s' "$OUT" | jq -e '.hookSpecificOutput.permissionDecision=="ask"' >/dev/null 2>&1; then
    ok "$3"; else bad "$3 (JSON vỡ -> fail-open; out=$OUT)"; fi; }

echo "== guard-bash: lệnh huỷ diệt =="
expect_block guard-bash.sh '{"tool_input":{"command":"rm -rf *"}}'                        "rm -rf * bị chặn"
expect_block guard-bash.sh '{"tool_input":{"command":"ls; rm -rf ~"}}'                    "rm -rf ~ sau ; bị chặn"
expect_block guard-bash.sh '{"tool_input":{"command":"echo $(rm -rf *)"}}'                "rm -rf trong \$() bị chặn"
expect_block guard-bash.sh '{"tool_input":{"command":"docker compose down -v"}}'          "docker compose down -v bị chặn"
expect_block guard-bash.sh '{"tool_input":{"command":"git push --force origin main"}}'    "git push --force bị chặn"
expect_block guard-bash.sh '{"tool_input":{"command":"mkfs.ext4 /dev/sda"}}'              "mkfs bị chặn"
expect_pass  guard-bash.sh '{"tool_input":{"command":"pnpm -s test"}}'                    "lệnh lành đi qua"
expect_pass  guard-bash.sh '{"tool_input":{"command":"git push --force-with-lease"}}'     "force-with-lease đi qua"

echo "== guard-bash: mất dữ liệu chưa-commit / xoá hàng loạt (audit 2026-06-23) =="
expect_block guard-bash.sh '{"tool_input":{"command":"docker-compose down -v"}}'          "docker-compose (gạch nối) down -v bị chặn"
expect_block guard-bash.sh '{"tool_input":{"command":"docker compose -f x.yml down -v"}}' "docker compose -f ... down -v bị chặn"
expect_block guard-bash.sh '{"tool_input":{"command":"git reset --hard origin/main"}}'    "git reset --hard bị chặn"
expect_block guard-bash.sh '{"tool_input":{"command":"git clean -fdx"}}'                  "git clean -fdx bị chặn"
expect_block guard-bash.sh '{"tool_input":{"command":"find . -delete"}}'                  "find -delete bị chặn"
expect_block guard-bash.sh '{"tool_input":{"command":"shred -u key.pem"}}'                "shred bị chặn"
expect_block guard-bash.sh '{"tool_input":{"command":"rm -rf ./*"}}'                      "rm -rf ./* bị chặn"
expect_block guard-bash.sh '{"tool_input":{"command":":> important.txt"}}'                ": > file (truncate) bị chặn"
expect_block guard-bash.sh '{"tool_input":{"command":"git -C /repo push --force"}}'       "git -C ... push --force bị chặn"
expect_pass  guard-bash.sh '{"tool_input":{"command":"git reset --soft HEAD~1"}}'         "git reset --soft đi qua (không mất dữ liệu)"
expect_pass  guard-bash.sh '{"tool_input":{"command":"rm -rf ./build/cache"}}'            "rm -rf ./build/cache đi qua"
expect_pass  guard-bash.sh '{"tool_input":{"command":"echo hi > out.txt"}}'               "> file thường đi qua (không phải truncate :>)"

echo "== guard-bash: secret-read + protected-write qua Bash (audit 2026-06-23) =="
expect_block guard-bash.sh '{"tool_input":{"command":"cat .env"}}'                        "cat .env bị chặn (deny Read không phủ Bash)"
expect_block guard-bash.sh '{"tool_input":{"command":"source .env.production"}}'          "source .env.production bị chặn"
expect_block guard-bash.sh '{"tool_input":{"command":"grep KEY app/.env.local"}}'         "grep .env.local bị chặn"
expect_block guard-bash.sh '{"tool_input":{"command":"cat secrets/prod.age"}}'            "cat secrets/*.age bị chặn"
expect_block guard-bash.sh '{"tool_input":{"command":"head id_rsa"}}'                     "head id_rsa bị chặn"
expect_block guard-bash.sh '{"tool_input":{"command":"echo x > docs/decisions.md"}}'      "ghi-redirection vào decisions.md bị chặn"
expect_block guard-bash.sh '{"tool_input":{"command":"sed -i s/a/b/ .env"}}'              "sed -i vào .env bị chặn"
expect_pass  guard-bash.sh '{"tool_input":{"command":"cat .env.example"}}'                "cat .env.example (template) đi qua"
expect_pass  guard-bash.sh '{"tool_input":{"command":"cp .env.example .env"}}'            "cp .env.example .env đi qua"
expect_pass  guard-bash.sh '{"tool_input":{"command":"echo x > docs/plan.md"}}'           "ghi vào docs/plan.md (không bảo vệ) đi qua"

echo "== guard-bash: loop detector (REC-06) =="
TMPH="$(mktemp)"; export CMD_HISTORY_FILE="$TMPH"
j='{"tool_input":{"command":"echo same-loop"}}'
run_hook guard-bash.sh "$j"; run_hook guard-bash.sh "$j"; run_hook guard-bash.sh "$j"
run_hook guard-bash.sh "$j"   # lần 4
[ "$RC" -eq 2 ] && ok "lặp 4× lệnh y hệt bị chặn" || bad "loop detector (exit=$RC)"
unset CMD_HISTORY_FILE; rm -f "$TMPH"

echo "== guard-files: secrets (chặn cứng) =="
expect_block guard-files.sh '{"tool_input":{"file_path":"/x/.env"}}'                       ".env bị chặn cứng"
expect_block guard-files.sh '{"tool_input":{"file_path":"/x/k.age"}}'                       "*.age bị chặn cứng"
expect_block guard-files.sh '{"tool_input":{"file_path":"/x/k.pem"}}'                       "*.pem bị chặn cứng"
expect_block guard-files.sh '{"tool_input":{"file_path":"/x/app/.env.local"}}'              ".env.local bị chặn cứng"
expect_block guard-files.sh '{"tool_input":{"file_path":"/x/config.dec.yaml","content":"k: v"}}' "*.dec.* (secret giải mã) bị chặn cứng (audit 2026-06-23)"
expect_pass  guard-files.sh '{"tool_input":{"file_path":"/x/.env.example","content":"FOO="}}' ".env.example (template) ĐƯỢC sửa"
expect_pass  guard-files.sh '{"tool_input":{"file_path":"/x/apps/web/page.tsx","content":"export default 1"}}' "file thường đi qua"

echo "== guard-files: file hợp đồng (REC-03 / ADR-022) =="
rm -f "$ROOT/.claude/.allow-contract-edit"
expect_block guard-files.sh '{"tool_input":{"file_path":"/x/docs/decisions.md"}}'          "decisions.md hard-block khi không có van xả"
expect_block guard-files.sh '{"tool_input":{"file_path":"/x/docs/conventions.md"}}'        "conventions.md hard-block khi không có van xả"
expect_ask   guard-files.sh '{"tool_input":{"file_path":"/x/CLAUDE.md"}}'                   "CLAUDE.md vẫn ở mức ask"
expect_ask   guard-files.sh '{"tool_input":{"file_path":"/x/tokens/color.css"}}'           "tokens/*.css vẫn ở mức ask"
expect_ask   guard-files.sh '{"tool_input":{"file_path":"/x/AGENTS.md"}}'                   "AGENTS.md ở mức ask (REC-13)"
# Van xả bật -> rơi xuống ask
touch "$ROOT/.claude/.allow-contract-edit"
expect_ask   guard-files.sh '{"tool_input":{"file_path":"/x/docs/decisions.md"}}'          "decisions.md -> ask khi có .allow-contract-edit"
rm -f "$ROOT/.claude/.allow-contract-edit"

echo "== guard-files: anti-reward-hacking test (REC-05) =="
expect_ask   guard-files.sh '{"tool_input":{"file_path":"/x/foo.test.ts","content":"it.skip(\"x\",()=>{})"}}'  "thêm it.skip vào *.test.ts -> ask"
expect_ask   guard-files.sh '{"tool_input":{"file_path":"/x/bar_test.go","new_string":"func TestX(t*testing.T){t.Skip()}"}}' "thêm t.Skip vào *_test.go -> ask"
expect_pass  guard-files.sh '{"tool_input":{"file_path":"/x/foo.test.ts","content":"it(\"x\",()=>{expect(1).toBe(1)})"}}' "test lành đi qua"
# B1 (audit 2026-06-23): path chứa " làm ask() vỡ JSON -> fail-open. Phải vẫn là ask + JSON hợp lệ.
expect_ask_valid_json guard-files.sh '{"tool_input":{"file_path":"/x/a\".test.ts","new_string":"it.skip(1)","old_string":"it(1)"}}' "ask() JSON hợp lệ khi path chứa dấu \" (không fail-open)"

echo "== guard-files: anti-overfit / special-casing (REC-16) =="
SCDIR="$(mktemp -d)"; printf "expect(format(390000)).toBe('390.000₫')\n" > "$SCDIR/money.test.ts"
export GUARD_SPECIALCASE_TESTROOT="$SCDIR"
expect_ask  guard-files.sh '{"tool_input":{"file_path":"/x/services/web/money.ts","content":"export function f(t){ if(t===390000) return \"390.000₫\"; return \"\" }"}}' "source hardcode 390.000₫ khớp fixture -> ask"
expect_pass guard-files.sh '{"tool_input":{"file_path":"/x/packages/core/money.ts","content":"export function f(t){ if(t===390000) return \"390.000₫\"; return \"\" }"}}' "packages/core exempt -> pass"
expect_pass guard-files.sh '{"tool_input":{"file_path":"/x/services/web/money.ts","content":"export function f(t){ if(t===111222) return \"111.222₫\"; return \"\" }"}}' "literal không khớp fixture -> pass"
expect_pass guard-files.sh '{"tool_input":{"file_path":"/x/services/web/order.ts","content":"if (status===\"PENDING_CONFIRM\") return x"}}' "enum compare (không literal output) -> pass"
unset GUARD_SPECIALCASE_TESTROOT; rm -rf "$SCDIR"

echo "== verify-before-stop: no-op paths =="
expect_pass  verify-before-stop.sh '{"stop_hook_active":true}'                              "stop_hook_active=true -> cho dừng"

echo "== REC-22 env-scrub + REC-19 PreCompact =="
grep -q 'CLAUDE_CODE_SUBPROCESS_ENV_SCRUB' "$ROOT/.claude/settings.json" \
  && ok "env-scrub key có trong settings.json (REC-22)" || bad "thiếu env-scrub key (REC-22)"
expect_pass pre-compact.sh '{"hook_event_name":"PreCompact","trigger":"auto"}'              "pre-compact không bao giờ block (exit 0)"
rm -f "$ROOT/.claude/.precompact-state"   # dọn side-effect file của ca trên
# session-start tiêu thụ snapshot precompact rồi xoá (one-shot)
printf 'SENTINEL-PRECOMPACT-XYZ\n' > "$ROOT/.claude/.precompact-state"
OUT="$(printf '%s' '{"hook_event_name":"SessionStart","source":"compact"}' | bash "$HOOKS/session-start.sh" 2>/dev/null)"
printf '%s' "$OUT" | grep -q 'SENTINEL-PRECOMPACT-XYZ' \
  && ok "session-start phát snapshot precompact (REC-19)" || bad "session-start KHÔNG phát snapshot precompact"
[ -f "$ROOT/.claude/.precompact-state" ] \
  && { bad "snapshot precompact KHÔNG bị xoá (one-shot)"; rm -f "$ROOT/.claude/.precompact-state"; } \
  || ok "snapshot precompact bị xoá sau khi phát (one-shot)"

echo "== rules: mỗi rule có front-matter paths: =="
shopt -s nullglob
for f in "$ROOT"/.claude/rules/*.md; do
  if grep -qE '^paths:' "$f"; then ok "$(basename "$f") có paths:"; else bad "$(basename "$f") THIẾU paths:"; fi
done

echo "== osm-mutation.test.sh: tồn tại + cú pháp hợp lệ (REC-15) =="
OSM="$ROOT/tests/harness/osm-mutation.test.sh"
[ -f "$OSM" ] && ok "osm-mutation.test.sh tồn tại" || bad "osm-mutation.test.sh THIẾU"
bash -n "$OSM" 2>/dev/null && ok "osm-mutation.test.sh cú pháp hợp lệ" || bad "osm-mutation.test.sh lỗi cú pháp"

echo "== session-start: front-load 4 luật + skill index (REC-SP-01/10 / ADR-025) =="
rm -f "$ROOT/.claude/.precompact-state"
OUTA="$(printf '%s' '{"hook_event_name":"SessionStart","source":"startup"}' | bash "$HOOKS/session-start.sh" 2>/dev/null)"
printf '%s' "$OUTA" | grep -q 'always-must' \
  && ok "startup phát 4 luật always-must (REC-SP-01)" || bad "startup KHÔNG phát 4 luật always-must"
printf '%s' "$OUTA" | grep -q 'vn-compliance' \
  && ok "orient surface skill index động (REC-SP-10)" || bad "orient KHÔNG surface skill index"
# Dedup: sau /compact, snapshot precompact đã chứa 4 luật -> KHÔNG phát thêm lần 2 (nhánh else bị skip)
printf '• 4 luật always-must: statusHistory ... prefers-reduced-motion.\n' > "$ROOT/.claude/.precompact-state"
OUTB="$(printf '%s' '{"hook_event_name":"SessionStart","source":"compact"}' | bash "$HOOKS/session-start.sh" 2>/dev/null)"
ndup="$(printf '%s' "$OUTB" | grep -o 'always-must' | wc -l | tr -d ' ')"
[ "$ndup" = "1" ] && ok "sau /compact: 4 luật xuất hiện đúng 1 lần (không trùng snapshot)" || bad "4 luật trùng/thiếu sau compact (n=$ndup)"
rm -f "$ROOT/.claude/.precompact-state"

echo "== ADR-025 lộ trình B/REC: active-context · version-stamp · plan-template · rule-content =="
# B3: active-context.md tồn tại -> startup orient đọc & phát focus (file này wire 3 hook)
printf '%s' "$OUTA" | grep -q 'active-context' \
  && ok "startup phát docs/active-context.md (B3)" || bad "startup KHÔNG phát active-context (B3)"
# REC-SP-10 vẫn sống sau khi đổi thứ tự (skill-index đặt trước block lớn để không bị cap 3000)
printf '%s' "$OUTA" | grep -q 'vn-compliance' \
  && ok "skill-index sống sót cap sau reorder (REC-SP-10)" || bad "skill-index bị cap mất sau reorder"
# REC-37/REC-SP-08: version-stamp — phát ĐÚNG khi .claude/ đã có commit; chưa commit thì self-no-op.
# Gate test theo cùng điều kiện hook dùng (git log -- .claude/) để khớp hợp đồng thật, không over-assert.
if [ -n "$(git -C "$ROOT" log -1 --pretty='%h' -- .claude/ 2>/dev/null)" ]; then
  printf '%s' "$OUTA" | grep -q 'Harness rev' \
    && ok "orient phát Harness rev version-stamp (REC-37)" || bad "orient KHÔNG phát Harness rev (REC-37)"
else
  ok "REC-37 version-stamp self-no-op khi .claude/ chưa có commit (đúng)"
fi
# B1: plan-template tồn tại + đủ slot bắt buộc (chống template mục ruỗng theo thời gian)
PT="$ROOT/docs/templates/implementation-plan.md"
if [ -f "$PT" ] && grep -q 'Global constraints' "$PT" && grep -q 'Consumes' "$PT" \
   && grep -q 'No-Placeholders' "$PT" && grep -q 'Self-review' "$PT"; then
  ok "plan-template đủ slot (Global constraints·Consumes·No-Placeholders·Self-review) (B1)"
else
  bad "plan-template thiếu slot bắt buộc (B1)"
fi
# REC-SP-02: rule extension.md còn mang luật sống còn ADR-011 (no-DOM-Meta) — content-check chống rule rỗng
EXT="$ROOT/.claude/rules/extension.md"
if grep -q 'ADR-011' "$EXT" && grep -qi 'DOM' "$EXT"; then
  ok "extension.md còn mang ADR-011 + cấm DOM Meta (REC-SP-02)"
else
  bad "extension.md MẤT luật sống còn ADR-011/no-DOM-Meta (REC-SP-02)"
fi

# ===== Lấp self-test holes (audit 2026-06-23) =====

echo "== session-start: van-xả tự dọn mỗi phiên (audit 2026-06-23) =="
touch "$ROOT/.claude/.skip-verify" "$ROOT/.claude/.allow-contract-edit"
printf '%s' '{"hook_event_name":"SessionStart","source":"startup"}' | bash "$HOOKS/session-start.sh" >/dev/null 2>&1
{ [ ! -f "$ROOT/.claude/.skip-verify" ] && [ ! -f "$ROOT/.claude/.allow-contract-edit" ]; } \
  && ok "session-start xoá .skip-verify + .allow-contract-edit (van một-phiên)" \
  || { bad "van-xả KHÔNG bị dọn ở session-start"; rm -f "$ROOT/.claude/.skip-verify" "$ROOT/.claude/.allow-contract-edit"; }

echo "== guard-bash: loop-detector vòng đầy đủ (1-3 pass · 4 block · reset) (audit) =="
TMPH2="$(mktemp)"; export CMD_HISTORY_FILE="$TMPH2"
jl='{"tool_input":{"command":"echo loop-full"}}'
run_hook guard-bash.sh "$jl"; a1=$RC; run_hook guard-bash.sh "$jl"; a2=$RC; run_hook guard-bash.sh "$jl"; a3=$RC
run_hook guard-bash.sh "$jl"; a4=$RC; run_hook guard-bash.sh "$jl"; a5=$RC
{ [ "$a1" = 0 ] && [ "$a2" = 0 ] && [ "$a3" = 0 ]; } && ok "loop 1-3 đi qua (chưa đủ ngưỡng)" || bad "loop 1-3 không pass (a1=$a1 a2=$a2 a3=$a3)"
[ "$a4" = 2 ] && ok "loop lần 4 bị chặn" || bad "loop lần 4 không chặn (a4=$a4)"
[ "$a5" = 0 ] && ok "loop sau chặn reset -> lần 5 đi qua" || bad "loop không reset sau chặn (a5=$a5)"
unset CMD_HISTORY_FILE; rm -f "$TMPH2"

echo "== invariant: 4-luật literal đồng bộ session-start.sh ↔ pre-compact.sh (audit) =="
ssL="$(grep -F '4 luật always-must:' "$HOOKS/session-start.sh" | head -1 | sed -E 's/^[^•]*//; s/".*$//')"
pcL="$(grep -F '4 luật always-must:' "$HOOKS/pre-compact.sh"   | head -1 | sed -E 's/^[^•]*//; s/".*$//')"
{ [ -n "$ssL" ] && [ "$ssL" = "$pcL" ]; } && ok "4-luật literal khớp byte giữa 2 hook" \
  || bad "4-luật literal LỆCH (ss='$ssL' pc='$pcL')"

echo "== format-and-lint: Go parse-gate (REC-08) =="
if command -v gofmt >/dev/null 2>&1; then
  GTMP="$(mktemp -d)"
  printf 'package main\nfunc main( {\n' > "$GTMP/broken.go"
  run_hook format-and-lint.sh "{\"tool_input\":{\"file_path\":\"$GTMP/broken.go\"}}"
  [ "$RC" -eq 2 ] && ok "Go syntax vỡ -> exit 2 (REC-08)" || bad "Go parse-gate không fire (exit=$RC)"
  printf 'package main\n\nfunc main() {}\n' > "$GTMP/ok.go"
  run_hook format-and-lint.sh "{\"tool_input\":{\"file_path\":\"$GTMP/ok.go\"}}"
  [ "$RC" -eq 0 ] && ok "Go hợp lệ -> exit 0" || bad "Go hợp lệ bị chặn nhầm (exit=$RC)"
  rm -rf "$GTMP"
else ok "format-and-lint Go parse-gate (skip: vắng gofmt)"; fi

echo "== verify-before-stop: retry budget 4× surface (REC-06) =="
if command -v make >/dev/null 2>&1 && command -v git >/dev/null 2>&1; then
  VTMP="$(mktemp -d)"; ( cd "$VTMP" && git init -q && git config user.email t@t && git config user.name t )
  printf 'verify-go:\n\t@exit 1\n' > "$VTMP/Makefile"
  printf 'package main\n' > "$VTMP/x.go"
  VATT="$(mktemp)"; rm -f "$VATT"
  runv() { OUT="$(printf '{}' | env CLAUDE_PROJECT_DIR="$VTMP" VERIFY_ATTEMPTS_FILE="$VATT" bash "$HOOKS/verify-before-stop.sh" 2>/dev/null)"; RC=$?; }
  runv; r1=$RC; runv; r2=$RC; runv; r3=$RC; runv; r4=$RC
  { [ "$r1" = 2 ] && [ "$r2" = 2 ] && [ "$r3" = 2 ]; } && ok "fail 1-3 chặn dừng (exit 2)" || bad "retry 1-3 không chặn (r1=$r1 r2=$r2 r3=$r3)"
  { [ "$r4" = 0 ] && printf '%s' "$OUT" | grep -q 'FAIL 4'; } && ok "fail lần 4 -> surface cho người + cho dừng (exit 0)" || bad "retry budget lần 4 sai (r4=$r4)"
  rm -rf "$VTMP" "$VATT"
else ok "verify-before-stop retry budget (skip: vắng make/git)"; fi

echo "== verify-before-stop: REC-02 nhắc active-context (non-blocking) =="
if command -v git >/dev/null 2>&1; then
  RTMP="$(mktemp -d)"; ( cd "$RTMP" && git init -q )
  printf 'export const a=1\n' > "$RTMP/a.ts"; printf 'export const b=2\n' > "$RTMP/b.ts"
  OUT="$(printf '{}' | env CLAUDE_PROJECT_DIR="$RTMP" bash "$HOOKS/verify-before-stop.sh" 2>/dev/null)"; RC=$?
  { [ "$RC" = 0 ] && printf '%s' "$OUT" | grep -q 'active-context'; } && ok "đổi >1 source chưa đụng active-context -> nhắc (non-blocking)" || bad "REC-02 nhắc không phát (exit=$RC)"
  rm -rf "$RTMP"
else ok "verify-before-stop REC-02 (skip: vắng git)"; fi

echo "== verify-before-stop: ADR-027 risk-banner + diff-size (advisory, non-blocking) =="
if command -v git >/dev/null 2>&1; then
  RB="$(mktemp -d)"; ( cd "$RB" && git init -q )
  mkdir -p "$RB/packages/core"; printf 'export const x=1\n' > "$RB/packages/core/order-state.ts"
  OUT="$(printf '{}' | env CLAUDE_PROJECT_DIR="$RB" bash "$HOOKS/verify-before-stop.sh" 2>/dev/null)"; RC=$?
  { [ "$RC" = 0 ] && printf '%s' "$OUT" | grep -q 'RỦI-RO-CAO'; } \
    && ok "ADR-027: diff chạm packages/core/order -> risk-banner (advisory, exit 0)" \
    || bad "ADR-027: risk-banner không phát (exit=$RC)"
  rm -rf "$RB"
  RB2="$(mktemp -d)"; ( cd "$RB2" && git init -q )
  mkdir -p "$RB2/docs"; printf '# readme\n' > "$RB2/docs/README.md"
  OUT="$(printf '{}' | env CLAUDE_PROJECT_DIR="$RB2" bash "$HOOKS/verify-before-stop.sh" 2>/dev/null)"; RC=$?
  { [ "$RC" = 0 ] && ! printf '%s' "$OUT" | grep -q 'RỦI-RO-CAO'; } \
    && ok "ADR-027: đổi doc thường -> KHÔNG risk-banner (đúng)" \
    || bad "ADR-027: risk-banner báo nhầm trên doc"
  rm -rf "$RB2"
else ok "ADR-027 risk-banner (skip: vắng git)"; fi

echo "== pre-compact: nội dung snapshot keep_first (REC-19) =="
if command -v git >/dev/null 2>&1; then
  PTMP="$(mktemp -d)"; ( cd "$PTMP" && git init -q )
  mkdir -p "$PTMP/docs"; printf '# active\n' > "$PTMP/docs/active-context.md"; printf 'export const x=1\n' > "$PTMP/foo.ts"
  PCF="$(mktemp)"
  printf '%s' '{"trigger":"manual"}' | env CLAUDE_PROJECT_DIR="$PTMP" PRECOMPACT_FILE="$PCF" bash "$HOOKS/pre-compact.sh" >/dev/null 2>&1
  { grep -q 'always-must' "$PCF" && grep -q 'File đã đổi' "$PCF" && grep -q 'pnpm verify' "$PCF"; } \
    && ok "snapshot chứa 4-luật + file đổi + verify-cmd" || bad "snapshot pre-compact thiếu nội dung keep_first"
  rm -rf "$PTMP" "$PCF"
else ok "pre-compact content (skip: vắng git)"; fi

echo "== guard-files: special-casing đường git-status THẬT (REC-16, không qua van) =="
if command -v git >/dev/null 2>&1; then
  STMP="$(mktemp -d)"; ( cd "$STMP" && git init -q )
  mkdir -p "$STMP/x"; printf "expect(format(390000)).toBe('390.000₫')\n" > "$STMP/x/money.test.ts"
  OUT="$(printf '%s' "{\"tool_input\":{\"file_path\":\"$STMP/services/web/money.ts\",\"content\":\"export function f(t){ if(t===390000) return '390.000₫'; return '' }\"}}" | env CLAUDE_PROJECT_DIR="$STMP" bash "$HOOKS/guard-files.sh" 2>/dev/null)"
  printf '%s' "$OUT" | grep -q '"permissionDecision":"ask"' \
    && ok "source hardcode khớp test untracked (git-status path) -> ask" || bad "REC-16 đường git-status THẬT không fire (out=$OUT)"
  rm -rf "$STMP"
else ok "guard-files special-casing real-path (skip: vắng git)"; fi

# ===== Mở rộng audit 2026-06 =====

echo "== guard-bash: huỷ lịch sử git (audit 2026-06) =="
expect_block guard-bash.sh '{"tool_input":{"command":"git stash clear"}}'                  "git stash clear bị chặn"
expect_block guard-bash.sh '{"tool_input":{"command":"git stash drop"}}'                   "git stash drop bị chặn"
expect_block guard-bash.sh '{"tool_input":{"command":"git update-ref -d refs/heads/x"}}'   "git update-ref -d bị chặn"
expect_block guard-bash.sh '{"tool_input":{"command":"git reflog expire --all"}}'          "git reflog expire bị chặn"
expect_block guard-bash.sh '{"tool_input":{"command":"git gc --prune=now"}}'               "git gc --prune bị chặn"
expect_block guard-bash.sh '{"tool_input":{"command":"git branch -D feature"}}'            "git branch -D (force, mất commit) bị chặn"
expect_pass  guard-bash.sh '{"tool_input":{"command":"git branch -d merged"}}'             "git branch -d (an toàn) đi qua (case-sensitive)"
expect_pass  guard-bash.sh '{"tool_input":{"command":"git gc"}}'                           "git gc (không --prune) đi qua"
expect_pass  guard-bash.sh '{"tool_input":{"command":"git stash pop"}}'                    "git stash pop đi qua"

echo "== guard-bash: secret-read qua interpreter/dot-source/redirect (audit 2026-06) =="
expect_block guard-bash.sh '{"tool_input":{"command":"python3 -c open(\".env\")"}}'        "python -c open(.env) bị chặn"
expect_block guard-bash.sh '{"tool_input":{"command":"node -e readFileSync(\".env\")"}}'    "node -e readFileSync(.env) bị chặn"
expect_block guard-bash.sh '{"tool_input":{"command":". ./.env"}}'                          "dot-source . ./.env bị chặn"
expect_block guard-bash.sh '{"tool_input":{"command":"read X < .env"}}'                     "read X < .env (redirect) bị chặn"
expect_block guard-bash.sh '{"tool_input":{"command":"cat .env.example.local"}}'           ".env.example.local KHÔNG được whitelist (anchor) bị chặn"
expect_pass  guard-bash.sh '{"tool_input":{"command":"python3 -c print(1)"}}'              "python vô hại (không secret) đi qua"
expect_pass  guard-bash.sh '{"tool_input":{"command":"node build.js"}}'                    "node build.js đi qua"

echo "== guard-bash: GHI vào file bảo vệ qua verb không-redirection + self-guard (audit 2026-06) =="
expect_block guard-bash.sh '{"tool_input":{"command":"cp /tmp/x docs/decisions.md"}}'      "cp -> decisions.md bị chặn"
expect_block guard-bash.sh '{"tool_input":{"command":"mv /tmp/x docs/conventions.md"}}'    "mv -> conventions.md bị chặn"
expect_block guard-bash.sh '{"tool_input":{"command":"python3 -c open(\"docs/decisions.md\",\"w\")"}}' "python ghi decisions.md bị chặn"
expect_block guard-bash.sh '{"tool_input":{"command":"git checkout other -- docs/decisions.md"}}'      "git checkout -- decisions.md bị chặn"
expect_block guard-bash.sh '{"tool_input":{"command":"echo x > .claude/hooks/verify-before-stop.sh"}}'  "redirect -> hook (self-guard Bash) bị chặn"
expect_pass  guard-bash.sh '{"tool_input":{"command":"mv old.ts new.ts"}}'                 "mv file thường đi qua"
expect_pass  guard-bash.sh '{"tool_input":{"command":"cp src/a.ts src/b.ts"}}'            "cp file thường đi qua"

echo "== guard-files: self-guard file điều khiển harness (audit 2026-06, P0) =="
expect_ask   guard-files.sh '{"tool_input":{"file_path":"/x/.claude/settings.json","content":"{}"}}'              "sửa settings.json -> ask"
expect_ask   guard-files.sh '{"tool_input":{"file_path":"/x/.claude/hooks/verify-before-stop.sh","content":"exit 0"}}' "sửa hook (neuter gate) -> ask"
expect_ask   guard-files.sh '{"tool_input":{"file_path":"/x/.claude/rules/admin.md","content":"x"}}'             "sửa rule -> ask"
expect_ask   guard-files.sh '{"tool_input":{"file_path":"/x/.claude/agents/oracle.md","content":"x"}}'           "sửa agent -> ask"
expect_ask   guard-files.sh '{"tool_input":{"file_path":"/x/tests/harness/guard.test.sh","content":"exit 0"}}'   "gut self-test -> ask"
expect_ask   guard-files.sh '{"tool_input":{"file_path":"/x/.github/workflows/harness.yml","content":"x"}}'      "sửa CI workflow -> ask"
expect_pass  guard-files.sh '{"tool_input":{"file_path":"/x/.claude/.cmd-history","content":"x"}}'               "file state runtime (không phải control) đi qua"

echo "== guard-files: double-slash normalize + notebook_path (audit 2026-06) =="
rm -f "$ROOT/.claude/.allow-contract-edit"
expect_block guard-files.sh '{"tool_input":{"file_path":"/x/docs//decisions.md"}}'         "docs//decisions.md (double-slash) vẫn hard-block"
expect_block guard-files.sh '{"tool_input":{"notebook_path":"/x/secrets/n.ipynb"}}'        "NotebookEdit notebook_path vào secrets/ bị chặn"

echo "== settings.json: SubagentStop wired + session-start không escaper thủ công (audit 2026-06) =="
grep -q '"SubagentStop"' "$ROOT/.claude/settings.json" \
  && ok "SubagentStop wired vào verify-before-stop (subagent không bypass green-gate)" || bad "thiếu SubagentStop wiring"
grep -Fq 'additionalContext":"%s"' "$HOOKS/session-start.sh" \
  && bad "session-start CÒN escaper sed/awk thủ công (D1-1/D1-2 — JSON vỡ khi vắng jq)" \
  || ok "session-start bỏ escaper thủ công (vắng jq -> skip orient, không phát JSON vỡ)"

# ===== Audit round 3 (2026-06-24): no-jq backstop · arm-guard · cliff · EARS · budget · repair-event =====

echo "== guard-bash: no-jq backstop chặn secret-read/protected-write FIRST-TOKEN (audit r3) =="
# Trước r3: khi vắng jq, SCAN=$INPUT (JSON thô) ⇒ verb đứng đầu dính dấu " ⇒ SECRET_VERB_RE/PROT_VERB_RE
# KHÔNG match ⇒ cat/cp/python first-token LỌT IM LẶNG. Suite 119/0 cũ KHÔNG có ca nào mask jq nên mù điểm này.
NJ="$(mktemp -d)"
for src in /usr/bin /bin /usr/local/bin /usr/sbin /sbin /opt/homebrew/bin /opt/homebrew/sbin; do
  [ -d "$src" ] || continue
  for f in "$src"/*; do b="$(basename "$f")"; [ "$b" = jq ] && continue; [ -e "$NJ/$b" ] || ln -s "$f" "$NJ/$b" 2>/dev/null; done
done
if ( PATH="$NJ"; command -v jq >/dev/null 2>&1 ) || ! ( PATH="$NJ"; command -v grep >/dev/null 2>&1 ); then
  ok "no-jq backstop (skip: không mask được jq sạch / thiếu grep trên môi trường này)"
else
  njrun() { OUT="$(printf '%s' "$2" | PATH="$NJ" CMD_HISTORY_FILE="$(mktemp)" bash "$HOOKS/$1" 2>/dev/null)"; RC=$?; }
  njrun guard-bash.sh '{"tool_input":{"command":"cat .env"}}';              [ "$RC" -eq 2 ] && ok "no-jq: cat .env (first-token) bị chặn" || bad "no-jq: cat .env LỌT (exit=$RC) — fail-open!"
  njrun guard-bash.sh '{"tool_input":{"command":"cp .env /tmp/x"}}';        [ "$RC" -eq 2 ] && ok "no-jq: cp .env exfil bị chặn" || bad "no-jq: cp .env LỌT (exit=$RC)"
  njrun guard-bash.sh '{"tool_input":{"command":"cp x docs/decisions.md"}}'; [ "$RC" -eq 2 ] && ok "no-jq: cp -> decisions.md (protected-write first-token) bị chặn" || bad "no-jq: cp->decisions LỌT (exit=$RC)"
  njrun guard-bash.sh '{"tool_input":{"command":"pnpm -s test"}}';          [ "$RC" -eq 0 ] && ok "no-jq: lệnh lành đi qua" || bad "no-jq: lệnh lành chặn nhầm (exit=$RC)"
  njrun guard-bash.sh '{"tool_input":{"command":"cat .env.example"}}';      [ "$RC" -eq 0 ] && ok "no-jq: .env.example template đi qua" || bad "no-jq: .env.example chặn nhầm (exit=$RC)"
fi
rm -rf "$NJ"

echo "== ARM-GUARD: gate phải ARM khi Phase-0 code land — no-op không sống mãi (audit r3) =="
# Bất biến harness: "gate no-op trông y hệt gate pass" (agent-harness.md). IF app-code tồn tại THEN gate
# tương ứng PHẢI armed. Pre-Phase-0: không code -> ok "tự kích sau". Code land mà gate chưa arm -> bad (CI đỏ).
if [ -d "$ROOT/packages/core" ]; then
  { [ -f "$ROOT/package.json" ] && grep -Eq '"verify"[[:space:]]*:' "$ROOT/package.json"; } \
    && ok "ARM: packages/core -> package.json có script 'verify'" \
    || bad "ARM: packages/core LAND nhưng thiếu script 'verify' (green-gate verify-before-stop chưa arm!)"
  find "$ROOT" -path '*/node_modules' -prune -o -name 'acceptance.ledger.test.*' -print 2>/dev/null | grep -q . \
    && ok "ARM: packages/core -> acceptance.ledger.test tồn tại (ép OSM-02/MNY-03)" \
    || bad "ARM: packages/core LAND nhưng thiếu acceptance.ledger.test (statusHistory/money chưa có gate cứng!)"
else
  ok "ARM: pre-Phase-0 (packages/core chưa có) — verify+ledger arm-check tự kích khi land"
fi
if find "$ROOT/services" -name '*.go' 2>/dev/null | grep -q .; then
  { [ -f "$ROOT/Makefile" ] && grep -Eq '^verify-go:' "$ROOT/Makefile"; } \
    && ok "ARM: có .go -> Makefile verify-go" || bad "ARM: .go LAND nhưng thiếu Makefile verify-go (Go gate skip im lặng!)"
else ok "ARM: chưa có .go (Makefile verify-go arm khi land)"; fi
# sqlc gate: khi sqlc.yaml land, recipe verify-go PHẢI chạy 'sqlc vet' (gác drift query↔schema).
# Chỉ grep target '^verify-go:' tồn tại là CHƯA đủ — phải soi THÂN recipe, vì "gate no-op trông y
# hệt gate pass". Trích block recipe verify-go rồi grep — nhưng STRIP dòng comment ('^[[:space:]]*#')
# trước, nếu không một verb bị comment-out ('# sqlc vet …') vẫn khớp grep unanchored → false-pass
# (cùng class lỗ '//' của relay-ARM 3b; review PR-3c-2 wf_58d3da06).
if [ -f "$ROOT/services/core-api/sqlc.yaml" ]; then
  if [ -f "$ROOT/Makefile" ] && sed -n '/^verify-go:/,/^$/p' "$ROOT/Makefile" 2>/dev/null | grep -v '^[[:space:]]*#' | grep -q 'sqlc vet'; then
    ok "ARM: có sqlc.yaml -> recipe verify-go chạy 'sqlc vet'"
  else
    bad "ARM: sqlc.yaml LAND nhưng 'sqlc vet' KHÔNG trong recipe verify-go (drift query↔schema không gác!)"
  fi
else ok "ARM: chưa có sqlc.yaml (sqlc vet arm khi query land)"; fi
# oapi-codegen gate (PR-3c-2): khi openapi.yaml + api/*.gen.go land, recipe verify-go PHẢI vừa
# regenerate (`go generate ./internal/api/...`) VỪA enforce drift (`git diff --exit-code -- …api.gen.go`).
# Thiếu vế diff → regen câm (false-pass); thiếu vế generate → diff luôn sạch (false-pass). Cùng lý do
# sqlc: soi THÂN recipe, không chỉ target tồn tại (§6 D8, ADR-031 contract↔gen không được drift).
# STRIP dòng comment ('^[[:space:]]*#') khỏi recipe trước khi grep → verb bị comment-out không false-pass.
if [ -f "$ROOT/services/core-api/openapi.yaml" ] && ls "$ROOT"/services/core-api/internal/api/*.gen.go >/dev/null 2>&1; then
  VGRECIPE="$(sed -n '/^verify-go:/,/^$/p' "$ROOT/Makefile" 2>/dev/null | grep -v '^[[:space:]]*#')"
  if printf '%s' "$VGRECIPE" | grep -Eq 'go generate .*internal/api' \
     && printf '%s' "$VGRECIPE" | grep -Eq 'git diff --exit-code.*internal/api'; then
    ok "ARM: có openapi.yaml + api/*.gen.go -> recipe verify-go regenerate + git-diff stale-check oapi-codegen"
  else
    bad "ARM: openapi.yaml + api/*.gen.go LAND nhưng stale-check oapi-codegen KHÔNG đủ trong recipe verify-go (drift contract↔gen không gác!)"
  fi
else ok "ARM: chưa có openapi.yaml+api/*.gen.go (oapi stale-check arm khi codegen land)"; fi
# testcontainers real-check (mirror osm real-check): test integration PHẢI boot container thật,
# không phải skip-always stub. Pre-PR-2b: chưa có test nào -> ok "arm khi land".
TCFILES="$(grep -rl 'testcontainers' "$ROOT/services" --include='*_test.go' 2>/dev/null || true)"
if [ -n "$TCFILES" ]; then
  if grep -lq -E 'postgres\.Run|GenericContainer|ContainerRequest|RunContainer' $TCFILES 2>/dev/null; then
    ok "ARM: testcontainers test boot container thật (không skip-always)"
  else
    bad "ARM: testcontainers test KHÔNG boot container (skip-always stub — data gate no-op!)"
  fi
else ok "ARM: chưa có testcontainers test (real-check arm khi land — PR-2b)"; fi
# NATS relay substrate (PR-3a): khi internal/natsx land, /readyz PHẢI gác NATS (Reachable) + topology
# PHẢI tồn tại — chặn một edit tương lai âm thầm gỡ NATS khỏi readiness hoặc bỏ EnsureTopology.
NATSDIR="$ROOT/services/core-api/internal/natsx"
if [ -d "$NATSDIR" ]; then
  ROUTERGO="$ROOT/services/core-api/internal/httpapi/router.go"
  if grep -q 'nats\.Reachable' "$ROUTERGO" 2>/dev/null && grep -rq 'func.*EnsureTopology' "$NATSDIR" 2>/dev/null; then
    ok "ARM: có internal/natsx -> /readyz gác NATS (nats.Reachable) + EnsureTopology tồn tại"
  else
    bad "ARM: internal/natsx LAND nhưng /readyz KHÔNG gác NATS hoặc thiếu EnsureTopology (NATS readiness/topology no-op!)"
  fi
else ok "ARM: chưa có internal/natsx (NATS readiness/topology arm khi land — PR-3a)"; fi
# Relay drain loop (PR-3b): khi internal/relay land, BẤT BIẾN ADR-029 phải được KHOÁ —
# (1) SelectPendingOutbox quét TẬP pending 'ORDER BY seq', KHÔNG watermark 'seq>cursor', KHÔNG
# 'SKIP LOCKED' (bigserial seq gán lúc INSERT → tx seq-thấp có thể commit-muộn → watermark bỏ
# sót vĩnh viễn = mất event tiền câm, hazard lớn nhất); (2) main.go THỰC SỰ start relay
# (relay.New + .Run) — relay bị gỡ khỏi lifecycle = event không bao giờ publish (no-op câm).
RELAYDIR="$ROOT/services/core-api/internal/relay"
if [ -d "$RELAYDIR" ]; then
  OUTBOXSQL="$ROOT/services/core-api/db/queries/outbox.sql"
  MAINGO="$ROOT/services/core-api/cmd/core-api/main.go"
  # Bỏ dòng comment SQL ('-- ...') trước khi soi: prose trong outbox.sql CỐ Ý nhắc 'seq >' /
  # 'SKIP LOCKED' để giải thích vì sao chúng bị cấm — chỉ check SQL thực thi, không check prose.
  SQLBODY="$(grep -vE '^[[:space:]]*--' "$OUTBOXSQL" 2>/dev/null)"
  if printf '%s' "$SQLBODY" | grep -q 'ORDER BY seq' \
     && ! printf '%s' "$SQLBODY" | grep -qiE 'SKIP[[:space:]]+LOCKED' \
     && ! printf '%s' "$SQLBODY" | grep -qE 'seq[[:space:]]*>'; then
    ok "ARM: relay -> outbox quét pending-SET 'ORDER BY seq' (không watermark seq>/SKIP LOCKED — ADR-029 chống mất event tiền câm)"
  else
    bad "ARM: relay LAND nhưng outbox.sql vi phạm scan-pending-SET (watermark seq> hoặc SKIP LOCKED -> mất event tiền câm!)"
  fi
  # Bỏ dòng comment Go ('// ...') trước khi soi — một relay.New(...).Run(...) bị COMMENT-OUT
  # (cách "gỡ" relay phổ biến nhất lúc sự cố) KHÔNG được lọt gate (đối xứng với SQL-check ở trên).
  # Match '.Run(' BẤT KỲ ctx nào (không khoá tên biến 'relayCtx' → rename lành tính không false-RED).
  MAINBODY="$(grep -vE '^[[:space:]]*//' "$MAINGO" 2>/dev/null)"
  if printf '%s' "$MAINBODY" | grep -q 'relay\.New' && printf '%s' "$MAINBODY" | grep -qE '\.Run\('; then
    ok "ARM: relay -> main.go start relay.New(...).Run( (publish-on-commit sống trong lifecycle, code thực thi)"
  else
    bad "ARM: internal/relay LAND nhưng main.go KHÔNG start relay (relay.New + .Run trong code thực thi) — event không bao giờ publish!"
  fi
else ok "ARM: chưa có internal/relay (relay scan-rule/start arm khi land — PR-3b)"; fi
# OpenAPI contract (PR-3c-1): khi openapi.yaml land, test parity 4-CHIỀU phải tồn tại VÀ thực sự soi
# cả 4 nguồn enum (openapi + internal/order + packages/core Zod + PG enum 000001) — chặn một edit
# tương lai âm thầm rút parity xuống <4 nguồn (cho phép contract trôi khỏi Go/TS/PG mà gate vẫn xanh,
# ADR-031). Bỏ dòng comment Go ('// ...') trước khi soi để một tham chiếu bị COMMENT-OUT không false-PASS.
OPENAPI="$ROOT/services/core-api/openapi.yaml"
PARITY="$ROOT/services/core-api/internal/contract/parity_test.go"
if [ -f "$OPENAPI" ]; then
  # Soi BODY thực thi (bỏ comment), KHÔNG chỉ token-presence: cần (a) cả 4 nguồn enum, (b) >=4 hàm
  # Test*Parity, (c) comparator assertSame chạy thật, (d) Go bind vào `order.Statuses` (slice canonical,
  # không phải chỉ import) — chặn một parity_test bị rút ruột thành const chết / Fatalf prose mà vẫn PASS.
  PARITYBODY="$(grep -vE '^[[:space:]]*//' "$PARITY" 2>/dev/null)"
  nparity="$(printf '%s' "$PARITYBODY" | grep -cE 'func Test[A-Za-z]*Parity')"
  if [ -f "$PARITY" ] \
     && printf '%s' "$PARITYBODY" | grep -q 'openapi.yaml' \
     && printf '%s' "$PARITYBODY" | grep -q 'order\.Statuses' \
     && printf '%s' "$PARITYBODY" | grep -q 'packages/core' \
     && printf '%s' "$PARITYBODY" | grep -q '000001_enums' \
     && printf '%s' "$PARITYBODY" | grep -q 'assertSame' \
     && [ "$nparity" -ge 4 ]; then
    ok "ARM: có openapi.yaml -> parity_test soi 4 nguồn enum + chạy thật (>=4 Test*Parity + assertSame + order.Statuses — ADR-031 chống contract trôi câm)"
  else
    bad "ARM: openapi.yaml LAND nhưng parity_test thiếu/yếu (cần 4 nguồn enum + >=4 Test*Parity + assertSame thực thi — contract có thể trôi khỏi Go/TS/PG mà gate vẫn xanh!)"
  fi
else ok "ARM: chưa có openapi.yaml (parity 4-chiều arm khi contract land — PR-3c-1)"; fi
if find "$ROOT/services" -name '*.rs' 2>/dev/null | grep -q .; then
  { [ -f "$ROOT/Makefile" ] && grep -Eq '^verify-rs:' "$ROOT/Makefile"; } \
    && ok "ARM: có .rs -> Makefile verify-rs" || bad "ARM: .rs LAND nhưng thiếu Makefile verify-rs"
else ok "ARM: chưa có .rs (Makefile verify-rs arm khi land)"; fi
if find "$ROOT/apps" -name '*.tsx' 2>/dev/null | grep -q .; then
  ecfg="$(find "$ROOT" -path '*/node_modules' -prune -o \( -name 'eslint.config.*' -o -name '.eslintrc*' \) -print 2>/dev/null | head -1)"
  { [ -n "$ecfg" ] && grep -Eq 'NumberFormat|toLocaleString|no-restricted-(syntax|imports|properties)' "$ecfg"; } \
    && ok "ARM: có .tsx -> ESLint cấm Intl ngoài core (MNY-03/i18n)" \
    || bad "ARM: .tsx LAND nhưng ESLint chưa cấm Intl.NumberFormat/toLocaleString ngoài core (MNY-03!)"
else ok "ARM: chưa có apps/*.tsx (ESLint Intl-ban arm khi land)"; fi

echo "== REC-38: cliff head -c 3000 — 4 luật + skill-index sống sót khi active-context PHÌNH (audit r3) =="
rm -f "$ROOT/.claude/.precompact-state"
ACBAK=""; if [ -f "$ROOT/docs/active-context.md" ]; then ACBAK="$(mktemp)"; cp "$ROOT/docs/active-context.md" "$ACBAK"; fi
mkdir -p "$ROOT/docs"
{ for i in $(seq 1 60); do printf 'Dòng độn dài để phình orient vượt ngưỡng head -c 3000 — %02d ------------------------------\n' "$i"; done; } > "$ROOT/docs/active-context.md"
OUTCLIFF="$(printf '%s' '{"hook_event_name":"SessionStart","source":"startup"}' | bash "$HOOKS/session-start.sh" 2>/dev/null)"
nbytes="$(printf '%s' "$OUTCLIFF" | wc -c | tr -d ' ')"
printf '%s' "$OUTCLIFF" | grep -q 'always-must' && ok "REC-38: 4 luật sống sót cap khi active-context phình (orient ~${nbytes}B)" || bad "REC-38: 4 luật BỊ CẮT khi orient phình — cliff!"
printf '%s' "$OUTCLIFF" | grep -q 'vn-compliance' && ok "REC-38: skill-index sống sót cap (đặt trước block lớn)" || bad "REC-38: skill-index bị cắt khi phình"
if [ -n "$ACBAK" ]; then mv "$ACBAK" "$ROOT/docs/active-context.md"; else rm -f "$ROOT/docs/active-context.md"; fi
rm -f "$ROOT/.claude/.precompact-state"

echo "== REC-18: acceptance.md theo EARS + mỗi tiêu chí gắn test id (audit r3) =="
ACC="$ROOT/docs/acceptance.md"
if [ -f "$ACC" ]; then
  nid="$(grep -Ec '^- \[[ x]\] `[A-Z]+-[0-9]+`' "$ACC")"
  nref="$(grep -Ec '\(test:' "$ACC")"
  ears_bad=0
  while IFS= read -r line; do
    printf '%s' "$line" | grep -Eq 'WHEN|WHILE|\bIF\b' || ears_bad=$((ears_bad+1))
    printf '%s' "$line" | grep -q 'shall'              || ears_bad=$((ears_bad+1))
  done < <(grep -E '^- \[[ x]\] `[A-Z]+-[0-9]+`' "$ACC")
  { [ "${nid:-0}" -gt 0 ] && [ "$ears_bad" -eq 0 ] && [ "${nref:-0}" -ge "${nid:-0}" ]; } \
    && ok "REC-18: ${nid} tiêu chí theo EARS (WHEN/shall) + đều có test ref (${nref})" \
    || bad "REC-18: acceptance.md lệch EARS (ids=${nid} ears_bad=${ears_bad} refs=${nref})"
else
  ok "REC-18: acceptance.md chưa có (skip)"
fi

echo "== REC-33: ngân sách lệnh-Bash advisory (non-blocking) (audit r3) =="
if command -v jq >/dev/null 2>&1; then
  TCB="$(mktemp)"; CHB="$(mktemp)"
  printf '149' > "$TCB"
  OUT="$(printf '%s' '{"tool_input":{"command":"echo hi"}}' | env TURN_COUNT_FILE="$TCB" CMD_HISTORY_FILE="$CHB" bash "$HOOKS/guard-bash.sh" 2>/dev/null)"; RC=$?
  { [ "$RC" -eq 0 ] && printf '%s' "$OUT" | grep -q 'lệnh Bash trong phiên'; } \
    && ok "REC-33: ngưỡng 150 phát advisory + KHÔNG chặn (exit 0)" || bad "REC-33: ngưỡng sai (exit=$RC)"
  printf '10' > "$TCB"
  OUT="$(printf '%s' '{"tool_input":{"command":"echo hi"}}' | env TURN_COUNT_FILE="$TCB" CMD_HISTORY_FILE="$CHB" bash "$HOOKS/guard-bash.sh" 2>/dev/null)"; RC=$?
  { [ "$RC" -eq 0 ] && [ -z "$OUT" ]; } && ok "REC-33: dưới ngưỡng im lặng (exit 0, no stdout)" || bad "REC-33: dưới ngưỡng không im (rc=$RC)"
  rm -f "$TCB" "$CHB"
else ok "REC-33 budget (skip: vắng jq)"; fi

echo "== REC-34: repair-event — verify-before-stop ghi + session-start surface one-shot (audit r3) =="
rm -f "$ROOT/.claude/.precompact-state"
printf 'SENTINEL-REPAIR-EVENT-R3\n' > "$ROOT/.claude/.repair-event"
OUTRE="$(printf '%s' '{"hook_event_name":"SessionStart","source":"startup"}' | bash "$HOOKS/session-start.sh" 2>/dev/null)"
printf '%s' "$OUTRE" | grep -q 'SENTINEL-REPAIR-EVENT-R3' && ok "REC-34: session-start surface .repair-event" || bad "REC-34: session-start KHÔNG surface .repair-event"
[ -f "$ROOT/.claude/.repair-event" ] && { bad "REC-34: .repair-event KHÔNG bị xoá (one-shot)"; rm -f "$ROOT/.claude/.repair-event"; } || ok "REC-34: .repair-event bị xoá sau surface (one-shot)"
if command -v make >/dev/null 2>&1 && command -v git >/dev/null 2>&1; then
  WTMP="$(mktemp -d)"; ( cd "$WTMP" && git init -q && git config user.email t@t && git config user.name t )
  printf 'verify-go:\n\t@echo BOOM-VERIFY; exit 1\n' > "$WTMP/Makefile"; printf 'package main\n' > "$WTMP/x.go"
  WATT="$(mktemp)"; rm -f "$WATT"; mkdir -p "$WTMP/.claude"; WREV="$WTMP/.claude/.repair-event"
  for _ in 1 2 3 4; do printf '{}' | env CLAUDE_PROJECT_DIR="$WTMP" VERIFY_ATTEMPTS_FILE="$WATT" REPAIR_EVENT_FILE="$WREV" bash "$HOOKS/verify-before-stop.sh" >/dev/null 2>&1; done
  { [ -f "$WREV" ] && grep -q 'verify-go' "$WREV"; } && ok "REC-34: nhánh 4×-fail ghi .repair-event (target+output)" || bad "REC-34: .repair-event KHÔNG được ghi ở 4×-fail"
  rm -rf "$WTMP" "$WATT"
else ok "REC-34 repair-event write (skip: vắng make/git)"; fi

rm -f "$TURN_COUNT_FILE" 2>/dev/null   # dọn counter cô lập (audit-r3)

echo
printf 'Kết quả: \033[32m%d pass\033[0m / \033[31m%d fail\033[0m\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
