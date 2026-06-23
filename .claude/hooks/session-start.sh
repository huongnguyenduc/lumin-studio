#!/usr/bin/env bash
# SessionStart hook (ADR-023):
#  1) Reset trạng thái per-session của loop/retry detector (REC-06).
#  2) Orient-before-start (REC-01): phát một khối additionalContext NHỎ — nhánh + commit cuối,
#     index phase/Done của plan.md, và docs/active-context.md nếu có.
# Self-no-op an toàn (không phát gì) khi pre-Phase-0 / không có git. KHÔNG bao giờ chặn.
ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
cd "$ROOT" 2>/dev/null || exit 0

# --- 1) Reset state (REC-06) ---
rm -f "${CMD_HISTORY_FILE:-$ROOT/.claude/.cmd-history}" \
      "${VERIFY_ATTEMPTS_FILE:-$ROOT/.claude/.verify-attempts}" 2>/dev/null

# --- 2) Orient ---
ctx=""
add() { ctx="${ctx}$1"$'\n'; }

# PreCompact snapshot (REC-19): nếu có, phát TRƯỚC tiên rồi xoá (one-shot) — phục hồi keep_first sau /compact.
PCF="${PRECOMPACT_FILE:-$ROOT/.claude/.precompact-state}"
if [ -f "$PCF" ]; then
  ctx="${ctx}$(cat "$PCF")"$'\n'
  rm -f "$PCF" 2>/dev/null
else
  # Fresh start/clear/resume (REC-SP-01 / ADR-025): front-load 4 luật always-must — chúng KHÔNG đi kèm
  # path nào (OSM xuyên 4 surface) nên phiên sửa path không auto-load domain-core.md sẽ khởi động mù.
  # Sau /compact thì snapshot precompact ĐÃ chứa dòng này → chỉ phát ở nhánh else (tránh trùng).
  # GIỮ ĐỒNG BỘ literal với pre-compact.sh dòng 17.
  add "• 4 luật always-must: statusHistory MỌI transition · money int-VND qua MỘT formatter core · i18n key (không hard-code) · prefers-reduced-motion."
fi

if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  br="$(git branch --show-current 2>/dev/null)"
  last="$(git log -1 --pretty='%h %s' 2>/dev/null)"
  [ -n "$br" ]   && add "• Nhánh: $br"
  [ -n "$last" ] && add "• Commit cuối: $last"
  # Harness version-stamp (REC-37/REC-SP-08 · ADR-025): KHÔNG plugin.json/VERSION (doNotAdopt plugin
  # polyglot) — harness là file commit, "version" = commit .claude/** cuối. Biết phiên cũ có chạy harness cũ.
  hrev="$(git log -1 --pretty='%h %cs' -- .claude/ 2>/dev/null)"
  [ -n "$hrev" ] && add "• Harness rev (commit .claude/** cuối): $hrev"
fi

# Skill index (REC-SP-10 / ADR-025): pointer thuần, KHÔNG auto-invoke, KHÔNG ép gọi (skill là knowledge,
# không phải law). Đặt TRƯỚC active-context/plan (block lớn dễ bị cap 3000 char) để pointer nhỏ-ổn-định
# luôn sống sót truncation. Glob động: thêm skill mới không phải sửa hook.
if [ -d "$ROOT/.claude/skills" ]; then
  skills=""
  for sd in "$ROOT"/.claude/skills/*/SKILL.md; do
    [ -f "$sd" ] || continue
    skills="${skills:+$skills · }$(basename "$(dirname "$sd")")"
  done
  [ -n "$skills" ] && add "• Skills (gọi qua Skill tool khi task chạm pháp lý/outbox/render — không tự động): $skills"
fi

# active-context.md = "đang ở đâu" (volatile) — echo verbatim, đã cap ở dưới
if [ -f "$ROOT/docs/active-context.md" ]; then
  add "• docs/active-context.md (focus hiện tại):"
  ctx="${ctx}$(sed -n '1,40p' "$ROOT/docs/active-context.md")"$'\n'
fi

# plan.md: chỉ grep literal ổn định (## heading + **Done:**) — KHÔNG suy ra phase đang chạy
if [ -f "$ROOT/docs/plan.md" ]; then
  idx="$(grep -nE '^## |^\*\*Done:\*\*' "$ROOT/docs/plan.md" 2>/dev/null | head -40)"
  if [ -n "$idx" ]; then
    add "• Index phase/Done (docs/plan.md — không phải phase đang chạy):"
    ctx="${ctx}${idx}"$'\n'
  fi
fi

[ -z "$ctx" ] && exit 0

# Cap cứng ~3000 ký tự rồi phát dưới dạng SessionStart additionalContext.
ctx="$(printf '%s' "$ctx" | head -c 3000)"
header='📍 Orient (Lumin harness) — đọc docs/README.md trước khi sửa nhiều file:'$'\n'
if command -v jq >/dev/null 2>&1; then
  printf '%s\n%s' "$header" "$ctx" \
    | jq -Rs '{hookSpecificOutput:{hookEventName:"SessionStart",additionalContext:.}}'
else
  esc="$(printf '%s\n%s' "$header" "$ctx" | sed 's/\\/\\\\/g; s/"/\\"/g' | awk 'BEGIN{ORS="\\n"}{print}')"
  printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"%s"}}' "$esc"
fi
exit 0
