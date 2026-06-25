#!/usr/bin/env bash
# osm-mutation.test.sh — Mutation kill-gate cho OrderStatus state machine (REC-15 / ADR-024 draft).
#
# VÌ SAO: green-gate (verify-before-stop) chỉ chứng minh test PASS, KHÔNG phân biệt test vacuous
# với test thật. OSM là xương sống xuyên 4 surface ⇒ một suite "pass mà không ràng buộc transition"
# là điểm mù cao nhất, coverage% không bắt được. Gate này áp một bộ mutant CỐ ĐỊNH lên state machine
# rồi assert các test OSM-* (docs/acceptance.md) PHẢI chuyển ĐỎ — mutant sống = test không ràng buộc.
#
# Là EM RUỘT deterministic của guard.test.sh (KHÔNG phải LLM-judge). Chạy ở CI lane ".claude/** đổi"
# CÙNG guard.test.sh — KHÔNG wire vào inner-loop của verify-before-stop (giữ vòng agent nhẹ, đúng
# tinh thần "accept downtime").
#
# HAI CHẾ ĐỘ:
#   A) SELF-CHECK (luôn chạy, kể cả pre-Phase-0): áp bộ mutant operator lên một toy-OSM pure-bash +
#      toy-test, assert mỗi mutant bị KILL. Chứng minh máy-móc mutation hoạt động NGAY — đúng tinh thần
#      REC-09 ("gate no-op không phân biệt được với gate pass; self-test là cái phân biệt").
#   B) REAL-CHECK: tự kích khi Phase-0 land packages/core — áp CÙNG họ mutant lên OSM thật + chạy test
#      order_state.*, assert OSM-01..03 chuyển đỏ. Self-no-op (skip rõ ràng) khi OSM chưa tồn tại.
set -u
ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
pass=0; fail=0
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; pass=$((pass+1)); }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$1"; fail=$((fail+1)); }
skip() { printf '  \033[33m∘\033[0m %s\n' "$1"; }

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

# ── Toy OSM: stand-in pure-bash của transition-guard + statusHistory-writer + reason-check ──
# Tag #GUARDMATCH/#GUARDCALL/#HISTORY/#REASON là neo cho sed-mutant (cùng họ operator dùng cho real-arm).
cat > "$TMP/toy.sh" <<'TOY'
ALLOWED="PENDING_CONFIRM>PAID PAID>IN_PRODUCTION IN_PRODUCTION>SHIPPED SHIPPED>DELIVERED PENDING_CONFIRM>CANCELLED PAID>CANCELLED DELIVERED>RETURNED"
HISTORY=""
osm_allowed() { case " $ALLOWED " in *" $1>$2 "*) return 0 ;; esac; return 1; } #GUARDMATCH
osm_transition() {
  local from="$1" to="$2" reason="$3"
  osm_allowed "$from" "$to" || { echo "REJECT invalid $from>$to"; return 1; } #GUARDCALL
  case "$to" in CANCELLED|RETURNED) [ -n "$reason" ] || { echo "REJECT reason $to"; return 1; } ;; esac #REASON
  HISTORY="$HISTORY|$from>$to" #HISTORY
  return 0
}
TOY

# ── Toy tests (map 1-1 với OSM-01..03 trong docs/acceptance.md); mỗi test chạy subshell sạch, 0=PASS ──
t_osm01() { ( . "$1"                                                  # OSM-01 transition_table
  osm_transition PENDING_CONFIRM PAID    "" >/dev/null || exit 1      #   valid  -> phải OK
  osm_transition PAID IN_PRODUCTION      "" >/dev/null || exit 1      #   valid  -> phải OK (kill drop-edge)
  osm_transition PENDING_CONFIRM SHIPPED "" >/dev/null && exit 1      #   invalid-> phải REJECT
  osm_transition PAID SHIPPED            "" >/dev/null && exit 1      #   invalid (skip IN_PRODUCTION) -> REJECT (kill add-illegal-edge)
  exit 0 ); }
t_osm01t() { ( . "$1"                                                 # OSM-01 terminal: CANCELLED/RETURNED không có cạnh ra
  osm_transition CANCELLED PAID "x" >/dev/null && exit 1             #   terminal -> phải REJECT (kill terminal-escape)
  osm_transition RETURNED  PAID "x" >/dev/null && exit 1
  exit 0 ); }
t_osm02() { ( . "$1"                                                  # OSM-02 appends_status_history
  osm_transition PENDING_CONFIRM PAID "" >/dev/null
  n=$(printf '%s' "$HISTORY" | tr -cd '|' | wc -c | tr -d ' ')
  [ "$n" = "1" ] || exit 1; exit 0 ); }
t_osm03() { ( . "$1"                                                  # OSM-03 cancel_return_requires_reason
  osm_transition PENDING_CONFIRM CANCELLED "" >/dev/null && exit 1    #   cancel-no-reason -> phải REJECT
  exit 0 ); }

echo "== baseline: toy-OSM + toy-test phải XANH (nếu đỏ ⇒ toy/test hỏng, không phải mutant) =="
t_osm01  "$TMP/toy.sh" && ok "OSM-01 baseline pass" || bad "OSM-01 baseline FAIL"
t_osm01t "$TMP/toy.sh" && ok "OSM-01 terminal baseline pass" || bad "OSM-01 terminal baseline FAIL"
t_osm02  "$TMP/toy.sh" && ok "OSM-02 baseline pass" || bad "OSM-02 baseline FAIL"
t_osm03  "$TMP/toy.sh" && ok "OSM-03 baseline pass" || bad "OSM-03 baseline FAIL"

echo "== mutation kill-gate: mỗi mutant PHẢI bị test tương ứng giết =="
run_mutant() { # $1=label  $2=sed-expr  $3=test-fn  $4=osm-id
  sed "$2" "$TMP/toy.sh" > "$TMP/mut.sh"
  if "$3" "$TMP/mut.sh"; then
    bad "$4 KHÔNG ràng buộc transition — mutant '$1' SỐNG (test vẫn pass sau đột biến)"
  else
    ok "$4 ràng buộc — mutant '$1' bị KILL"
  fi
}
run_mutant "allow-all guard"    's~.*#GUARDCALL~  : # mut-allow-all~'                                                              t_osm01 "OSM-01"
run_mutant "swap from/to"       's~.*#GUARDMATCH~osm_allowed() { case " $ALLOWED " in *" $2>$1 "*) return 0 ;; esac; return 1; } # mut-swap~' t_osm01 "OSM-01"
run_mutant "drop statusHistory" 's~.*#HISTORY~  : # mut-drop-history~'                                                            t_osm02 "OSM-02"
run_mutant "drop reason-check"  's~.*#REASON~  : # mut-drop-reason~'                                                              t_osm03 "OSM-03"
# Họ mutant cấu-trúc-cạnh (audit 2026-06-23): test over-/under-constrains transitions sẽ để mutant này SỐNG.
run_mutant "drop-edge PAID>IN_PRODUCTION"   's~PAID>IN_PRODUCTION ~~'                t_osm01  "OSM-01"
run_mutant "add-illegal PAID>SHIPPED"       's~^ALLOWED="~ALLOWED="PAID>SHIPPED ~'   t_osm01  "OSM-01"
run_mutant "terminal-escape CANCELLED>PAID" 's~^ALLOWED="~ALLOWED="CANCELLED>PAID ~' t_osm01t "OSM-01"

echo "== real-check: packages/core OSM + money (Phase-0 ĐÃ WIRE) =="
# audit r3 ARM-cliff RESOLVED: áp CÙNG họ mutant lên FILE NGUỒN thật (src, KHÔNG phải test), chạy
# vitest cho test tương ứng, assert nó CHUYỂN ĐỎ rồi khôi phục. Mutant SỐNG (test vẫn xanh) ⇒ test
# vacuous ⇒ bad. Skip RÕ RÀNG (không phải no-op âm thầm) khi vắng node_modules (vd CI harness-lane
# không cài node) — toy self-check ở trên vẫn là bảo đảm máy-móc ở mọi nơi; app-CI (có node) chạy real.
CORE="$ROOT/packages/core"
osm_src="$(find "$CORE/src" -type f \( -iname '*state*' -o -iname '*osm*' -o -iname '*transition*' \) 2>/dev/null | head -1)"
money_src="$(find "$CORE/src" -type f -iname 'money*' 2>/dev/null | head -1)"
if [ -z "$osm_src" ]; then
  skip "packages/core OSM chưa tồn tại (pre-Phase-0) — self-check toy ở trên là bảo đảm hiện hành; real-arm tự kích khi OSM land."
elif [ ! -d "$CORE/node_modules" ] && [ ! -d "$ROOT/node_modules" ]; then
  skip "real-mutation-arm ĐÃ wire nhưng vắng node_modules (vd CI harness-lane không cài node) — chạy ở môi trường có vitest (local / app-CI)."
else
  # Khôi phục file nguồn kể cả khi bị ngắt giữa chừng (per-call backup + trap toàn cục).
  cp "$osm_src" "$TMP/osm.orig"
  [ -n "$money_src" ] && cp "$money_src" "$TMP/money.orig"
  trap 'cp -f "$TMP/osm.orig" "$osm_src" 2>/dev/null; [ -n "$money_src" ] && cp -f "$TMP/money.orig" "$money_src" 2>/dev/null; rm -rf "$TMP"' EXIT
  run_vitest() {
    if [ -x "$CORE/node_modules/.bin/vitest" ]; then ( cd "$CORE" && ./node_modules/.bin/vitest run "$1" ) >/dev/null 2>&1
    else ( cd "$CORE" && pnpm -s exec vitest run "$1" ) >/dev/null 2>&1; fi
  }
  run_real() { # $1=label  $2=src-file  $3=sed-expr  $4=test-glob  $5=osm-id
    local label="$1" file="$2" expr="$3" glob="$4" id="$5" bak rc
    bak="$(mktemp)"; cp "$file" "$bak"
    sed "$expr" "$bak" > "$file"
    run_vitest "$glob"; rc=$?
    cp "$bak" "$file"; rm -f "$bak"
    if [ "$rc" -ne 0 ]; then ok "REAL $id — mutant '$label' bị KILL (test đỏ)"; else bad "REAL $id — mutant '$label' SỐNG (test vẫn xanh sau đột biến!)"; fi
  }
  if run_vitest test/order-state.test.ts && run_vitest test/money.test.ts; then
    ok "REAL baseline: order-state + money test XANH trước khi mutate"
  else
    bad "REAL baseline ĐỎ — sửa OSM/money/test trước khi tin mutation gate (đừng mutate trên nền đỏ)"
  fi
  # Họ mutant OSM (anchor #GUARDCALL/#GUARDMATCH/#EDGES/#HISTORY/#REASON) → OSM-01..03 phải đỏ.
  run_real "allow-all guard"                "$osm_src" 's~.*#GUARDCALL~  // mut-allow-all~'                                                                       test/order-state.test.ts "OSM-01"
  run_real "swap from/to"                   "$osm_src" 's~from}>${to~to}>${from~'                                                                                test/order-state.test.ts "OSM-01"
  run_real "drop-edge PAID>PRINTING"        "$osm_src" 's~PAID>PRINTING ~~'                                                                                      test/order-state.test.ts "OSM-01"
  run_real "add-illegal PAID>SHIPPING"      "$osm_src" "/#EDGES/ s/= '/= 'PAID>SHIPPING /"                                                                        test/order-state.test.ts "OSM-01"
  run_real "terminal-escape CANCELLED>PAID" "$osm_src" "/#EDGES/ s/= '/= 'CANCELLED>PAID /"                                                                      test/order-state.test.ts "OSM-01"
  run_real "drop statusHistory"             "$osm_src" 's~.*#HISTORY~  const statusHistory = order.statusHistory; // mut-drop-history~'                           test/order-state.test.ts "OSM-02"
  run_real "drop reason-check"              "$osm_src" 's~.*#REASON~  // mut-drop-reason~'                                                                        test/order-state.test.ts "OSM-03"
  # Họ mutant money (#GROUP/#SUBTOTAL/#TOTAL) → MNY-01/03 phải đỏ (plan.md ARM "mở osm-mutation sang money").
  if [ -n "$money_src" ]; then
    run_real "money drop-grouping"          "$money_src" "s~.*#GROUP~  return String(amount) + '₫'; // mut-group~"                                                test/money.test.ts "MNY-03"
    run_real "money subtotal off-by-one"    "$money_src" 's~.*#SUBTOTAL~    subtotal += item.quantity * (item.unitPrice + colorDelta + optionsTotal) + 1; // mut-sub~' test/money.test.ts "MNY-01"
    run_real "money total minus-fee"        "$money_src" 's~.*#TOTAL~  const total = subtotal - input.shippingFee; // mut-total~'                                 test/money.test.ts "MNY-01"
  fi
fi

echo
printf 'Kết quả: \033[32m%d pass\033[0m / \033[31m%d fail\033[0m\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
