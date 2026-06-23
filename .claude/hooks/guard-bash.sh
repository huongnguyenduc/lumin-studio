#!/usr/bin/env bash
# PreToolUse(Bash) guard — chặn lệnh huỷ diệt / mất dữ liệu (+ loop-detector REC-06).
# Exit 2 = chặn (stderr -> Claude). Exit 0 = cho qua.
# Grep trực tiếp raw JSON trên stdin (không cần jq) — các pattern đều là chuỗi không-escape.
INPUT="$(cat)"
ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"

# Mỗi phần tử: "regex|||lý do"
PATTERNS=(
  'rm[[:space:]]+-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*[[:space:]]+(/|~|\*|\$HOME)|||rm -rf vào /, ~, $HOME hoặc * — quá nguy hiểm'
  'rm[[:space:]]+-[a-zA-Z]*f[a-zA-Z]*r[a-zA-Z]*[[:space:]]+(/|~|\*|\$HOME)|||rm -fr vào /, ~, $HOME hoặc *'
  'docker[-[:space:]]+compose[[:space:]]+[^|;&]*down[^|;&]*(--volumes|[[:space:]]-v([[:space:]"]|$))|||docker compose down -v sẽ XOÁ volume (mất data Garage/Postgres — ADR-018, Garage không versioning)'
  'docker[[:space:]]+volume[[:space:]]+rm|||docker volume rm xoá dữ liệu bền vững'
  'docker[[:space:]]+system[[:space:]]+prune[^|;&]*--volumes|||docker system prune --volumes xoá volume'
  '\bmkfs|||mkfs định dạng ổ đĩa'
  '\bdd[[:space:]]+if=|||dd if= có thể ghi đè ổ đĩa'
  'chmod[[:space:]]+-R[[:space:]]+777[[:space:]]+/|||chmod -R 777 / phá quyền hệ thống'
  '>[[:space:]]*/dev/sd|||ghi trực tiếp vào /dev/sd*'
  'git[[:space:]]+([^|;&]*[[:space:]])?push[^|;&]*[[:space:]](--force|-f)([[:space:]"]|$)|||git push --force ghi đè lịch sử remote (dùng --force-with-lease nếu thật cần, tự chạy tay)'
  '(drop|truncate)[[:space:]]+(table|database)[[:space:]]|||DROP/TRUNCATE phá dữ liệu — nếu là migration hợp lệ, tự chạy tay'
  ':\(\)[[:space:]]*\{[[:space:]]*:[[:space:]]*\|[[:space:]]*:|||fork bomb'
  # Mất dữ liệu chưa-commit / xoá hàng loạt (audit 2026-06-23: trước đây lọt hết)
  'git[[:space:]]+reset[[:space:]]+[^|;&]*--hard|||git reset --hard mất thay đổi chưa commit — nếu chắc, tự chạy tay'
  'git[[:space:]]+clean[[:space:]]+-[a-zA-Z]*f|||git clean -f xoá file untracked không phục hồi'
  'git[[:space:]]+checkout[[:space:]]+--[[:space:]]+\.([[:space:]"]|$)|||git checkout -- . bỏ mọi thay đổi working tree'
  'find[[:space:]]+[^|;&]*[[:space:]]-delete([[:space:]"]|$)|||find ... -delete xoá hàng loạt'
  '\bshred[[:space:]]|||shred phá file không phục hồi'
  '\btruncate[[:space:]]+-s[[:space:]]*0|||truncate -s 0 xoá sạch nội dung file'
  'rm[[:space:]]+-[a-zA-Z]*[rf][a-zA-Z]*[[:space:]]+\.(/\*)?([[:space:]"]|$)|||rm -rf . hoặc ./* xoá sạch thư mục hiện tại'
  '--no-preserve-root|||--no-preserve-root cố xoá root'
)

for entry in "${PATTERNS[@]}"; do
  re="${entry%%|||*}"
  why="${entry##*|||}"
  if printf '%s' "$INPUT" | grep -Eiq -- "$re"; then
    echo "⛔ guard-bash chặn: $why" >&2
    echo "Nếu thật sự cần, hãy tự chạy lệnh này trong terminal của bạn (ngoài Claude)." >&2
    exit 2
  fi
done

# Trích lệnh thật một lần (dùng cho secret-guard + loop-detector). Grep trên CMD chứ KHÔNG trên
# INPUT thô — vì trong JSON verb đứng sau dấu " (vd "command":"cat .env") làm hỏng word-boundary.
HIST="${CMD_HISTORY_FILE:-$ROOT/.claude/.cmd-history}"
if command -v jq >/dev/null 2>&1; then
  CMD="$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)"
else
  CMD="$(printf '%s' "$INPUT" | grep -oE '"command"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed -E 's/.*:[[:space:]]*"([^"]*)"/\1/')"
fi

# --- Secret bypass guard (audit 2026-06-23): permissions.deny Read(.env) CHỈ chặn tool Read,
#     KHÔNG chặn `cat .env`/`source .env` qua Bash; env-scrub chỉ lọc ENV var, không lọc nội dung file.
#     Chặn (a) ĐỌC/exfil secret và (b) GHI-redirection vào file bảo vệ (hợp đồng/secret) — vốn đi vòng
#     guard-files (chỉ match Edit|Write). Chừa .env.example (template được commit). ---
SECRET_PATH_RE='\.env([[:space:]"'"'"'`]|\.[a-zA-Z0-9]|$)|[^[:space:]"'"'"'`]*\.(age|pem)([[:space:]"'"'"'`]|$)|[^[:space:]"'"'"'`]*id_rsa|(^|[[:space:]"'"'"'`/])secrets/'
SECRET_VERB_RE='(^|[;&|`(]|[[:space:]])(cat|less|more|head|tail|xxd|od|strings|nl|base64|cp|scp|rsync|grep|egrep|fgrep|awk|sed|source|tee|sort|uniq|cut)[[:space:]]'
PROT_WRITE_RE='(>>?|(^|[[:space:]])tee[[:space:]]|sed[[:space:]]+-i[^|;&]*[[:space:]]|dd[[:space:]]+[^|;&]*of=)[[:space:]]*[^|;&]*(docs/(decisions|conventions)\.md|(^|[[:space:]"'"'"'`/])\.env([[:space:]"'"'"'`]|$|\.[a-zA-Z])|[^[:space:]"'"'"'`]*\.(age|pem)|(^|[[:space:]"'"'"'`/])secrets/)'
if [ -n "$CMD" ] && ! printf '%s' "$CMD" | grep -Eq '\.env\.example'; then
  if printf '%s' "$CMD" | grep -Eq "$SECRET_VERB_RE" && printf '%s' "$CMD" | grep -Eq "$SECRET_PATH_RE"; then
    echo "⛔ guard-bash chặn ĐỌC/exfil file bí mật qua Bash (.env/.age/.pem/id_rsa/secrets/) — deny Read chỉ chặn tool Read, không chặn cat." >&2
    echo "Nếu thật cần xem, mở tay ngoài Claude." >&2
    exit 2
  fi
  if printf '%s' "$CMD" | grep -Eq "$PROT_WRITE_RE"; then
    echo "⛔ guard-bash chặn GHI qua Bash redirection vào file bảo vệ (hợp đồng decisions/conventions hoặc secret) — dùng Edit/Write tool (qua guard-files) hoặc sửa tay." >&2
    exit 2
  fi
fi
# Truncate file rỗng (: > file) — mất nội dung; chừa `>`/`>>` thường (tạo/ghi file là bình thường).
if [ -n "$CMD" ] && printf '%s' "$CMD" | grep -Eq '(^|[;&|[:space:]]):[[:space:]]*>[[:space:]]*[^[:space:]|;&]'; then
  echo "⛔ guard-bash chặn ': > file' (truncate nội dung file về rỗng) — nếu cố ý, tự chạy tay." >&2
  exit 2
fi

# --- Loop-detector (REC-06): cùng một lệnh lặp >=4 lần LIÊN TIẾP = no-progress loop ---
# Đặt SAU các pattern huỷ diệt (an toàn ưu tiên). Hash lệnh (chịu được lệnh nhiều dòng) rồi đếm run cuối.
if [ -n "$CMD" ] && command -v cksum >/dev/null 2>&1; then
  sig="$(printf '%s' "$CMD" | cksum | awk '{print $1}')"
  mkdir -p "$(dirname "$HIST")" 2>/dev/null
  printf '%s\n' "$sig" >> "$HIST" 2>/dev/null
  tail -n 50 "$HIST" 2>/dev/null > "$HIST.tmp" && mv "$HIST.tmp" "$HIST" 2>/dev/null
  run="$(awk -v s="$sig" '{ if ($0==s) c++; else c=0 } END{ print c+0 }' "$HIST" 2>/dev/null)"
  if [ "${run:-0}" -ge 4 ]; then
    echo "⛔ guard-bash: lệnh này đã chạy ${run} lần Y HỆT liên tiếp — có vẻ đang loop no-progress." >&2
    echo "Đổi cách tiếp cận, hoặc nếu thật sự bế tắc thì surface cho người (đừng lặp lại lệnh cũ)." >&2
    : > "$HIST" 2>/dev/null   # reset để không kẹt cứng sau khi đã cảnh báo
    exit 2
  fi
fi
exit 0
