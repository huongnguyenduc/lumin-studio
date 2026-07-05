# Plan — Phase 2 · Checkout & thanh toán (rev. sau completeness-critic + owner-lock)

> **Nguồn:** planning workflow (10 readers → 3 slicing angles → 3-lens judge → synthesis), rồi vá theo
> completeness-critic. Winner = **Risk-first money-spine**. Bản rev này đóng mọi BLOCKER + IMPORTANT critic
> nêu: (1) đổi-trả disclosure bị gate nhầm sau khắc + trang privacy/return-policy chưa tồn tại; (2) presigned
> PUT không chặn được ≤10MB (đổi sang presigned POST) + thiếu bucket CORS; (3) nhánh `PENDING_CONFIRM→CANCELLED`
> (biên lai bị từ chối) trên wait-screen; (4) link theo dõi phone-less ở C3; (5) parity-test phải chạy cart có
> khắc.
>
> **Owner-lock (2026-07-05):** D-P2-2 = **presigned POST + auto-delete** (~90 ngày sau khi đơn terminal) · D-P2-3 =
> **100% prepay, không migration** · đổi-trả = **disclosure MỌI đơn + trang `/chinh-sach`** · **D-P2-8 = DỰNG endpoint
> theo dõi phone-less tokenized** (owner chọn KHỚP hi-fi C3, KHÔNG bỏ) → thêm sub-PR **P2-i**. Sáu quyết định còn lại
> lấy đề xuất workflow: VietQR = server-built `img.vietqr.io` URL · province = keys `shipping_rules` · ETA = tĩnh
> "3–5 ngày" · missing-STK = 422 · double-submit = FE-guard + runbook · analytics funnel = defer Phase 5.
> **decisions/conventions/spec/compliance vẫn là nguồn chân lý** — plan chỉ xếp thứ tự + slice.

## 0 · Bối cảnh + ranh giới

**Xương sống tiền/đơn ĐÃ xong ở Phase 1 — KHÔNG dựng lại.** `POST /orders` (`checkout.go`) đã: re-price
server-side từ catalog (`pricing.PriceItem`, `checkout.go:366`), tra phí ship theo tỉnh (`pricing.ShippingFee`,
`checkout.go:87`), tính tổng qua `money.CalcTotals` trong `db.CreateOrderTx`, đúc mã, ghi genesis `statusHistory`,
cấp consent `order_fulfillment` idempotent (`checkout.go:113`, scope-only, KHÔNG bundle marketing), enqueue outbox
`order.created` — **tất cả trong MỘT tx** (ADR-006, `checkout.go:103`). Web vào `PENDING_CONFIRM` (bắt buộc
`paymentProofUrl` qua `isHTTPProofURL`, `checkout.go:214`), inbox vào `PAID` (staff-gated, `checkout.go:244`).
Client gửi giá → loud 400 (`clientMoneyFields`, ADR-019). ADR-012 dual-ack (`personalizationAck` +
`engraveEchoConfirmed`) enforce server-side khi có khắc (`checkout.go:219`). Reconcile `PENDING_CONFIRM→PAID` là
endpoint owner-gated ĐÃ có. Guest lookup + FE auto-poll + `OrderTimeline` + i18n `orderStatus.*` (P1-o) đã chạy.

**Vậy Phase 2 = 4 seam BE/hạ-tầng còn thiếu + 1 trang tĩnh pháp lý + các màn FE treo lên chúng.** Đã verify:
`price.go:73` chỉ trả `{Lines, Subtotal}` (comment dòng 24 "shipping enters at order creation, Phase 2");
`checkout.go:77` đọc settings **chỉ** lấy `ShippingRules`, KHÔNG gate `bank_account` rỗng; chưa có endpoint upload
biên lai (`isHTTPProofURL` chỉ kiểm shape); `/orders/lookup` (P1-n) gate bằng **phone** — chưa có đường theo dõi
phone-less; `apps/storefront/src/app` KHÔNG có route pháp lý/privacy nào (chỉ home, danh-muc, gio-hang, tra-cuu-don,
tai-khoan, san-pham) → `consentPolicyVersion="2026-01"` (`checkout.go:163`) hiện **treo** (không có trang đích).

**Ranh giới Phase-2 (cứng) — OUT of scope:**
- **Đối soát tự động** (SePay/Casso/webhook) — Phase 5. Reconcile vẫn thủ công owner-xem-ảnh (ADR-010).
- **Cổng thanh toán** (VNPay/MoMo/thẻ) — chỉ VietQR tĩnh.
- **Idempotency-Key** — DEFERRED (ADR-033); double-submit chặn FE-side + owner reconcile-dupe (xem D-P2-7 + §7).
- **Đặt cọc biến thiên** — Phase 2 khoá 100% prepay (D-P2-3 LOCKED); không cột schema, không migration.
- **Admin STK-edit UI / admin reconcile UI** — Phase 3 (mutation seam đã có).
- **Email gửi mã+link** — Phase 5 (outbox). Wait-screen Phase 2 chỉ poll.
- **Analytics funnel checkout** (`begin_checkout`/`add_payment_info`/`purchase`, spec §08) — DEFER Phase 2 (D-P2-9),
  không phát event mới; P1-p consent-gate đã có, bật sau.
- **Auto-tạo-tài-khoản-từ-email lúc checkout** (tooltip hi-fi C1) — OUT: email vẫn OPTIONAL (khớp `checkout.go:287`
  `Email != nil`); account tự tạo là feature đã bỏ khỏi Phase 2 (xem P2-d note).
- **Address book returning-customer**, orphan-upload GC cron, encryption-at-rest cho proof — follow-up (§7).
- **ETA động per-region** — copy tĩnh "Giao trong 3–5 ngày" (D-P2-5).

**IN scope (owner-lock 2026-07-05):** **endpoint theo dõi phone-less tokenized** (link `/o/{code}-{token}` ở hi-fi
C3) — DỰNG ở **P2-i** (D-P2-8). Token = HMAC-derived capability (KHÔNG migration, xem D-P2-8).

**Luật xuyên suốt (must):** tiền int-VND chỉ qua MỘT formatter `@lumin/core` (cấm `Intl` ngoài core) · estimate đi
**cùng đường server** như order-create (không client-math) · mọi chuỗi i18n-key vi · mỗi màn đủ empty/loading/error ·
`prefers-reduced-motion` · sentence case · `390.000₫` · statusHistory KHÔNG đụng (reconcile dùng seam có sẵn) · PDPL
consent `order_fulfillment` KHÔNG bundle marketing, KHÔNG pre-tick (ADR-013, compliance §2) · **đổi-trả disclosure
hiện TRƯỚC khi mua cho MỌI đơn** (compliance §3 bullet 1 — không chỉ đơn khắc).

## 1 · Quyết định chủ (đã lock 2026-07-05)

| # | Quyết định | Trạng thái |
|---|---|---|
| **D-P2-1 · VietQR render** | QR tĩnh dựng **server-side từ STK đã lưu** (chống tráo, conventions §Bảo mật; ADR-010): build URL `img.vietqr.io` từ `settings.bank_account` trả trong `GET /checkout/config` — không nhận input client, không memo, không amount. Fallback: Go QR-lib render ảnh nếu img.vietqr.io không đủ tin. | ✅ LOCKED — img.vietqr.io |
| **D-P2-2 · Proof upload + retention** | Presigned **POST** (KHÔNG PUT) direct-to-Garage, bucket **riêng**. Chỉ presigned POST chặn được size server-side qua policy `content-length-range` (≤10MB) + `content-type` (image/jpeg\|png\|webp) — presigned PUT không ràng buộc Content-Length. TTL policy ≤5min, key có nonce. Bucket cần **CORS** cho storefront origin. `finalUrl` **host-pin về host Garage** rồi mới qua `isHTTPProofURL` (CHK-04). **Retention: auto-delete ~90 ngày sau khi đơn về terminal** (PDPL data-minimization; đủ cho tranh chấp). | ✅ LOCKED — POST + auto-delete 90d |
| **D-P2-3 · Deposit model** | Phase 2 = **100% prepay** mọi đơn web. KHÔNG thêm `Order.depositAmount`/`prepayPercentage`, KHÔNG migration. "Đặt cọc" ADR-012 hiện thực qua no-return + engrave-echo acks đã có. | ✅ LOCKED — 100% prepay |
| **D-P2-4 · Province picker source** | Dropdown tỉnh = **keys của `settings.shipping_rules`** (chỉ ship nơi đã cấu hình phí) → diệt footgun free-text→silent-422. Ward/street free-text. NO district (ADR-017). | ✅ LOCKED — shipping_rules |
| **D-P2-5 · ETA** | Copy tĩnh "Giao trong 3–5 ngày" (spec §05) — pure FE, không BE. | ✅ LOCKED — tĩnh |
| **D-P2-6 · Missing-STK behavior** | `bank_account` rỗng lúc web checkout → `POST /orders` **422 `NO_STK_CONFIGURED`**, KHÔNG tạo đơn với QR không render được. FE cũng disable submit tới khi payment-info load. | ✅ LOCKED — 422 |
| **D-P2-7 · Double-submit (ADR-033 residual)** | FE disable-on-submit + in-flight guard chặn double-click. **KHÔNG** đóng được ca 201-mất-sau-commit (retry tạo đơn trùng — `checkout.go:99-101` cảnh báo). Bổ sung: **owner reconcile-dupe runbook** (2 `PENDING_CONFIRM` cùng proof → cancel 1). | ✅ LOCKED — FE-guard + runbook |
| **D-P2-8 · Link theo dõi C3 (tokenized)** | **DỰNG endpoint theo dõi phone-less** khớp hi-fi C3 `lumin.studio/o/{code}-{token}`. **Token = HMAC-derived capability** `base62(HMAC_SHA256(TRACKING_SECRET, orderCode))` — **KHÔNG migration, KHÔNG cột mới**: tính lúc trả response, verify bằng recompute + constant-time compare. `GET /orders/track?code=&token=` trả **cùng `PublicOrderTimeline` DTO** như `/orders/lookup` (ADR-032 whitelist), rate-limit per-code (reuse token-bucket ADR-034), KHÔNG cần phone. Order-create 201 (`POST /orders`) trả thêm `trackingToken` (additive openapi). Nếu sau này cần revoke per-order → thêm cột `orders.tracking_token` (upgrade path, không phải Phase 2). | ✅ LOCKED — DỰNG P2-i (HMAC token) |
| **D-P2-9 · Analytics funnel** | spec §08 định nghĩa event; P1-p đã ship consent-gate. **DEFER** (không phát `begin_checkout`/`add_payment_info`/`purchase` Phase 2) để giữ scope. Bật consent-gated ở Phase sau. | ✅ LOCKED — defer |

## 2 · Backend/infra/nội-dung gaps (lấp trước mọi pixel FE tiêu thụ)

| Gap | PR | Verify trong code hôm nay | Ghi chú |
|---|---|---|---|
| Checkout config public (STK + VietQR URL + tỉnh ship được + **refundPolicy**) + missing-STK gate | P2-a | `checkout.go:77` đọc settings chỉ lấy `ShippingRules`; `GET /admin/settings` admin-gated; không gate `bank_account` | Endpoint public whitelist (bankAccount + shippableProvinces + vietqrUrl + **refundPolicy** cho đổi-trả pre-purchase §3). KHÔNG lộ config khác/PII. Gate 422 `NO_STK_CONFIGURED` fail-fast trước mọi write |
| Estimate có phí ship + total (TRƯỚC commit) | P2-b | `price.go:73` trả `{Lines, Subtotal}` ONLY; `price.go:127` **đã** forward personalization qua `PriceItem` | **Mở rộng** `POST /price/quote` thêm optional `province`; reuse `pricing.ShippingFee` + `money.CalcTotals`. Vắng province → byte-identical hôm nay. **Parity test PHẢI chạy cart CÓ KHẮC** (§5) |
| Payment-proof presigned-**POST** upload | P2-c | Chưa có endpoint; `isHTTPProofURL:457` chỉ kiểm scheme+host; no aws-sdk trong go.mod | Net-new infra: Garage S3 client, mint presigned **POST** (policy content-length-range + content-type), bucket CORS, host-pin finalUrl, auto-delete 90d. Cần ADR (D-P2-2) |
| Endpoint theo dõi phone-less tokenized (`GET /orders/track?code=&token=`) + `trackingToken` trong order-create response | P2-i | `/orders/lookup` (lookup.go) gate bằng phone; order-create trả Order DTO không có token | HMAC capability token (KHÔNG migration, D-P2-8); reuse `PublicOrderTimeline` DTO + token-bucket per-code; config `TRACKING_SECRET` (fail-fast forgeable, như JWT_SECRET); openapi additive → api-client regen staged |
| Trang pháp lý: đổi-trả + privacy-notice (đích consent link + đổi-trả pre-purchase) | P2-h | `apps/storefront/src/app` KHÔNG có route legal/privacy; `consentPolicyVersion="2026-01"` (`checkout.go:163`) treo | Route tĩnh `/chinh-sach` (i18n content, sentence case): return/exchange policy (Luật BVNTD 19/2023) + PDPL privacy notice (thu gì/mục đích/lưu bao lâu/quyền). Version khớp `2026-01`. ADR-free, land sớm |

## 3 · Thứ tự sub-PR (9) — dependency-sound

> Track: **BE** · **FE** · **infra** · **content**. Mọi FE land SAU seam nó tiêu thụ. Seam BE/infra/content
> (P2-a/b/c/i/h) mỗi cái `dependsOn=[]` (chỉ dựa Phase-1 đã merge) → land money/integrity/compliance TRƯỚC.
> **firstPR = P2-b** (ADR-free, backward-compat) hoặc **P2-h** (ADR-free content) song song; P2-a/P2-c/P2-i sau khi ADR/secret lock.

| id | title | surface | dependsOn | done-when |
|---|---|---|---|---|
| **P2-a** | `GET /checkout/config` (bankAccount + server-built VietQR URL + shippable provinces + **refundPolicy**) + missing-STK 422 gate | BE | — | Trả STK + vietqrUrl derive-server-side + provinces (keys `shipping_rules`) + refundPolicy cho anonymous; `POST /orders` web + `bank_account` rỗng → 422 `NO_STK_CONFIGURED`, KHÔNG tạo đơn (Go test); openapi + api-client regen **staged** (memory: oapi stale-check cần staged); `make verify-go` xanh. QR URL không field client-controllable |
| **P2-b** | Extend `POST /price/quote` với optional `province` → `{lines, subtotal, shippingFee, total}` | BE | — | Có province → fee+total khớp đúng cái `POST /orders` charge cho cùng cart+tỉnh; **Go parity test chạy cart CÓ KHẮC** (personalization surcharge phải estimate==charge, §5); vắng province → response **byte-identical** hôm nay; tỉnh không map → 422 `NO_SHIPPING_RULE` (field error, không silent ₫0); codegen stale-check staged+xanh |
| **P2-c** | Payment-proof presigned-**POST** endpoint (Garage S3) | infra | — | FE xin presigned POST, upload ảnh direct-to-Garage, `POST /orders` nhận finalUrl host-pinned; **oversize/wrong-mime reject bằng policy content-length-range+content-type** (KHÔNG dựa client khai size); bucket CORS cho storefront origin; auto-delete 90d; ADR upload+bucket+CORS+retention+host-pin (D-P2-2) merged; `make verify-go` xanh |
| **P2-i** | BE: endpoint theo dõi phone-less tokenized (`GET /orders/track`) + `trackingToken` trong order-create 201 | BE | — | HMAC capability token (KHÔNG migration): order-create trả `trackingToken`; `GET /orders/track?code=&token=` verify constant-time → trả `PublicOrderTimeline` (**cùng DTO `/orders/lookup`**, không lộ Order nội bộ/`TransitionError.Message`); rate-limit per-code (token-bucket); token sai/thiếu → uniform 404; `TRACKING_SECRET` fail-fast nếu forgeable; openapi additive + api-client regen staged; `make verify-go` xanh (Go test: token đúng→timeline, token tráo→404, constant-time) |
| **P2-h** | FE trang tĩnh `/chinh-sach`: đổi-trả policy + PDPL privacy notice | content | — | Route render return/exchange policy (đọc `settings.refund_policy` hoặc từ config P2-a) + privacy notice tiếng Việt (thu gì/mục đích/lưu/quyền), sentence case, i18n keys; version khớp `consentPolicyVersion` "2026-01"; là đích của consent link + đổi-trả pre-purchase; Vitest render |
| **P2-d** | FE C1: route `/thanh-toan` + form guest-first + fee/total live + **đổi-trả disclosure mọi đơn** | FE | P2-a, P2-b, P2-h | Guest vào `/thanh-toan`, đọc cart-store; form email(**optional**, không auto-tạo-account — xem note)+name(2–60 runes)+phone(`^(0\|\+84)\d{9}$` mirror `checkout.go:167`)+province(dropdown config)+ward+street(NO district)+note; chọn tỉnh → `/price/quote` hiện Tạm tính+Phí ship+Tổng qua PriceTag (ZERO client-math); tỉnh không map → error thân thiện; **đổi-trả summary (refundPolicy) + link `/chinh-sach` hiện cho MỌI cart** (compliance §3); consent notice PDPL unbundled + link `/chinh-sach` (KHÔNG bundle marketing, KHÔNG pre-tick); C2½ full-screen loading (§5); Vitest |
| **P2-e** | FE: engraving echo + no-return + prepay acks (ADR-012), **ADD-ON chỉ khi có khắc** | FE | P2-d | Cart có personalization → echo (text/zone từ cart state) + 2 checkbox bắt buộc ("Tôi hiểu hàng khắc không đổi trả"→`personalizationAck`; "Nội dung khắc đã đúng"→`engraveEchoConfirmed`) + prepay copy — **chồng LÊN** đổi-trả chung của P2-d (không thay thế); submit khoá tới khi cả 2 tick (mirror `checkout.go:219` → khách thấy nudge, không 400); không khắc → section vắng, 2 flag false; map đúng body `POST /orders`; Vitest |
| **P2-f** | FE C2: VietQR + proof upload + submit → `POST /orders` (double-submit disable + C2½ loading) | FE | P2-a, P2-b, P2-c, P2-d, P2-e, P2-i | E2E: guest quét QR (config vietqrUrl, memo optional plain-text KHÔNG trong QR), upload biên lai qua presigned POST (P2-c), confirm → `POST /orders` tạo `PENDING_CONFIRM` với proof + **giữ `trackingToken` từ 201** (P2-i, đưa sang P2-g); **C2½ ĐANG XỬ LÝ full-screen loading khi in-flight** (không chỉ disable button); submit disable khi in-flight (D-P2-7); không advance tới khi upload xong (tránh partial-commit); map 400/422 (`PROOF_REQUIRED`/`NO_SHIPPING_RULE`/`NO_STK_CONFIGURED`/client-money loud-reject) per-field qua ErrorEnvelope; ZERO client price; Vitest + 1 happy-path integration |
| **P2-g** | FE C3: wait-screen + confirmation (tokenized track, reuse P1-o auto-poll, **xử lý cả CANCELLED**) | FE | P2-f, P2-i | Sau 201: dwell → confirmation (mã `#LMN-xxxx`, status badge, **link copy phone-less `/o/{code}-{token}`** khớp hi-fi C3 dùng `trackingToken` P2-i; nút nhắn shop); wait-screen **reuse `order-lookup.tsx` poll + `OrderTimeline` + `isPollableStatus` + `orderStatus` i18n verbatim** nhưng poll qua **`GET /orders/track` (token, KHÔNG phone)** — flip `PENDING_CONFIRM→PAID` không refresh; **nhánh `PENDING_CONFIRM→CANCELLED` (biên lai bị từ chối, spec §04:163) có copy riêng** ("shop chưa nhận được CK / đơn đã huỷ — nhắn shop") + dừng terminal, không loop; fade transition; whitelist DTO (ADR-032) |

## 4 · BLOCKERs (owner-lock đã giải)

- **BLOCKER-A (gate P2-a):** ✅ D-P2-1 lock — VietQR = server-built `img.vietqr.io` URL từ STK.
- **BLOCKER-B (gate P2-c → P2-f):** ✅ D-P2-2 lock — ADR P2-c chốt **presigned POST** (không PUT), bucket riêng,
  **content-length-range ≤10MB + content-type policy**, **bucket CORS cho storefront origin**, **auto-delete 90d**,
  host-pin. Đây là mảnh net-new infra lớn nhất.
- **BLOCKER-C (gate P2-e/P2-f):** ✅ D-P2-3 lock — 100% prepay, KHÔNG migration, KHÔNG field mới.
- **BLOCKER-D (compliance, gate P2-d):** ✅ đổi-trả disclosure hiện **TRƯỚC khi mua cho MỌI đơn** (compliance §3
  bullet 1, Luật BVNTD 19/2023) — P2-d render refundPolicy chung; P2-e chỉ là add-on khắc. Trang đích `/chinh-sach`
  (P2-h) **phải tồn tại** để consent link (`consentPolicyVersion` 2026-01, compliance §2) + đổi-trả link không treo.
- **BLOCKER-F (gate P2-i):** `TRACKING_SECRET` phải fail-fast khi forgeable (dev-secret ký token capability → ai
  cũng theo dõi được đơn người khác) — reuse pattern `UsesForgeableJWTSecret` của auth (`checkout`/main.go).
- **BLOCKER-E (seed-data precondition, gate demo/launch — KHÔNG gate khởi động code):** `settings.bank_account`
  **VÀ** ≥1 `settings.shipping_rules` province phải cấu hình, nếu không **mọi** web checkout 422. Gate P2-a xử lý ca
  rỗng an toàn, nhưng demo/launch thật cần seed cả 2 (mutation seam admin đã có).

## 5 · Tightenings (fold vào PR liên quan)

- **IMPORTANT · estimate-parity CÓ KHẮC (P2-b):** `price.go:127` đã forward personalization qua `PriceItem` (parity
  ở line-price hôm nay đã đúng) — nhưng P2-b thêm shipping vào đường quote, dễ refactor lệch. Done-gate P2-b **phải**
  có Go test parity chạy **cart có personalization + tỉnh**, assert fee+subtotal+total y hệt `CreateOrderTx` charge.
  Đây là tường chắn "khách thấy sai tổng → tranh chấp" — cart không-khắc không phủ được surcharge khắc.
- **IMPORTANT · presigned POST size-enforce (P2-c):** presigned PUT **không** ràng buộc Content-Length (client tự
  khai) → cap ≤10MB vô hiệu. Dùng presigned **POST** với policy `content-length-range` + `content-type`; host-pin
  `finalUrl` về host Garage rồi mới `isHTTPProofURL`. Bucket cần CORS (origin storefront + method + header) hoặc
  browser upload fail.
- **IMPORTANT · token capability constant-time (P2-i):** verify `GET /orders/track` phải **constant-time compare**
  (hmac.Equal), uniform 404 khi token sai/thiếu (không phân biệt "đơn không tồn tại" vs "token sai" → không oracle);
  rate-limit per-code reuse token-bucket P1-n. `trackingToken` chỉ đưa cho client tạo đơn thành công (201), không lộ
  ở endpoint nào khác.
- **IMPORTANT · CANCELLED trên wait-screen (P2-g):** owner được reject biên lai → `PENDING_CONFIRM→CANCELLED`
  (spec §04:163, reason bắt buộc). Wait-screen KHÔNG chỉ lo happy `→PAID`: nhánh CANCELLED có copy riêng thân thiện
  ("shop chưa nhận CK / đơn huỷ — nhắn shop") + dừng terminal. `isPollableStatus` P1-o đã coi CANCELLED là terminal
  → chỉ cần copy, không logic poll mới.
- **IMPORTANT · đổi-trả unbundled khỏi khắc (P2-d vs P2-e):** disclosure chung (refundPolicy) ở P2-d cho mọi cart;
  2 tickbox ADR-012 ở P2-e là **add-on** khắc chồng lên, không thay. spec-guardian cảnh báo nếu P2-e nuốt disclosure
  chung.
- **IMPORTANT · consent unbundled (P2-d/P2-e):** consent `order_fulfillment` cấp trong `CreateOrderTx` idempotent;
  FE hiện notice + link `/chinh-sach` nhưng **KHÔNG** gộp checkbox marketing, **KHÔNG** pre-tick, **KHÔNG** gate mua
  (ADR-013, compliance §2).
- **NOTE · host bank name (P2-a/P2-f):** STK lưu `{bin, accountNumber, accountName}`; hi-fi C2 hiện "Vietcombank".
  Config P2-a trả bin (không tên bank). **Lazy: bỏ tên bank người-đọc**, hiện `accountName` ("LUMIN STUDIO") +
  `accountNumber` + để ảnh VietQR tự render bank. Owner muốn tên bank → thêm map bin→tên nhỏ FE-side (~chục bank VN),
  không endpoint mới. `ponytail:` — map defer tới khi owner yêu cầu.
- **NOTE · email optional (P2-d):** `checkout.go:287` coi email OPTIONAL (`Email != nil`). Hi-fi C1 vẽ "Email *" +
  tooltip auto-tạo-account. Auto-tạo-account **là feature bỏ khỏi Phase 2** → giữ email optional, không mark bắt buộc,
  không hứa tạo account. (Đối chiếu intent với owner nếu muốn account-on-checkout — sẽ là follow-up.)
- **NOTE · C2½ loading (P2-f):** hi-fi C2½ "ĐANG XỬ LÝ" là full-screen submit-loading (spinner + progress), KHÔNG
  phải disabled button. Fold vào loading-state P2-f để "đủ empty/loading/error" không bị đọc là chỉ disable.
- **NOTE · reuse P1-o verbatim (P2-g):** wait-screen KHÔNG viết poller mới — dùng `order-lookup.tsx` (cadence,
  terminal-stop, visibility-pause, backoff), `OrderTimeline`, `orderStatus` keys. Chỉ đổi nguồn poll sang
  `GET /orders/track` (token). Cadence giữ P1-o trừ khi có quyết mới (open Q).
- **NOTE · memo VietQR:** ADR-010 khoá memo optional + KHÔNG bake vào QR. FE hiện memo (nếu có) plain-text riêng,
  KHÔNG encode vào ảnh QR.
- **NOTE · migration numbering:** Phase 2 (100% prepay + HMAC token) **không cần migration** — điểm cắt scope lớn
  nhất. Nếu sau này cần revoke-token per-order (D-P2-8 upgrade) hoặc lật deposit biến thiên → migration phải >head
  hiện tại (monotonic memory), cấp số khi land.

## 6 · Open questions (còn lại — quyết khi tới PR)

> D-P2-1..9 đã lock (§1). Còn lại:
1. **Poll cadence (P2-g):** giữ 15s P1-o hay Phase-2 override? interval + max duration + backoff, tôn trọng
   token-bucket per-code (ADR-034). *(nhỏ — mặc định giữ P1-o trừ khi đo thấy cần đổi.)*
2. **Retention chi tiết (P2-c):** auto-delete 90d = mặc định lock; xác nhận cơ chế xoá (Garage lifecycle rule vs
   cron GC). *(ops-detail, quyết lúc dựng P2-c ADR.)*
3. **`trackingToken` trong lookup-by-phone?** `/orders/lookup` (phone) có nên cũng trả `trackingToken` để account
   page (P1-s) share link không? *(nhỏ — defer tới khi có nhu cầu; Phase-2 chỉ cần token ở 201.)*

## 7 · Nợ chất lượng của plan

- **ETA "3–5 ngày" là copy tĩnh** (D-P2-5): plan.md dòng 41 hứa "ETA hiện TRƯỚC commit" nhưng KHÔNG có nguồn ETA →
  không phát minh endpoint. Owner muốn ETA động per-region sau: thêm cột ETA cạnh `shipping_rules` (upgrade path),
  không phải Phase 2.
- **Double-submit residual (D-P2-7):** FE disable KHÔNG đóng ca 201-mất-sau-commit — `checkout.go:99-101` tự cảnh báo
  retry sẽ tạo `PENDING_CONFIRM` trùng + outbox event thứ hai cùng proof. Blast radius bounded (bank transfer thủ
  công = khách trả 1 lần; owner thấy 2 `PENDING_CONFIRM`, cancel 1). **Cần owner reconcile-dupe runbook** (1 trang:
  nhận diện dup theo cart+customer+proof, cancel bản thừa với reason). ADR-033 tự nói revisit "khi storefront-checkout
  đẻ retry thật" — chính slice này.
- **Token capability revoke:** HMAC token (D-P2-8) KHÔNG revoke per-order được (deterministic theo secret). Rò 1
  token = rò 1 đơn (blast radius = 1, chỉ đọc timeline public). Rotate `TRACKING_SECRET` = vô hiệu **mọi** link cũ.
  `ponytail:` — cột `orders.tracking_token` random + revoke chỉ thêm khi có nhu cầu thật (audit/abuse).
- **Trang `/chinh-sach` version-drift:** `consentPolicyVersion="2026-01"` hard-code (`checkout.go:163`). Khi sửa text
  privacy/return → bump cả hằng + trang. Không CMS (`ponytail:` static i18n content, thêm CMS khi shop cần sửa thường
  xuyên).
- **Orphan-upload GC + encryption-at-rest cho proof:** follow-up (không block checkout). `ponytail:` — cron GC defer,
  add khi orphan tích tụ thật hoặc audit PDPL yêu cầu.
- **Bin→bank-name map:** defer (NOTE §5); add khi owner muốn tên bank người-đọc cạnh QR.
- **Visual-fidelity:** trước P2-d..h đọc `designs/Lumin Storefront - Hi-fi.dc.html §06` (C1 THÔNG TIN → C2 THANH
  TOÁN → C2½ ĐANG XỬ LÝ → C3 ĐƠN SẴN SÀNG). Lưu ý design **thiếu** echo-step + 2 tickbox ADR-012 → P2-e bù; design
  vẽ Email bắt buộc + auto-account → plan **cố ý lệch** (D-P2-9/note email), đừng copy y. Link phone-less C3 **giờ
  KHỚP** design (D-P2-8 owner-lock DỰNG).

## 8 · Done criteria (Phase 2) — theo plan.md

Checkout guest-first chạy trọn trên mobile: nhập địa chỉ VN (province/ward/street, no district) → thấy phí ship +
tổng **server-authoritative TRƯỚC khi commit** → **đổi-trả policy hiện cho mọi đơn** (+ nếu khắc: echo nội dung + 2
tickbox no-return/prepay chồng lên) → quét VietQR tĩnh (dựng server-side từ STK, chống tráo) → upload ảnh biên lai
(**presigned POST** Garage, size-enforced, host-pinned, auto-delete 90d) → xác nhận tạo `PENDING_CONFIRM` với proof
(MỘT tx, ADR-006) → confirmation có **link theo dõi phone-less `/o/{code}-{token}`** (HMAC capability) → wait-screen
auto-poll qua `GET /orders/track` (token, không phone) flip `PAID` không refresh (reuse P1-o), **và xử lý nhánh
CANCELLED (biên lai bị từ chối) với copy riêng**. Cụ thể: money int-VND chỉ qua core formatter, ZERO client-math,
estimate==charge kể cả cart khắc (test parity); missing-STK → 422 thân thiện; consent unbundled không pre-tick + link
`/chinh-sach` (trang tồn tại); token capability constant-time + uniform 404 + `TRACKING_SECRET` fail-fast;
double-submit chặn FE + owner reconcile-dupe runbook (residual 201-mất ghi rõ); mọi màn đủ empty/loading/error (gồm
C2½ full-screen); visual-fidelity vs hi-fi §06 (trừ email/auto-account cố ý lệch); xương sống Phase-1
(pricing/statusHistory/consent/outbox) KHÔNG bị chạm — chỉ invoke.
