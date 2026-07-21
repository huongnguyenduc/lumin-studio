#!/usr/bin/env bash
# Stop hook — cổng "done": chặn kết thúc tới khi typecheck/lint/test xanh
# với những ngôn ngữ có file vừa đổi. Tự no-op khi chưa có tool/script (an toàn trước Phase 0).
# Exit 2 + stderr -> Claude tiếp tục sửa. Exit 0 -> cho dừng.
# REC-06: retry budget — sau 4 lần fail cùng target thì surface cho người thay vì loop vô hạn.
# REC-02: nhắc cập nhật docs/active-context.md (non-blocking) khi đổi nhiều file source.
INPUT="$(cat)"
# Node/pnpm live under ~/.local on this WSL box and aren't on the hook's default
# (system-only) PATH — without this the TS/JS verify below silently no-ops
# (command -v pnpm fails), letting "done" through unverified. Prepend the known
# dirs; harmless where they're already on PATH.
if ! command -v pnpm >/dev/null 2>&1; then
  for d in "$HOME/.local/node20/bin" "$HOME/.local/bin"; do
    [ -x "$d/pnpm" ] && PATH="$d:$PATH"
  done
  export PATH
fi
ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
cd "$ROOT" 2>/dev/null || exit 0
ATT="${VERIFY_ATTEMPTS_FILE:-$ROOT/.claude/.verify-attempts}"

# Chống loop: nếu đang trong vòng do chính Stop hook kích thì thoát.
printf '%s' "$INPUT" | grep -Eq '"stop_hook_active"[[:space:]]*:[[:space:]]*true' && exit 0
# Van xả thủ công
[ -f "$ROOT/.claude/.skip-verify" ] && exit 0
# Cần git để biết có đổi gì không
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

changed="$(git status --porcelain -uall 2>/dev/null | sed -E 's/^...//')"
[ -z "$changed" ] && exit 0

has_ext() { printf '%s\n' "$changed" | grep -Eq "\.($1)([\"]?)$"; }
have_npm_script() { [ -f package.json ] && grep -Eq "\"$1\"[[:space:]]*:" package.json; }
have_make_target() { [ -f Makefile ] && grep -Eq "^$1:" Makefile; }

# REC-06: ghi nhận fail theo target; sau 4 lần liên tiếp cùng target -> cho dừng + cảnh báo (không loop, không "done" ngầm).
record_fail_and_decide() { # $1=tên target  $2=output
  local t="$1" out="$2" prev cnt=1
  prev="$(cat "$ATT" 2>/dev/null)"
  if [ -n "$prev" ] && [ "${prev%% *}" = "$t" ]; then cnt=$(( ${prev##* } + 1 )); fi
  printf '%s %s' "$t" "$cnt" > "$ATT" 2>/dev/null
  if [ "$cnt" -ge 4 ]; then
    rm -f "$ATT" 2>/dev/null
    # REC-34 (audit r3): ghi repair-event artifact cho phiên fresh-context kế — mirror .precompact-state
    # (session-start surface verbatim rồi xoá one-shot). Non-binding scratch; KHÔNG đổi exit code. gitignored.
    REV="${REPAIR_EVENT_FILE:-$ROOT/.claude/.repair-event}"
    mkdir -p "$(dirname "$REV")" 2>/dev/null
    { echo "🛠️ repair-event (verify-before-stop · REC-34) — target '$t' FAIL ${cnt}× liên tiếp, KHÔNG xanh:"
      echo "• Nhánh/commit: $(git branch --show-current 2>/dev/null) / $(git log -1 --pretty='%h %s' 2>/dev/null)"
      echo "• Gợi ý: mở phiên mới (/clear) đọc file này; nếu là môi trường (vd test GPU GTX 1060) thì tạo .claude/.skip-verify."
      echo "• Output cuối (tail 30):"
      printf '%s\n' "$out" | tail -n 30 | sed 's/^/    /'
    } > "$REV" 2>/dev/null
    printf '{"hookSpecificOutput":{"hookEventName":"Stop","additionalContext":"⚠️ verify %s FAIL %s lần liên tiếp — KHÔNG xanh. Đã ghi .claude/.repair-event cho phiên sau. Có thể do môi trường (vd test GPU trên GTX 1060); nếu vậy tạo .claude/.skip-verify. ĐỪNG coi là done."}}\n' "$t" "$cnt"
    exit 0
  fi
  echo "⛔ $t CHƯA xanh (lần $cnt/4) — chưa thể coi là xong. Sửa rồi mới dừng:" >&2
  printf '%s\n' "$out" | tail -n 50 >&2
  exit 2
}
fail() { record_fail_and_decide "$1" "$2"; }
run() { # $1=tên  $2=lệnh -> chặn nếu fail
  out="$(bash -c "$2" 2>&1)" || fail "$1" "$out"
}

# TS/JS
if has_ext 'ts|tsx|js|jsx|mjs|cjs' && command -v pnpm >/dev/null 2>&1 && [ -d node_modules ]; then
  have_npm_script typecheck && run "typecheck" "pnpm -s typecheck"
  have_npm_script lint      && run "lint"      "pnpm -s lint"
  have_npm_script test      && run "test"      "pnpm -s test"
fi

# Go
if has_ext 'go' && command -v make >/dev/null 2>&1 && have_make_target 'verify-go'; then
  run "verify-go" "make verify-go"
fi

# Rust
if has_ext 'rs' && command -v make >/dev/null 2>&1 && have_make_target 'verify-rs'; then
  run "verify-rs" "make verify-rs"
fi

# Tới đây = mọi target đã xanh (hoặc không có gì để chạy). Reset counter.
rm -f "$ATT" 2>/dev/null

# Advisory nudges (NON-BLOCKING) — gộp thành MỘT additionalContext (một JSON object, tránh vỡ parser).
msg=""
# REC-02: nhắc cập nhật docs/active-context.md nếu đổi >1 file source mà chưa đụng nó.
srcs="$(printf '%s\n' "$changed" | grep -Ec '\.(ts|tsx|js|jsx|mjs|cjs|go|rs)$')"
if [ "${srcs:-0}" -gt 1 ] && ! printf '%s\n' "$changed" | grep -q 'docs/active-context\.md'; then
  msg="${msg}📝 Đã đổi ${srcs} file source nhưng chưa cập nhật docs/active-context.md (focus + bước kế + lần verify xanh). "
fi
# ADR-027: risk-tag banner — diff chạm path tiền/state/auth/STK/migration/outbox → nhắc review TỪNG DÒNG
# (human-attention router, KHÔNG auto-approve, KHÔNG chặn). Self-no-op trước Phase-0 (path chưa tồn tại).
RISK_RE='packages/core/|migrations?/|order|status|payment|refund|reconcile|money|price|total|auth|rbac|bank|outbox|state-?machine'
risk="$(printf '%s\n' "$changed" | grep -Eio "$RISK_RE" | tr 'A-Z' 'a-z' | sort -u | tr '\n' ',' | sed 's/,$//')"
if [ -n "$risk" ]; then
  msg="${msg}⚠️ Diff chạm path RỦI-RO-CAO (${risk}) — review TỪNG DÒNG trước merge (tiền/state/auth là sự-cố-tiền-thật). Banner advisory, owner luôn là người merge. "
fi
# ADR-027: diff-size — PR quá to khó review (1 người) → gợi ý tách 1-PR-1-trục (advisory).
nfiles="$(printf '%s\n' "$changed" | grep -c .)"
nlines="$(git diff --numstat 2>/dev/null | awk '{a+=($1=="-"?0:$1)+($2=="-"?0:$2)} END{print a+0}')"
if [ "${nfiles:-0}" -gt 15 ] || [ "${nlines:-0}" -gt 600 ]; then
  msg="${msg}📏 Diff lớn (~${nfiles} file / ~${nlines} dòng) — cân nhắc tách 1-PR-1-trục (conventions §Scope). "
fi
if [ -n "$msg" ]; then
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$msg" | jq -Rs '{hookSpecificOutput:{hookEventName:"Stop",additionalContext:.}}'
  else
    printf '{"hookSpecificOutput":{"hookEventName":"Stop","additionalContext":"%s"}}\n' "$msg"
  fi
fi
exit 0
