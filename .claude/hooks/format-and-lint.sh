#!/usr/bin/env bash
# PostToolUse(Edit|Write) — format + lint file vừa đổi (nhanh, theo từng file).
# Tự no-op khi tool chưa cài (an toàn trước Phase 0). Exit 2 = đẩy lỗi lint cho Claude tự sửa.
INPUT="$(cat)"
ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"

if command -v jq >/dev/null 2>&1; then
  FILE="$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // .tool_input.path // empty' 2>/dev/null)"
else
  FILE="$(printf '%s' "$INPUT" | grep -oE '"(file_path|path)"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed -E 's/.*:[[:space:]]*"([^"]*)"/\1/')"
fi
[ -z "$FILE" ] && exit 0
[ -f "$FILE" ] || exit 0

bin() { [ -x "$ROOT/node_modules/.bin/$1" ]; }
problems=""
ext="${FILE##*.}"

# REC-08: parse-gate nhanh TRƯỚC format/lint nặng — fail sớm trên buffer vỡ cú pháp.
# Chỉ Go: `gofmt -e` báo lỗi parse (exit !=0) nhưng KHÔNG kêu khi chỉ chưa-format.
# (TS/JS: ESLint vốn bắt parse error ở dưới. Rust: rustfmt --check lẫn lộn style nên bỏ.)
if [ "$ext" = "go" ] && command -v gofmt >/dev/null 2>&1; then
  if perr="$(gofmt -e "$FILE" 2>&1 >/dev/null)"; [ -n "$perr" ]; then
    echo "⛔ Go parse lỗi ở $FILE — sửa cú pháp rồi gửi lại (bỏ qua format/lint cho tới khi parse được):" >&2
    printf '%s\n' "$perr" | tail -n 20 >&2
    exit 2
  fi
fi

# Format (im lặng)
case "$ext" in
  ts|tsx|js|jsx|mjs|cjs|json|css|md|mdx|yml|yaml)
    bin prettier && ( cd "$ROOT" && node_modules/.bin/prettier --write "$FILE" ) >/dev/null 2>&1 ;;
esac
case "$ext" in
  go) command -v gofumpt >/dev/null 2>&1 && gofumpt -w "$FILE" >/dev/null 2>&1 \
        || { command -v gofmt >/dev/null 2>&1 && gofmt -w "$FILE" >/dev/null 2>&1; } ;;
  rs) command -v rustfmt >/dev/null 2>&1 && rustfmt "$FILE" >/dev/null 2>&1 ;;
esac

# Lint per-file (chỉ TS/JS — nhanh với --cache; Go golangci-lint & Rust clippy ở cấp crate -> để Stop hook)
case "$ext" in
  ts|tsx|js|jsx|mjs|cjs)
    if bin eslint; then
      problems="$( ( cd "$ROOT" && node_modules/.bin/eslint --fix --cache --max-warnings=0 "$FILE" ) 2>&1 )" || true
      # eslint exit !=0 -> còn lỗi; nếu out rỗng nghĩa là pass
      ( cd "$ROOT" && node_modules/.bin/eslint --cache --max-warnings=0 "$FILE" ) >/dev/null 2>&1 && problems=""
    fi ;;
esac

if [ -n "$problems" ]; then
  echo "⚠️ Lint còn lỗi ở $FILE — sửa trước khi đi tiếp:" >&2
  printf '%s\n' "$problems" | tail -n 40 >&2
  exit 2
fi
exit 0
