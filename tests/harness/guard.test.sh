#!/usr/bin/env bash
# Harness self-test (REC-09 / ADR-023) — feed fixture vào các hook và assert cổng chặn FIRE.
# Chạy ĐƯỢC pre-Phase-0 (không phụ thuộc app toolchain pnpm/golangci-lint). Wire vào CI khi .claude/** đổi.
# Mục tiêu: gate "no-op âm thầm" sẽ FAIL ở đây thay vì trông như pass.
set -u
ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
HOOKS="$ROOT/.claude/hooks"
pass=0; fail=0
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

echo
printf 'Kết quả: \033[32m%d pass\033[0m / \033[31m%d fail\033[0m\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
