#!/usr/bin/env bash
# PreCompact hook (REC-19 / ADR-024): snapshot state LOAD-BEARING ngay TRƯỚC /compact thành
# .claude/.precompact-state — biến "keep_first" (agent-harness.md) từ PROSE thành DETERMINISTIC.
# session-start.sh (fire source=compact) phát verbatim rồi xoá (one-shot).
# KHÔNG BAO GIỜ block compaction (luôn exit 0). Self-no-op khi vắng git / pre-Phase-0.
ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
cd "$ROOT" 2>/dev/null || exit 0
OUT="${PRECOMPACT_FILE:-$ROOT/.claude/.precompact-state}"
mkdir -p "$(dirname "$OUT")" 2>/dev/null

{
  echo "🧷 keep_first snapshot (PreCompact, REC-19) — phục hồi sau /compact:"
  # 1) Path plan đang dùng (context chat mất khi nén)
  [ -f "$ROOT/docs/active-context.md" ] && echo "• Plan sống: docs/active-context.md (focus · bước kế · open question · lần verify xanh)"
  [ -f "$ROOT/docs/plan.md" ]           && echo "• Plan phase/Done: docs/plan.md"
  # 2) 4 luật always-must (conventions.md)
  echo "• 4 luật always-must: statusHistory MỌI transition · money int-VND qua MỘT formatter core · i18n key (không hard-code) · prefers-reduced-motion."
  if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    # 3) File đã đổi + 4) verify-cmd theo ngôn ngữ đổi
    changed="$(git status --porcelain 2>/dev/null | sed 's/^...//' | head -30)"
    if [ -n "$changed" ]; then
      echo "• File đã đổi (git):"
      printf '%s\n' "$changed" | sed 's/^/    /'
      cmds=""
      printf '%s\n' "$changed" | grep -qE '\.(ts|tsx|js|jsx)$' && cmds="$cmds pnpm verify"
      printf '%s\n' "$changed" | grep -qE '\.go$'              && cmds="$cmds make verify-go"
      printf '%s\n' "$changed" | grep -qE '\.rs$'              && cmds="$cmds make verify-rs"
      [ -n "$cmds" ] && echo "• Verify-cmd ngôn ngữ đổi:$cmds"
    fi
    # 5) ADR id đang chạm (best-effort grep diff — heuristic; plan.md không có marker máy-đọc)
    adrs="$(git diff HEAD 2>/dev/null | grep -oE 'ADR-[0-9]{3}' | sort -u | head -12 | tr '\n' ' ')"
    [ -n "$adrs" ] && echo "• ADR đang chạm (heuristic từ diff — xác nhận lại trước khi sửa): $adrs"
  fi
  echo "• (Ranh giới) auto-memory là scratchpad — muốn binding phải thành ADR/luật (guard-files canh)."
} > "$OUT" 2>/dev/null

exit 0
