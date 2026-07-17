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
  # Huỷ lịch sử/ref git (audit 2026-06: repo nay git-tracked — đây là rủi ro sống với chính history harness)
  'git[[:space:]]+stash[[:space:]]+(clear|drop)|||git stash clear/drop xoá stash không phục hồi'
  'git[[:space:]]+update-ref[[:space:]]+-d|||git update-ref -d xoá ref trực tiếp'
  'git[[:space:]]+reflog[[:space:]]+expire|||git reflog expire xoá reflog (đường phục hồi cuối cùng)'
  'git[[:space:]]+gc[[:space:]]+[^|;&]*--prune|||git gc --prune xoá object unreachable (mất đường phục hồi)'
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

# `git branch -D` xoá nhánh chưa-merge (mất commit) — kiểm CASE-SENSITIVE riêng (loop trên dùng -i nên
# không phân biệt được -D với -d an toàn). grep -E (KHÔNG -i) ⇒ chỉ bắt -D viết hoa, chừa `git branch -d`.
if printf '%s' "$INPUT" | grep -Eq 'git[[:space:]]+branch[[:space:]]+-[a-zA-Z]*D'; then
  echo "⛔ guard-bash chặn: git branch -D xoá nhánh chưa-merge (mất commit) — dùng -d (chỉ xoá nhánh đã merge) hoặc tự chạy tay." >&2
  exit 2
fi

# Trích lệnh thật một lần (dùng cho secret-guard + loop-detector). Grep trên CMD chứ KHÔNG trên
# INPUT thô — vì trong JSON verb đứng sau dấu " (vd "command":"cat .env") làm hỏng word-boundary.
HIST="${CMD_HISTORY_FILE:-$ROOT/.claude/.cmd-history}"
HAVE_JQ=0; command -v jq >/dev/null 2>&1 && HAVE_JQ=1
if [ "$HAVE_JQ" -eq 1 ]; then
  CMD="$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)"
else
  CMD="$(printf '%s' "$INPUT" | grep -oE '"command"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed -E 's/.*:[[:space:]]*"([^"]*)"/\1/')"
fi
# Khi VẮNG jq, no-jq extractor cắt CMD ở dấu " escaped (D1-3) ⇒ secret/contract check quét RAW $INPUT làm
# backstop. Trong JSON thô verb đứng ĐẦU dính ngay dấu " (vd "command":"cat .env") — audit-r3 đã THÊM " vào
# lớp boundary của SECRET_VERB_RE/SECRET_DOTSRC_RE/PROT_VERB_RE nên first-token cat/cp/python… nay vẫn match
# khi vắng jq (trước đây LỌT im lặng). Có jq ⇒ quét $CMD đã giải mã (chính xác hơn). audit 2026-06 + r3.
if [ "$HAVE_JQ" -eq 1 ]; then SCAN="$CMD"; else SCAN="$INPUT"; fi

# --- Secret bypass guard (audit 2026-06-23 + mở rộng 2026-06): permissions.deny Read(.env) CHỈ chặn tool
#     Read, KHÔNG chặn `cat .env`/`python -c open('.env')`/`. ./.env`/`read X < .env` qua Bash; env-scrub chỉ
#     lọc ENV var, không lọc nội dung file. Verb-list guard KHÔNG BAO GIỜ phủ hết mọi interpreter (best-effort,
#     defense-in-depth — xem agent-harness.md). Chặn (a) ĐỌC/exfil secret và (b) GHI vào file BẢO VỆ
#     (contract decisions/conventions · secret · CHÍNH FILE HARNESS .claude//tests/harness//CI — self-guard P0,
#     vốn đi vòng guard-files chỉ match Edit|Write). Chừa .env.example (template được commit; anchor đúng biên). ---
SECRET_PATH_RE='\.env([[:space:]"'"'"'`]|\.[a-zA-Z0-9]|$)|[^[:space:]"'"'"'`]*\.(age|pem)([[:space:]"'"'"'`]|$)|[^[:space:]"'"'"'`]*id_rsa|(^|[[:space:]"'"'"'`/])secrets/'
# Verb đọc nội dung — + interpreter (python/node/ruby/perl/php), read/mapfile, install/ln; verb cho phép cuối-chuỗi.
SECRET_VERB_RE='(^|[;&|`("]|[[:space:]])(cat|less|more|head|tail|xxd|od|strings|nl|base64|cp|scp|rsync|grep|egrep|fgrep|awk|sed|source|tee|sort|uniq|cut|python|python3|node|nodejs|ruby|perl|php|read|mapfile|install|ln)([[:space:]]|$)'
# dot-source `. file` (builtin) — verb-less; kết hợp với SECRET_PATH qua AND.
SECRET_DOTSRC_RE='(^|[;&|`("]|[[:space:]])\.[[:space:]]'
# redirect đọc `< secretpath` — tự chứa path (vd `mapfile < .env`, `read X < .env`).
SECRET_REDIR_RE='<[[:space:]]*(\./)?[^[:space:]|;&"'"'"'`<>]*\.env([[:space:]"'"'"'`]|\.[a-zA-Z0-9]|$)|<[[:space:]]*(\./)?[^[:space:]|;&"'"'"'`<>]*\.(age|pem)|<[[:space:]]*(\./)?[^[:space:]|;&"'"'"'`<>]*id_rsa|<[[:space:]]*[^|;&<>]*secrets/'
# Đích GHI cần bảo vệ: contract + secret + file harness (dùng /+ để bao double-slash docs//decisions.md).
PROT_PATH_RE='docs/+(decisions|conventions)\.md|(^|[[:space:]"'"'"'`/])\.env([[:space:]"'"'"'`]|$|\.[a-zA-Z])|[^[:space:]"'"'"'`]*\.(age|pem)|(^|[[:space:]"'"'"'`/])secrets/|(^|[[:space:]"'"'"'`/])\.claude/+(settings\.json|hooks/|rules/|agents/|skills/)|(^|[[:space:]"'"'"'`/])tests/+harness/|(^|[[:space:]"'"'"'`/])\.github/+workflows/'
# GHI qua redirection (>, tee, sed -i, dd of=) HOẶC qua verb không-redirection (cp/mv/install/ln/patch/interpreter/git checkout|restore).
PROT_REDIR_RE='(>>?|(^|[[:space:]])tee[[:space:]]|sed[[:space:]]+-i[^|;&]*[[:space:]]|dd[[:space:]]+[^|;&]*of=)[[:space:]]*[^|;&]*('"$PROT_PATH_RE"')'
PROT_VERB_RE='((^|[;&|`("]|[[:space:]])(cp|mv|install|ln|patch|python|python3|node|nodejs|ruby|perl|php)[[:space:]]|git[[:space:]]+(checkout|restore)[[:space:]])[^|;&]*('"$PROT_PATH_RE"')'
# Whitelist .env.example — anchor biên (audit 2026-06: trước đây substring trần cho lọt `.env.example.local`).
WL_RE='\.env\.example([[:space:]"'"'"'`/:;&|]|$)'
if [ -n "$SCAN" ] && ! printf '%s' "$SCAN" | grep -Eq "$WL_RE"; then
  # (a) ĐỌC/exfil secret
  if { printf '%s' "$SCAN" | grep -Eq "$SECRET_PATH_RE" \
        && { printf '%s' "$SCAN" | grep -Eq "$SECRET_VERB_RE" || printf '%s' "$SCAN" | grep -Eq "$SECRET_DOTSRC_RE"; }; } \
     || printf '%s' "$SCAN" | grep -Eq "$SECRET_REDIR_RE"; then
    echo "⛔ guard-bash chặn ĐỌC/exfil file bí mật qua Bash (.env/.age/.pem/id_rsa/secrets/ — kể cả interpreter/dot-source/redirect). deny Read chỉ chặn tool Read." >&2
    echo "Nếu thật cần xem, mở tay ngoài Claude." >&2
    exit 2
  fi
  # (b) GHI vào file BẢO VỆ
  if printf '%s' "$SCAN" | grep -Eq "$PROT_REDIR_RE" || printf '%s' "$SCAN" | grep -Eq "$PROT_VERB_RE"; then
    echo "⛔ guard-bash chặn GHI qua Bash vào file BẢO VỆ (hợp đồng decisions/conventions · secret · file harness .claude//tests/harness//CI) — dùng Edit/Write (qua guard-files) hoặc sửa tay." >&2
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

# --- REC-33: ngân sách lệnh-Bash/phiên (advisory, KHÔNG chặn) — nhắc khi gọi RẤT nhiều (loop/cost) ---
# Bash-call ≠ "turn" thật (guard chỉ fire trên Bash) ⇒ tín hiệu "đang gọi quá nhiều", non-blocking. Reset ở
# session-start cùng .cmd-history. Chỉ phát khi có jq (JSON an toàn) + thưa (mỗi 50 lệnh kể từ 150). Phát qua
# additionalContext: nếu PreToolUse của platform bỏ qua field này thì vô hại — luôn exit 0, không bao giờ chặn.
TC="${TURN_COUNT_FILE:-$ROOT/.claude/.turn-count}"
if command -v jq >/dev/null 2>&1; then
  n="$(cat "$TC" 2>/dev/null)"; n="${n//[!0-9]/}"; n=$(( ${n:-0} + 1 ))
  mkdir -p "$(dirname "$TC")" 2>/dev/null
  printf '%s' "$n" > "$TC" 2>/dev/null
  if [ "$n" -ge 150 ] && [ $(( n % 50 )) -eq 0 ]; then
    printf '%s' "⏱️ Đã ~${n} lệnh Bash trong phiên này. Nếu đang lặp/đi lòng vòng: cân nhắc /compact, xem lại plan, hoặc surface cho người. (Advisory — không chặn; reset mỗi phiên.)" \
      | jq -Rs '{hookSpecificOutput:{hookEventName:"PreToolUse",additionalContext:.}}'
  fi
fi
exit 0
