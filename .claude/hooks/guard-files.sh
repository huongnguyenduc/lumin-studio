#!/usr/bin/env bash
# PreToolUse(Edit|Write) guard.
#  - Secrets: chặn cứng (exit 2).
#  - Test bị làm yếu (REC-05): ask (thêm .skip/t.Skip/xit/xdescribe, hoặc Write giảm assertion so với git HEAD).
#  - File hợp đồng LÕI decisions/conventions (REC-03 / ADR-022): hard-block (exit 2) TRỪ khi có .claude/.allow-contract-edit.
#  - File hợp đồng khác (tokens/*.css, CLAUDE.md, AGENTS.md): ask.
INPUT="$(cat)"
ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
HAVE_JQ=0; command -v jq >/dev/null 2>&1 && HAVE_JQ=1
jget() { [ "$HAVE_JQ" -eq 1 ] && printf '%s' "$INPUT" | jq -r "$1 // empty" 2>/dev/null; }

if [ "$HAVE_JQ" -eq 1 ]; then
  FILE="$(jget '.tool_input.file_path')"; [ -z "$FILE" ] && FILE="$(jget '.tool_input.path')"
else
  FILE="$(printf '%s' "$INPUT" | grep -oE '"(file_path|path)"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed -E 's/.*:[[:space:]]*"([^"]*)"/\1/')"
fi
[ -z "$FILE" ] && exit 0

# JSON-escape một chuỗi tuỳ ý -> string literal JSON hợp lệ (audit 2026-06-23: trước đây ask()
# nội suy thô $FILE/$lit/$tf chứa " hoặc \ -> JSON vỡ -> Claude Code không parse được decision ->
# guard FAIL-OPEN đúng lúc path có ký tự lạ. Cùng cách session-start.sh đã escape).
jesc() {
  if [ "$HAVE_JQ" -eq 1 ]; then printf '%s' "$1" | jq -Rs .
  else printf '"%s"' "$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g')"; fi
}
ask() { # $1 = lý do
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":%s}}\n' "$(jesc "$1")"
  exit 0
}

# 1) Secrets -> chặn cứng (nhưng .env.example là template ĐƯỢC commit — xem .gitignore !.env.example)
case "$FILE" in
  *.env.example) : ;;   # template không chứa bí mật -> cho sửa
  *.env|*.env.*|*/secrets/*|*.age|*.pem|*id_rsa*|*.tfstate|*.sops.*|*.dec.*)
    echo "⛔ Không sửa file bí mật qua Claude: $FILE (dùng SOPS+age; sửa tay ngoài Claude)." >&2
    exit 2 ;;
esac

# 2) Anti-reward-hacking (REC-05): test bị làm yếu -> ask
case "$FILE" in
  *_test.go|*.test.ts|*.test.tsx|*.spec.ts|*.spec.tsx|*.test.js|*.spec.js|*/e2e/*.ts|*/e2e/*.tsx)
    if [ "$HAVE_JQ" -eq 1 ]; then
      added="$(jget '.tool_input.content')"; [ -z "$added" ] && added="$(jget '.tool_input.new_string')"
      removed="$(jget '.tool_input.old_string')"
    else
      added="$INPUT"; removed=""   # fallback thô: grep cả input (có thể ask nhầm khi gỡ skip — vẫn an toàn)
    fi
    skip_re='\.skip\b|\bt\.Skip\(|\bxit\(|\bxdescribe\(|it\.skip|describe\.skip|test\.skip|t\.SkipNow\('
    if printf '%s' "$added" | grep -Eq "$skip_re" && ! printf '%s' "$removed" | grep -Eq "$skip_re"; then
      ask "Thay đổi THÊM skip (.skip / t.Skip / xit / xdescribe) vào file test $FILE — có thể làm yếu suite để qua green-gate. Nếu cố ý (cô lập test flaky), ghi lý do vào PLAN.md rồi xác nhận."
    fi
    # Write toàn file: ask nếu số assertion/test-case ÍT hơn bản trong git HEAD
    if [ "$HAVE_JQ" -eq 1 ] && [ -n "$(jget '.tool_input.content')" ]; then
      rel="${FILE#"$ROOT"/}"
      if base="$(git -C "$ROOT" show "HEAD:$rel" 2>/dev/null)" && [ -n "$base" ]; then
        cnt() { printf '%s' "$1" | grep -Eo 'expect\(|assert[._]|\bt\.Run\(|\bit\(|\btest\(|func Test' | wc -l | tr -d ' '; }
        old_n="$(cnt "$base")"; new_n="$(cnt "$added")"
        if [ "${new_n:-0}" -lt "${old_n:-0}" ]; then
          ask "File test $FILE sau khi ghi có ÍT assertion/test-case hơn bản trong git ($new_n < $old_n) — có thể làm yếu suite. Nếu là refactor hợp lệ (di chuyển test), xác nhận để tiếp tục."
        fi
      fi
    fi ;;
esac

# 2.5) Anti-overfit / special-casing (REC-16 / ADR-024): file SOURCE hardcode literal "output đã-tính"
#      trùng y nguyên với fixture/expected của test đang sửa -> ask. Bắt cheat ngược của REC-05:
#      làm test đỏ->xanh bằng special-case implementation (vd `if total == 390000 return '390.000₫'`)
#      thay vì cài logic thật — test vẫn xanh, assertion-count không đổi (REC-05 câm với ca này).
#      Tier ASK (như REC-05), KHÔNG hard-block. EXEMPT packages/core/** (formatter tiền + i18n catalog +
#      literal transition-table sống ở đây hợp lệ — ADR-019/020). Cần jq + git; thiếu -> no-op.
case "$FILE" in
  *.test.*|*.spec.*|*_test.go|*/e2e/*) : ;;                 # test files: đã xử ở (2) -> bỏ qua
  *.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs|*.go|*.rs)               # chỉ SOURCE code (docs/css/json bỏ qua)
    rel="${FILE#"$ROOT"/}"
    case "$rel" in
      packages/core/*|*/packages/core/*) : ;;                # core: exempt (money/i18n/OSM literal hợp lệ)
      *)
        if [ "$HAVE_JQ" -eq 1 ] && command -v git >/dev/null 2>&1; then
          added="$(jget '.tool_input.content')"; [ -z "$added" ] && added="$(jget '.tool_input.new_string')"
          if [ -n "$added" ]; then
            # Trích literal "output đã-tính" trong nội dung THÊM: chuỗi chứa ₫ · số nhóm-nghìn (390.000) ·
            # số nguyên ≥5 chữ số. Lọc này nhắm money/formatted-output (giá trị shop hay bị special-case),
            # BỎ QUA enum/i18n-key/field-name (không chứa ₫/số) -> ít báo nhầm.
            lits="$( { printf '%s' "$added" | grep -oE '"[^"]*₫[^"]*"' ;
                       printf '%s' "$added" | grep -oE "'[^']*₫[^']*'" ;
                       printf '%s' "$added" | grep -oE '[0-9]+([.,][0-9]{3})+' ;
                       printf '%s' "$added" | grep -oE '[0-9]{5,}' ; } 2>/dev/null \
                     | sed -E "s/^[\"']//; s/[\"']\$//" | sort -u )"
            if [ -n "$lits" ]; then
              # Đối chiếu CHỈ test đang sửa trong working tree (touched) — không quét cả cây.
              tests="$(git -C "$ROOT" status --porcelain -uall 2>/dev/null | awk '{print $NF}' \
                       | grep -E '(_test\.go|\.test\.(ts|tsx|js)|\.spec\.(ts|tsx|js)|/e2e/)' || true)"
              # Van self-test: trỏ vào một thư mục test fixture cố định.
              if [ -n "${GUARD_SPECIALCASE_TESTROOT:-}" ]; then
                # Dùng CÙNG predicate với nhánh production (line ~85) để self-test exercise đúng logic chọn.
                tests="$(find "$GUARD_SPECIALCASE_TESTROOT" -type f 2>/dev/null | grep -E '(_test\.go|\.test\.(ts|tsx|js)|\.spec\.(ts|tsx|js)|/e2e/)')"
              fi
              if [ -n "$tests" ]; then
                while IFS= read -r lit; do
                  [ -z "$lit" ] && continue
                  for tf in $tests; do
                    [ -f "$ROOT/$tf" ] && path="$ROOT/$tf" || path="$tf"
                    if grep -Fq -- "$lit" "$path" 2>/dev/null; then
                      ask "File SOURCE $FILE thêm literal '$lit' TRÙNG y nguyên với fixture/expected trong test đang sửa ($tf) — dấu hiệu special-casing (hardcode output để qua test thay vì cài logic thật; REC-16/ImpossibleBench). Nếu là hằng số hợp lệ ngoài core, xác nhận để tiếp tục."
                    fi
                  done
                done <<EOF
$lits
EOF
              fi
            fi
          fi
        fi ;;
    esac ;;
esac

# 3) File hợp đồng LÕI (REC-03 / ADR-022) -> hard-block trừ khi có van xả
case "$FILE" in
  */docs/decisions.md|docs/decisions.md|*/docs/conventions.md|docs/conventions.md)
    if [ -f "$ROOT/.claude/.allow-contract-edit" ]; then
      ask "Hợp đồng LÕI ($FILE) — van xả .allow-contract-edit đang BẬT. Chỉ THÊM ADR mới / đánh dấu Superseded, đừng relitigate. Xác nhận, rồi nhớ xoá van xả khi xong."
    fi
    echo "⛔ $FILE là HỢP ĐỒNG LÕI (ADR-022) — sửa bị chặn để tránh đổi luật binding ngoài ý muốn." >&2
    echo "Đường amend: touch .claude/.allow-contract-edit -> sửa (chỉ thêm ADR/Superseded) -> rm .claude/.allow-contract-edit." >&2
    exit 2 ;;
  */tokens/*.css|*/CLAUDE.md|CLAUDE.md|*/AGENTS.md|AGENTS.md)
    ask "File hợp đồng (tokens/CLAUDE.md/AGENTS.md) — sửa cần chủ đích. Xác nhận để tiếp tục." ;;
esac
exit 0
