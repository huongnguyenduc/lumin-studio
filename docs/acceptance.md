# Acceptance ledger — Lumin Studio

> **Mục đích:** acceptance criteria **máy-kiểm-được** cho 3 cụm bất biến xương sống, viết kiểu **EARS**
> (`WHEN <điều kiện>, the system shall <hành vi>`), mỗi dòng gắn **một test id** và bắt đầu **chưa tick** `[ ]`.
> Đây là dạng kiểm-được-bằng-máy của "Test P0" trong [`plan.md`](plan.md) — **không** phải nguồn chân lý mới
> (nguồn vẫn là `spec.md` §02/§04 + `conventions.md`). Bổ sung ADR-023.

> **Cách dùng (deterministic, không advisory):**
> - Một dòng được tick `[x]` **chỉ khi** test id liên kết đã tồn tại và **đang pass**.
> - **Phase-0 TODO:** thêm `packages/core` test `acceptance.ledger.test.ts` parse file này và **fail** nếu một dòng
>   `[x]` có test id không resolve được / không pass. Khi test đó tồn tại, `verify-before-stop` tự ép qua green-suite gate
>   — ledger trở thành cổng chặn thật, không chỉ là checklist.
> - `spec-guardian` chỉ **WARN** nếu một dòng có vẻ chưa được test (LLM enforce phủ định yếu); **test mới là gate**.
> - **EARS-per-feature (ADR-027):** feature có hành vi-invariant thật → lúc duyệt plan, append 1-3 dòng EARS +
>   test-id MỚI vào file này (đừng để ledger đứng yên ở 3 cụm Phase-0). Backbone (money/state) nên là
>   **property-test** generative + **mutation kill-gate** (ADR-027 · `plan.md` ARM).

## Cụm 1 — Order state machine (`spec.md` §04 · `domain-core.md`)

- [x] `OSM-01` — WHEN một đơn đổi trạng thái (mọi cặp `from × to`), the system shall đi qua **transition guard** chung và
  từ chối transition không hợp lệ. *(test: `order_state.transition_table`)*
- [x] `OSM-02` — WHEN bất kỳ transition hợp lệ nào xảy ra, the system shall **append** `statusHistory {from, to, at, byUser}`
  (đúng một bản ghi). *(test: `order_state.appends_status_history`)*
- [x] `OSM-03` — WHEN đơn chuyển sang `CANCELLED` hoặc `REFUNDED`, the system shall **bắt buộc** `reason` không rỗng (và `REFUNDED` cần `refundProofUrl`).
  *(test: `order_state.cancel_refund_requires_reason`)*
- [x] `OSM-04` — WHEN một staff (không phải owner) cố `reconcile → PAID`, the system shall **từ chối** (owner-only, ADR-010).
  *(test: `order_state.reconcile_paid_owner_only`)*
- [x] `OSM-05` — WHEN transition guard chạy theo `role`, the system shall enforce RBAC cho mọi (from, to, role) — staff
  không sửa cài đặt/STK. *(test: `order_state.rbac_matrix`)*

## Cụm 2 — Tiền (`conventions.md` §Tiền · ADR-019)

- [x] `MNY-01` — WHEN tính tổng đơn, the system shall tính ở **server** và đảm bảo `sum(parts) == total` (int VND, không
  thập phân). *(test: `money.parts_sum_equals_total`)*
- [x] `MNY-02` — WHEN client gửi `total`, the system shall **bỏ qua/ từ chối** giá trị đó và tính lại từ parts.
  *(test: `money.rejects_client_total`)*
- [x] `MNY-03` — WHEN format tiền hiển thị, the system shall dùng **một** formatter trong `packages/core` → `390.000₫`
  (không space, U+20AB); không nơi nào khác gọi `Intl.NumberFormat`/`toLocaleString`. *(test: `money.single_formatter` +
  ESLint `no-restricted-syntax`)*

## Cụm 3 — Checkout / thanh toán (`spec.md` §Order lifecycle · ADR-010)

- [x] `CHK-01` — WHEN khách ở màn QR tĩnh chưa đính ảnh CK, the system shall **chưa** tạo đơn. *(test:
  `checkout.no_order_before_proof`)*
- [x] `CHK-02` — WHEN khách đính ảnh biên lai + bấm xác nhận, the system shall `POST /orders` tạo đơn ở `PENDING_CONFIRM`
  kèm ảnh CK. *(test: `checkout.creates_order_on_proof`)*
- [x] `CHK-03` — WHEN tạo đơn hàng cá nhân hoá, the system shall yêu cầu tickbox "không đổi trả" + bước echo nội dung khắc
  **trước** thanh toán (ADR-012). *(test: `checkout.personalized_requires_ack`)*

## Cụm 4 — Relay outbox→NATS (`ADR-029` · `domain-core.md` §Outbox · `docs/plans/core-http-relay.md`)

> **Go-gated — CỐ Ý để `[ ]` ở ledger TS.** Parser `packages/core/test/acceptance.ledger.test.ts` chỉ enforce dòng
> `[x]` và **chỉ resolve test id TS** (`it()/test()` trong `packages/**/*.test.ts`); test của `REL-*` là **Go**
> (`services/core-api/internal/relay`), parser không thấy được → tick `[x]` sẽ làm parser ĐỎ (plan §5: cross-language
> id resolution out-of-scope của parser). Vậy `REL-*` GIỮ `[ ]` ở ledger này — **gate thật** là
> `tests/harness/guard.test.sh §ARM-GUARD` (khoá quét-tập-pending + relay-start-in-`main.go`) **+** chính các test Go
> đó (đã RAN xanh vs PG+NATS thật). `[ ]` ở đây = "không do parser-TS gác", KHÔNG phải "chưa test".

- [ ] `REL-01` — WHEN một dòng outbox đã commit ở `status='pending'` (kể cả tx seq-thấp commit **muộn** sau tx seq-cao đã publish), the system shall publish nó lên NATS JetStream bằng cách **quét cả TẬP pending `ORDER BY seq`**
  — KHÔNG watermark `seq>cursor`, KHÔNG `SKIP LOCKED` — theo thứ tự `publish → await PubAck → mark-published`, không
  mất event tiền. *(test: `relay.TestRelayLateLowSeqDrains` + `relay.TestRelayDrainsPendingToStream`)*
- [ ] `REL-02` — WHEN NATS unreachable hoặc stream chưa provision (no-responders), the system shall coi là **transient**:
  để cả batch `pending`, **KHÔNG** tăng `attempts`, re-ensure topology, drain khi NATS hồi (accept-downtime, ADR-009) —
  phân biệt với **poison** (PubAck reject trên broker reachable → `attempts++` → `failed` sau `RelayMaxAttempts`, không
  chặn head-of-line). *(test: `relay.TestRelayNoStreamTransientThenRecovers` + `relay.TestDrainTransientLeavesBatchPendingNoAttempts` + `relay.TestDrainPoisonQuarantinedAfterMaxAttempts`)*

## Cụm 5 — HTTP error envelope (`ADR-032` · `docs/plans/core-http-relay.md` §3d)

> **Go-gated — CỐ Ý để `[ ]`** (cùng lý do Cụm 4): test của `ERR-*` là **Go** (`services/core-api/internal/httpapi`),
> parser TS không resolve được → tick `[x]` sẽ làm parser ĐỎ. **Gate thật** = `guard.test.sh §ARM` (khoá router wire
> custom error hook + `mapError` map `TransitionError`) **+** chính các test Go đó. `[ ]` = "không do parser-TS gác".

- [ ] `ERR-01` — WHEN một domain error nổi lên biên HTTP (`*order.TransitionError` / `db.Err*` / `money.ErrInvalidAmount`), the system shall trả về **một `ErrorEnvelope {code, messageKey, fields?}`** (ADR-032) ở đúng status ánh xạ
  (`INVALID_EDGE`→409 · `RBAC`→403 · `REASON/REFUND/PROOF_REQUIRED`+`NO_ITEMS`+`INVALID_*`→422 · `NOT_FOUND`→404 ·
  `INVALID_ACTOR/TIMESTAMP`→400 · unmapped→500) và **KHÔNG BAO GIỜ** forward `TransitionError.Message` tiếng Việt ra wire
  (always-must #3 i18n; client map `messageKey`→next-intl). *(test: `httpapi.TestMapErrorTable` +
  `httpapi.TestMapErrorNeverLeaksDomainMessage` + `httpapi.TestDomainRouteReturns501Envelope`)*

## Cụm 6 — Auth self-issued login (`ADR-030` · `docs/plans/core-http-relay.md` §3e-1)

> **Go-gated — CỐ Ý để `[ ]`** (cùng lý do Cụm 4/5): test của `AUTH-*` là **Go**
> (`services/core-api/internal/{auth,httpapi,db}`), parser TS không resolve được → tick `[x]` sẽ làm parser ĐỎ. **Gate
> thật** = `guard.test.sh §ARM` (cookie HttpOnly + bcrypt-compare + `VerifyPassword(nil)` nhánh unknown-email) **+**
> chính các test Go đó (RAN Docker-free + vs PG thật). `[ ]` = "không do parser-TS gác", KHÔNG phải "chưa test".

- [ ] `AUTH-01` — WHEN một email không tồn tại **hoặc** mật khẩu sai gửi tới `POST /auth/login`, the system shall trả về **cùng một 401 đồng nhất** (unknown-email không phân biệt được với wrong-password — chống user-enumeration), luôn chạy đúng một lần bcrypt-compare để equalize timing, và **KHÔNG** set session cookie. *(test: `httpapi.TestLoginWrongPasswordUniform401` + `httpapi.TestLoginUnknownEmailUniform401` + `auth.TestVerifyPassword`)*
- [ ] `AUTH-02` — WHEN đăng nhập thành công, the system shall phát JWT ký (`sub`=users.id, `role`, `exp`=now+TTL) đặt trong cookie **httpOnly+Secure+SameSite** (token ngoài tầm JS — chống XSS-theft) và **KHÔNG** đưa token vào response body. *(test: `auth.TestIssueSetsSecureHttpOnlyCookie` + `auth.TestIssuedTokenCarriesClaims` + `httpapi.TestLoginSuccessSetsHttpOnlyCookieTokenNotInBody`)*

## Cụm 7 — Auth boundary + RBAC (`ADR-030` · `docs/plans/core-http-relay.md` §3e-2)

> **Go-gated — CỐ Ý để `[ ]`** (cùng lý do Cụm 4/5/6): test của `RBA-*` là **Go**
> (`services/core-api/internal/httpapi`), parser TS không resolve được → tick `[x]` sẽ làm parser ĐỎ. **Gate thật** =
> `guard.test.sh §ARM` (router wire `authMiddleware` không-nil + `resolveActor` `auth.Verify` + role đọc từ `UserByID`)
> **+** chính các test Go đó. `[ ]` = "không do parser-TS gác", KHÔNG phải "chưa test".

- [ ] `RBA-01` — WHEN một request tới một admin endpoint mà thiếu/hỏng session cookie **hoặc** mang vai trò không đủ (staff chạm owner-only `PATCH /admin/settings/bank-account`), the system shall **từ chối ở biên HTTP** trước khi vào handler — 401 `UNAUTHORIZED` khi thiếu/hỏng credential (token verify chữ ký+expiry, role đọc từ `users` row không tin claim), 403 `FORBIDDEN` khi credential hợp lệ nhưng role không đủ — và op chưa phân loại **fail-closed** (mặc định require actor). *(test: `httpapi.TestAuthMiddlewareRequiredRejectsMissingCookie` + `httpapi.TestAuthMiddlewareOwnerOnlyRejectsStaff` + `httpapi.TestClassifyFailsClosed` + `httpapi.TestAdminRouteUnauthenticatedReturns401Envelope`)*

## Cụm 8 — Order-intake pricing (`ADR-019` · `docs/plans/core-http-relay.md` §3f)

> **Go-gated — CỐ Ý để `[ ]`** (cùng lý do Cụm 4/5/6/7): test của `PRC-*` là **Go**
> (`services/core-api/internal/pricing`), parser TS không resolve được → tick `[x]` sẽ làm parser ĐỎ. **Gate thật** =
> `guard.test.sh §ARM` (pricing derive `BasePrice`+`PriceDelta`, `Selection` không mang giá client, mã đơn qua
> `nextval('order_code_seq')`) **+** chính các test Go đó (unit + property, RAN Docker-free). `[ ]` = "không do parser-TS gác".

- [ ] `PRC-01` — WHEN một dòng đơn được định giá lúc checkout, the system shall **tính `unitPrice` phía server** từ catalog (`base_price` + delta màu + Σ delta option) và **KHÔNG BAO GIỜ** tin giá client gửi (`Selection` không có trường giá), đồng thời từ chối lựa chọn không hợp lệ — màu/option không thuộc sản phẩm, màu `available:false`, option trùng, hoặc text khắc vượt `maxChars` (đếm theo rune) — trước khi đơn được tạo (ADR-019). *(test: `pricing.TestPriceItemIsSumOfCatalogParts` + `pricing.TestPriceItemRejectsInvalidSelection` + `pricing.TestPriceItemEngraveBoundary`)*
- [ ] `PRC-02` — WHEN phí vận chuyển được tính cho một địa chỉ, the system shall **tra `shippingFee` phía server** từ `settings.shipping_rules` theo `province` (khớp chính xác, hoặc rule `"*"` mặc định — KHÔNG có cấp quận/huyện, ADR-017) và trả lỗi (→422) khi không rule nào khớp thay vì âm thầm tính phí 0. *(test: `pricing.TestShippingFee` + `pricing.TestShippingFeeNoMatch` + `pricing.TestShippingFeeRejectsMalformed`)*

## Cụm 9 — Order transitions (`docs/plans/core-http-relay.md` §3h · locked #9 · §6 D12)

> **Go-gated — CỐ Ý để `[ ]`** (cùng lý do Cụm 4/5/6/7/8): test của `PAY-*`/`SHP-*` là **Go**
> (`services/core-api/internal/{httpapi,db}`), parser TS không resolve được → tick `[x]` sẽ làm parser ĐỎ. **Gate
> thật** = `guard.test.sh §ARM` (transition.go route money-in qua `ConfirmPaymentTx` + owner-gate biên `order.RoleOwner` +
> SHIPPING `SetTrackingCodeTx`) **+** chính các test Go đó (unit Docker-free + integration vs PG thật). `[ ]` = "không do parser-TS gác".

- [ ] `PAY-01` — WHEN owner đối soát `PENDING_CONFIRM→PAID` qua `POST /orders/{id}/transitions`, the system shall route qua **`ConfirmPaymentTx`** (emitter `order.paid` **DUY NHẤT**) phát **đúng một** `order.paid`, trong khi **mọi edge khác** đi `AdvanceStatusTx` và **KHÔNG** phát `order.paid` (footgun dispatch — locked #9), và **từ chối `staff` reconcile 403 ở biên** (`ConfirmPaymentTx` cố định `role=owner` nên domain guard không tự chặn). *(test: `httpapi.TestTransitionWalkEmitsPaidOnceAndPersistsTracking` + `httpapi.TestTransitionStaffReconcileForbidden`)*
- [ ] `SHP-01` — WHEN chuyển `PRINTING→SHIPPING`, the system shall **bắt buộc `trackingCode` không rỗng** (spec §04; thiếu → **422 `TRACKING_CODE_REQUIRED`** ở biên trước tx) và persist mã vào `orders.tracking_code` **trong CÙNG tx** với flip trạng thái (atomic — không bao giờ SHIPPING mà thiếu mã); QC packing-photo hoãn cùng upload surface (§0). *(test: `httpapi.TestTransitionWalkEmitsPaidOnceAndPersistsTracking` + `httpapi.TestTransitionShippingRequiresTrackingCode` + `db.TestSetTrackingCode`)*

## Cụm 10 — Checkout / order intake (`docs/plans/core-http-relay.md` §3g · critique BLOCKER · CHK-04/05)

> **Go-gated — CỐ Ý để `[ ]`** (cùng lý do Cụm 4/5/6/7/8/9): test của `CHK-*` là **Go**
> (`services/core-api/internal/httpapi`), parser TS không resolve được → tick `[x]` sẽ làm parser ĐỎ. **Gate thật** =
> `guard.test.sh §ARM` (checkout.go derive giá qua `pricing.PriceItem` + phí qua `pricing.ShippingFee` + inbox gate
> `errForbidden` + một seam `CreateOrderTx`) **+** chính các test Go đó (unit Docker-free + integration vs PG thật). `[ ]` = "không do parser-TS gác".

- [ ] `CHK-04` — WHEN khách tạo đơn web qua `POST /orders`, the system shall **bắt buộc `paymentProofUrl` là URL http(s) đúng `finalUrl` host/path/key-prefix do server upload signer cấu hình, kiểm tại HTTP boundary trước mọi DB read** (thiếu/malformed/foreign host/path → **422 `PROOF_REQUIRED`**), và đơn hợp lệ sinh ra ở `PENDING_CONFIRM` với genesis statusHistory `{from:null, to:PENDING_CONFIRM, byUser:"customer"}` cho guest (sentinel documented — ngoại lệ locked #6), tiền tính hoàn toàn phía server (client gửi `unitPrice`/`total`/`subtotal`/`shippingFee` → **400 loud-reject**, không âm thầm bỏ qua). *(test: `httpapi.TestCreateOrderWebRequiresPaymentProof` + `httpapi.TestCreateOrderWebRequiresHostPinnedPaymentProof` + `httpapi.TestCreateOrderRejectsClientMoneyFields` + `httpapi.TestCreateOrderWebEndToEnd`)*
- [ ] `CHK-05` — WHEN caller gửi `channel=inbox` tới `POST /orders`, the system shall **từ chối 403 FORBIDDEN trừ khi middleware optional-auth đã resolve một actor staff/owner** (inbox mint đơn born-`PAID` không cần proof — money-creation primitive, critique BLOCKER), và đơn inbox hợp lệ sinh ra `PAID` + stamp `payment_confirmed_at` + phát **đúng một** `order.created`, **KHÔNG** `order.paid` (born-PAID là creation, không phải reconcile). *(test: `httpapi.TestCreateOrderInboxRequiresStaffActor` + `httpapi.TestCreateOrderInboxAnonymousWire` + `httpapi.TestCreateOrderInboxStaffEndToEnd`)*

## Cụm 11 — Dashboard net revenue (`docs/plans/core-http-relay.md` §3i · spec §04)

> **Go-gated — CỐ Ý để `[ ]`** (cùng lý do Cụm 4..10): test của `DASH-*` là **Go**
> (`services/core-api/internal/{db,httpapi}`), parser TS không resolve được → tick `[x]` sẽ làm parser ĐỎ. **Gate thật**
> = `guard.test.sh §ARM` (dashboard.sql net-revenue theo `payment_confirmed_at` + loại `REFUNDED` + handler `hcmDayBounds`)
> **+** chính các test Go đó (unit Docker-free + integration vs PG thật). `[ ]` = "không do parser-TS gác".

- [ ] `DASH-01` — WHEN dashboard tính doanh thu hôm nay ở `GET /admin/dashboard`, the system shall cộng `total` của các đơn có `payment_confirmed_at` rơi trong NGÀY hôm nay (`Asia/Ho_Chi_Minh` UTC+7, cửa sổ nửa-mở `[start,end)` — anchor theo NGÀY THU TIỀN, KHÔNG theo ngày tạo, KHÔNG cắt UTC-midnight) và **loại** `REFUNDED` (giữ `CANCELLED`-sau-PAID vì shop giữ tiền, spec §04), **KHÔNG** dùng `status IN (…)` ngây thơ (rớt doanh thu CANCELLED-sau-PAID); `newOrdersToday` anchor theo ngày TẠO; zero-state trả 0 và `recentOrders` `[]` không rỗng (spec §03). *(test: `db.TestDashboardNetRevenue` + `db.TestDashboardWindowBoundary` + `httpapi.TestHcmDayBounds` + `httpapi.TestBuildDashboardSnapshot` + `db.TestDashboardZeroState`)*

## Cụm 12 — Admin settings / STK (`docs/plans/core-http-relay.md` §3k · conventions §57 · ADR-012)

> **Go-gated — CỐ Ý để `[ ]`** (cùng lý do Cụm 4..11): test của `STK-*` là **Go**
> (`services/core-api/internal/httpapi`), parser TS không resolve được → tick `[x]` sẽ làm parser ĐỎ. **Gate thật** =
> `guard.test.sh §ARM` (settings.go đổi STK qua `UpdateBankAccountTx` audit-on-commit + owner-gate `order.RoleOwner` +
> `changed_by` từ `actorFrom(ctx)` không body) **+** chính các test Go đó (unit Docker-free + integration vs PG thật). `[ ]` = "không do parser-TS gác".

- [ ] `STK-01` — WHEN owner đổi STK qua `PATCH /admin/settings/bank-account`, the system shall (a) chỉ cho **owner** ghi — staff bị chặn **403** ở biên `authOwnerOnly` **và** handler tự re-assert `order.RoleOwner` (defense-in-depth vì STK là money-out cao-giá-nhất — bad STK reroute mọi tiền khách), (b) validate VietQR field shape ngay tại HTTP boundary trước cả body-processing (`bin` **đúng 6 chữ số** napas, `accountNumber` toàn chữ số ≤19, `accountName` non-empty sau trim → **400 per-field loud-reject** — money-out field server render QR tĩnh, STK rác phải bị chặn), (c) ghi qua **`UpdateBankAccountTx`**: cột `settings.bank_account` **+** một row `setting_bank_audit` append-only trong **CÙNG một tx** (đổi STK không bao giờ land mà thiếu audit trail — conventions §57), và (d) `changed_by` lấy từ **actor context** (users.id) **KHÔNG** từ body. *(test: `httpapi.TestUpdateBankAccountEndToEnd` + `httpapi.TestUpdateBankAccountRejectsNonOwner` + `httpapi.TestCleanBankUpdate`)*

## Cụm 13 — Storefront catalog read (`docs/plans/phase-1-storefront.md` §2 · P1-a/P1-c/P1-d/P1-e)

> **Go-gated — CỐ Ý để `[ ]`** (cùng lý do Cụm 4..12): test của `CAT-*` là **Go**
> (`services/core-api/internal/httpapi` + `internal/contract`), parser TS không resolve được → tick `[x]` sẽ làm parser ĐỎ.
> **Gate thật** = `guard.test.sh §ARM` (CAT-01: active-only `db.ErrNotFound` non-leak + classify `authPublic`; CAT-02:
> list active-only tại SQL `ListActiveProducts status='active'` + `maxPageSize` bound + classify `GetProducts` authPublic; CAT-03:
> classify `GetCategories` authPublic **+** `ListCategories` scope active-product tại SQL (`EXISTS ... status='active'` — non-leak, category chỉ-chứa-hàng-ẩn không rò); CAT-04:
> search predicate TRONG cùng query active-only (`ListActiveProducts` giữ `status='active'` + `plainto_tsquery` + `immutable_unaccent` → search không leak hàng ẩn) + `maxSearchLen` bound) **+**
> `TestProductStatusParity`/`TestOptionTypeParity` (OpenAPI↔Postgres) **+** chính các test Go đó (unit Docker-free + integration vs PG thật). `[ ]` = "không do parser-TS gác".

- [ ] `CAT-01` — WHEN một client GET `/products/{slug}` công khai (không cần session), the system shall trả sản phẩm **active** kèm `colors[]` + `options[]` (giá int-VND thô `basePrice`/`priceDelta` — **KHÔNG** format phía server, always-must #2), và trả **404 `NOT_FOUND` đồng nhất** khi slug không tồn tại **hoặc** sản phẩm `draft`/`archived` (không phân biệt hàng ẩn với hàng không tồn tại — chống probe tồn-tại catalog), **KHÔNG** kèm `productType` (D-P1-1). *(test: `httpapi.TestGetProductBySlugEndToEnd` + `httpapi.TestProductDTO` + `httpapi.TestAuthMiddlewarePublicCatalogRunsWithoutCookie` + `contract.TestProductStatusParity`)*
- [ ] `CAT-02` — WHEN một client GET `/products` công khai (không cần session), the system shall trả **chỉ sản phẩm `active`** dưới dạng **card projection** phân trang (giá int-VND thô `basePrice` — **KHÔNG** format phía server always-must #2; **KHÔNG** colors/options/description → không N+1), **KHÔNG** để lộ `draft`/`archived` (lọc `status='active'` tại nguồn SQL — chống probe tồn-tại catalog như detail), lọc theo **category slug** (slug lạ → trang rỗng, **KHÔNG** 404; `category=`/`sort=` rỗng hoặc bỏ trống ⇒ coi như **bỏ lọc / sort mặc định** = tất cả·newest, không phải trang rỗng/400), sort theo **whitelist** (`newest`/`price_asc`/`price_desc`/`rating` — không bao giờ đưa text client thô vào `ORDER BY`), phân trang **có chặn** (`pageSize` ≤ 48 → quá-cap là **400 `VALIDATION`**, chống DoS trên endpoint public không rate-limit; offset trang-quá-xa không tràn), và hỗ trợ **conditional GET** (weak `ETag` + `Cache-Control`; `If-None-Match` khớp → **304** không body). *(test: `httpapi.TestGetProductsEndToEnd` + `httpapi.TestGetProductsRejectsBadParamsWithoutDB` + `httpapi.TestPageParams` + `httpapi.TestSortParam` + `httpapi.TestProductCardsDTO` + `httpapi.TestWeakETagDeterministicAndSensitive` + `httpapi.TestIfNoneMatch`)*
- [ ] `CAT-03` — WHEN một client GET `/categories` công khai (không cần session), the system shall trả **taxonomy category BROWSABLE** (mỗi category = `id`/`slug`/`name`; **chỉ** category có ≥1 hàng `active` — lọc `EXISTS ... status='active'` tại nguồn SQL) theo thứ tự **name→slug** (tổng-thứ-tự ổn định để `ETag` không nhảy), **KHÔNG** để lộ category chỉ-chứa `draft`/`archived` hoặc rỗng (chống dead-end chip + rò tên category chưa phát-hành — cùng non-leak như CAT-01/02), coi **không có category browsable là `[]`** (**KHÔNG** 404, **KHÔNG** `null` — spec §03 zero-state), giữ endpoint **public** (classify `authPublic` — chip duyệt không kẹt sau tường auth admin; không mang tiền), và hỗ trợ **conditional GET** (weak `ETag` + `Cache-Control` — cùng hình caching với `/products`; `If-None-Match` khớp → **304** không body). *(test: `httpapi.TestGetCategoriesEndToEnd` + `httpapi.TestCategoriesDTO`)*
- [ ] `CAT-04` — WHEN một client GET `/products?q=<term>` công khai (không cần session), the system shall **lọc catalog theo tìm-kiếm no-dấu** (ADR-016) trên **name + description** — "den" khớp "đèn" (fold dấu 2 phía qua `immutable_unaccent` migration 000012, **kể cả đ/Đ** — chữ có gạch không phân rã Unicode nên `translate` tường minh), term đi qua **`plainto_tsquery`** (KHÔNG nội suy text client thô vào SQL — cùng lẽ whitelist sort), predicate **ANDed TRONG scope active-only tại nguồn SQL** (search **KHÔNG BAO GIỜ** để lộ `draft`/`archived` — cùng non-leak như CAT-01/02/03), coi `q` rỗng/space là **bỏ tìm-kiếm** (toàn catalog, không phải trang rỗng), term **chặn độ dài** (`maxSearchLen`=100 rune → quá-cap **400 `VALIDATION`**, chống DoS/nội-suy trên endpoint public không rate-limit), giữ **sort/paginate/ETag không đổi** (envelope `total` phản ánh tập đã-tìm; **KHÔNG** relevance-rank — catalog nhỏ, tránh mở contract enum sort), classify **`authPublic`**. *(test: `httpapi.TestGetProductsSearch` [integration real-PG: đ-fold + active-only non-leak + AND category + description-searched + ETag-varies] + `httpapi.TestSearchParam` + `httpapi.TestGetProductsRejectsBadParamsWithoutDB` [q-over-cap→400])*

## Cụm 14 — Storefront price quote (`docs/plans/phase-1-storefront.md` §2 · P1-b · `docs/plans/phase-2-checkout.md` P2-b)

> **Go-gated — CỐ Ý để `[ ]`** (cùng lý do Cụm 13): test của `QTE-*` là **Go**
> (`services/core-api/internal/httpapi`), parser TS không resolve được → tick `[x]` sẽ làm parser ĐỎ.
> **Gate thật** = `guard.test.sh §ARM` (oapi stale-check + parity + testcontainers-boot, generic) **+**
> chính các test Go (unit Docker-free `priceQuoteLine`/`quoteTotals`/pre-DB + integration vs PG thật,
> chứng minh `authPublic` không cookie + `PRODUCT_UNAVAILABLE` non-leak + `messageKey` đúng).

- [ ] `QTE-01` — WHEN một client POST `/price/quote` công khai (không cần session) với một hoặc nhiều `items` (mỗi item = `OrderItemInput`, **KHÔNG** mang giá), the system shall **tính `unitPrice`/`lineTotal` mỗi dòng + `subtotal` phía server** từ catalog qua `pricing.PriceItem` (int-VND thô, **KHÔNG** shipping/address/tax, **KHÔNG** format phía server, always-must #2), từ chối lựa chọn không hợp lệ (màu/option lạ, `available:false`, trùng, khắc vượt `maxChars` đếm theo rune) → **422** kèm `messageKey` (KHÔNG lộ prose miền, ADR-032), coi sản phẩm không tồn tại/không `active` là **422 `PRODUCT_UNAVAILABLE`** đồng nhất (chống probe catalog), và giới hạn `items` ≤ 50 (chống khuếch-đại DoS trên endpoint public không rate-limit) → over-cap/empty/nil-body là lỗi shape (**400 `VALIDATION`** / **422 `NO_ITEMS`**). *(test: `httpapi.TestQuotePriceEndToEnd` + `httpapi.TestQuotePriceRejectionsEndToEnd` + `httpapi.TestPriceQuoteLineRejectsInvalidSelection` + `httpapi.TestQuoteTotalsCrossLineOverflow` + `httpapi.TestQuotePricePreDBRejections`)*
- [ ] `QTE-02` — WHEN một client POST `/price/quote` kèm `province` (P2-b), the system shall **gấp phí ship + tổng phía server** — tra `settings.shipping_rules` qua **`pricing.ShippingFee`** (cùng authority như checkout charge path) rồi `money.CalcTotals` → thêm `shippingFee`+`total` (int-VND thô), coi tỉnh không có rule (và không `*` wildcard) là **422 `NO_SHIPPING_RULE`** kèm `messageKey` (**KHÔNG** silent ₫0), coi `province` vắng/blank là **chỉ line/subtotal — byte-identical** pre-P2-b (`shippingFee`/`total` omitempty giữ nil), và giữ **PARITY**: money của quote **== số tiền `POST /orders` charge** cho cùng cart+tỉnh (kể cả surcharge khắc) vì cùng `money.LineItem{UnitPrice,Quantity}`+fee đi qua `money.CalcTotals` mà `CreateOrderTx.lineItems` chạy. *(test: `httpapi.TestQuotePriceParityWithOrder` [integration real-PG: cart CÓ KHẮC, quote==order field-by-field] + `httpapi.TestQuotePriceProvinceNoRule` [422 no-rule] + `httpapi.TestQuotePriceEndToEnd` [no-province nil-shipping byte-identical] + `httpapi.TestQuoteTotalsSumsLineTotals` [unit fold-fee])*

## Cụm 15 — Storefront guest order lookup (`docs/plans/phase-1-storefront.md` §2 · P1-n)

> **Go-gated — CỐ Ý để `[ ]`** (cùng lý do Cụm 13/14): test của `LKP-*` là **Go**
> (`services/core-api/internal/httpapi`), parser TS không resolve được → tick `[x]` sẽ làm parser ĐỎ.
> **Gate thật** = `guard.test.sh §ARM` (LKP-01: `subtle.ConstantTimeCompare` so SĐT + uniform `db.ErrNotFound`
> cho code-lạ==SĐT-sai non-leak + per-code token-bucket throttle `s.lookup.allow` + classify `LookupOrder` authPublic ·
> TRK-01: `hmac.Equal` constant-time verify token + `s.lookup.allow` per-code + main.go fail-fast `UsesForgeableTrackingSecret`)
> **+** chính các test Go đó (unit Docker-free limiter/DTO/normalize/429/signer + integration vs PG thật). `[ ]` = "không do parser-TS gác".

- [ ] `LKP-01` — WHEN một khách GET `/orders/lookup?code=&phone=` công khai (không cần session), the system shall yêu cầu **CẢ `code` LẪN `phone` khớp** — trả **404 `NOT_FOUND` byte-đồng-nhất** cho code lạ **HOẶC** SĐT sai (không phân biệt đơn tồn-tại — chống enumerate mã đơn), so sánh SĐT **constant-time** (`subtle.ConstantTimeCompare`, chạy dummy-compare cả trên nhánh code-miss để timing không rò — pattern AUTH-01), áp **token-bucket per-code** (429 `RATE_LIMITED`, `s.lookup.allow` trước khi đọc DB) chống dò SĐT của một mã đã biết (conventions §Bảo mật; WAF là lớp per-IP; **KHÔNG** failure-lockout — mã đơn tuần-tự nên lockout-theo-mã để attacker khoá chủ đơn thật khỏi đơn của họ, review wf_4ef2b511), và chỉ trả **`PublicOrderTimeline` tối thiểu** (`code`/`status`/`milestones{status,at}`/`trackingCode?`/`createdAt`) — **KHÔNG** bao giờ Order nội bộ (không customer PII/địa chỉ/tiền/proof/note/`byUser`/`reason`; ADR-032), giữ endpoint **public** (classify `authPublic`). *(test: `httpapi.TestLookupOrderEndToEnd` + `httpapi.TestLookupLimiter` + `httpapi.TestLookupOrderRateLimitReturns429Envelope` + `httpapi.TestPublicTimelineDTO` + `httpapi.TestNormalizePhone`)*
- [ ] `TRK-01` — WHEN một khách GET `/orders/track?code=&token=` công khai (không cần session/SĐT, link C3 `/o/{code}-{token}`, P2-i/D-P2-8), the system shall xác thực **token capability HMAC** `base64url(HMAC-SHA256(TRACKING_SECRET, orderCode))` bằng **constant-time compare** (`hmac.Equal`) đối chiếu token recompute từ `row.Code` — trả **404 `NOT_FOUND` byte-đồng-nhất** cho code lạ **HOẶC** token sai (present-but-wrong) (không phân biệt đơn tồn-tại — chống enumerate, chạy compare cả trên nhánh code-miss để timing không rò, pattern AUTH-01/LKP-01), **`code`/`token` THIẾU → 400 `VALIDATION`** (required-param, fire TRƯỚC DB → uniform bất kể đơn tồn tại, không phải oracle), áp **token-bucket per-code dùng CHUNG với lookup** (`s.lookup.allow` trước khi đọc DB → 429 `RATE_LIMITED`), chỉ trả **`PublicOrderTimeline` tối thiểu y hệt `/orders/lookup`** (byte-đồng-nhất, cùng `publicTimelineDTO`) — **KHÔNG** bao giờ Order nội bộ (ADR-032), giữ endpoint **public**; đồng thời `POST /orders` 201 trả **`trackingToken`** (schema `CreateOrderResult`, **chỉ** ở 201 — không lộ ở endpoint đọc nào khác) để FE dựng link theo dõi, với `TRACKING_SECRET` **fail-fast** khi forgeable (dev-secret không opt-in — `UsesForgeableTrackingSecret`, BLOCKER-F, như JWT_SECRET), **KHÔNG migration** (token deterministic, recompute lúc đọc → rotate secret vô hiệu mọi link cũ). *(test: `httpapi.TestTrackOrderEndToEnd` [integration real-PG] + `httpapi.TestTrackingSignerRoundTrip` [Docker-free] + `config.TestUsesForgeableTrackingSecret`)*

## Cụm 16 — Storefront product reviews (`docs/plans/phase-1-storefront.md` §2 · P1-l)

> **Go-gated — CỐ Ý để `[ ]`** (cùng lý do Cụm 13/14/15): test của `REV-*` là **Go**
> (`services/core-api/internal/httpapi`), parser TS không resolve được → tick `[x]` sẽ làm parser ĐỎ.
> **Gate thật** = `guard.test.sh §ARM` (REV-01: `ListReviewsByProduct` lọc `status='published'` tại nguồn SQL +
> handler `ProductStatusActive`→`db.ErrNotFound` non-leak + classify `GetProductReviews` authPublic) **+** chính
> các test Go đó (unit Docker-free `reviewsDTO`/pre-DB + integration vs PG thật chứng minh review ẩn KHÔNG rò). `[ ]` = "không do parser-TS gác".

- [ ] `REV-01` — WHEN một khách GET `/products/{slug}/reviews` công khai (không cần session), the system shall trả **CHỈ review `published`** cho sản phẩm **`active`** dưới dạng **danh sách phân trang mới-nhất-trước** (lọc `status='published'` tại **nguồn SQL** `ListReviewsByProduct` nên review ẩn/moderated-away KHÔNG bao giờ lọt ra — cùng non-leak `status='active'` của catalog), coi **slug lạ HOẶC sản phẩm nháp/lưu-trữ** đều **404 `NOT_FOUND` đồng nhất** (reviews của sản phẩm ẩn KHÔNG phục vụ, không probe tồn-tại catalog), **KHÔNG** lộ danh tính người đánh giá (projection bỏ `customer_id` — không PII công khai, PDPL), chỉ trả nội dung review (`id`/`rating`/`body`/`images`/`reply?`/`createdAt`; `reply` null tới khi shop trả lời) với `pageSize` ≤ 48 (over-cap → **400 `VALIDATION`**, chống DoS trên endpoint public không rate-limit), phát **weak ETag** + `Cache-Control` (If-None-Match khớp → **304** không body), và giữ endpoint **public** (classify `authPublic`). *(test: `httpapi.TestGetProductReviewsEndToEnd` + `httpapi.TestReviewsDTO` + `httpapi.TestReviewDTOCarriesNoAuthorIdentity` + `httpapi.TestReviewsDTOCorruptJSONBHardFails` + `httpapi.TestGetProductReviewsRejectsBadParamsWithoutDB`)*

## Cụm 17 — Storefront home grid (FE) (`docs/plans/phase-1-storefront.md` §3 · P1-f)

> **CỐ Ý để `[ ]`** (cùng tinh thần Cụm 13..16, khác lý do): test của `SF-*` là **TS storefront**
> (`apps/storefront/test/*.test.ts`), nhưng ledger parser (`packages/core/test/acceptance.ledger.test.ts`)
> chỉ quét `packages/**` → KHÔNG resolve được test-id ở `apps/**` → tick `[x]` sẽ làm parser ĐỎ.
> **Gate thật** = chính các test TS đó (`pnpm --filter @lumin/storefront test`, chạy trong `app-gates`) **+**
> `import 'server-only'` (biến biên client-bundle thành lỗi-biên-dịch) **+** ESLint no-Intl (MNY-03). `[ ]` = "không do parser-TS packages gác".

- [ ] `SF-01` — WHEN một caller gọi POST `/api/revalidate` để xoá cache catalog (on-write purge), the system shall chỉ chấp nhận khi trình đúng header `x-revalidate-secret` khớp `REVALIDATE_SECRET` (so sánh **hằng-thời-gian** `timingSafeEqual`) rồi mới `revalidateTag('catalog')`, và **fail-CLOSED**: `REVALIDATE_SECRET` chưa cấu hình → **500 đóng** (KHÔNG bao giờ mở purge vô danh), thiếu/sai/lệch-độ-dài secret → **401**, không rò gì ngoài `{revalidated:false}` — secret cao-entropy là phòng-thủ duy nhất nên một purge vô danh (cache-thrash DoS) bị chặn như một write. *(test: `apps/storefront/test/revalidate-auth.test.ts` → `verifyRevalidateSecret`: closed-on-unset · 401-missing · 401-wrong · 401-wrong-length · 200-match)*
- [ ] `SF-02` — WHEN storefront chiếu một API `ProductCard` sang thẻ lưới home (`toProductCardView`) và fetch server-side, the system shall giữ `basePrice` **int-VND thô** (chỉ `@lumin/core formatVnd` định dạng ở hạ nguồn qua `PriceTag`, KHÔNG tiền-định-dạng, KHÔNG `Intl` trong storefront), lấy **`images[0]` làm ảnh bìa** (ADR-007 sprite-first) và **thu về `undefined`** khi không có ảnh (images rỗng HOẶC chuỗi-rỗng → placeholder, không bao giờ `src=""`), đưa `ratingAvg` null → `null` (ẩn khối Rating), và đọc catalog **server-only** (`CORE_API_URL` + `createApiClient` KHÔNG lọt client bundle — `import 'server-only'` gác ở biên-dịch). *(test: `apps/storefront/test/catalog.test.ts` → `toProductCardView`: int-VND-raw · images[0]-cover · empty/empty-string→undefined · null-rating)*

## Cụm 18 — Storefront product detail (FE) (`docs/plans/phase-1-storefront.md` §3 · P1-h)

> **CỐ Ý để `[ ]`** (cùng lý do Cụm 17): test của `SF-*` là **TS storefront** (`apps/storefront/test/*.test.ts`),
> ledger parser chỉ quét `packages/**` → tick `[x]` sẽ làm parser ĐỎ. **Gate thật** = chính test TS đó
> (`pnpm --filter @lumin/storefront test`, chạy trong `app-gates`) **+** `import 'server-only'` ở `lib/catalog`
> (gác biên client-bundle) **+** ESLint no-Intl (MNY-03).

- [ ] `SF-03` — WHILE khách xem trang chi tiết `/san-pham/{slug}` (`ProductDetail`), the system shall **khoá nút "Thêm vào giỏ"** (disabled) tới khi khách chọn một màu **còn hàng** — quyết định khoá là hàm thuần `canAddToCart(selectedColorId, colors)`: chưa chọn (`null`) → khoá; chọn màu `available:false` → **vẫn khoá** (hết hàng KHÔNG bao giờ mở khoá); chọn id không thuộc sản phẩm → khoá; sản phẩm KHÔNG có màu nào → khoá không áp dụng (mở, vì không có gì để chọn). Giá hiển thị là `basePrice` int-VND thô qua `PriceTag`/`formatVnd` — **KHÔNG cộng `priceDelta` màu/tuỳ-chọn ở client** (tổng tính ở server qua `POST /price/quote`, P1-k). *(test: `apps/storefront/test/product-detail-view.test.ts` → `canAddToCart`: null-khoá · available-mở · unavailable-khoá · unknown-id-khoá · no-colors-mở)*
- [ ] `SF-04` — WHEN core-api trả một màu `available:false` cho trang chi tiết, the system shall render swatch đó **không chọn được** (`disabled`, `aria-label` "{name} — tạm hết") và hiện copy hết-hàng `core.errors.colorOutOfStock` ("Màu này tạm hết nhựa — chọn màu khác nha."), đồng thời `toProductDetailView` **giữ nguyên cờ `available` + `priceDelta` từng màu** (nguồn của khoá + out-of-stock); và một slug lạ HOẶC nháp/lưu-trữ đều `notFound()` **đồng nhất** (không rò tồn-tại catalog). *(test: `apps/storefront/test/product-detail-view.test.ts` → `toProductDetailView` giữ available/priceDelta · `isColorSelectable`; 404-uniform gác bởi handler P1-a `CAT-01`)*

## Cụm 19 — Storefront engrave / personalize (FE) (`docs/plans/phase-1-storefront.md` §3 · P1-j)

> **CỐ Ý để `[ ]`** (cùng lý do Cụm 17/18): test của `SF-*` là **TS storefront** (`apps/storefront/test/*.test.ts`),
> ledger parser chỉ quét `packages/**` → tick `[x]` sẽ làm parser ĐỎ. **Gate thật** = chính test TS đó
> (`pnpm --filter @lumin/storefront test`, chạy trong `app-gates`) **+** ESLint no-Intl (MNY-03: đếm ký tự dùng
> `Array.from`/`normalize`, KHÔNG `Intl`). Nguồn chân lý hạn khắc = server `pricing.validateEngrave` (rune count).

- [ ] `SF-05` — WHILE khách nhập khắc tên (một `text` option) trên trang chi tiết `/san-pham/{slug}`, the system shall đếm ký tự **mirror server rune-count** (`engraveLength` = đếm **code point thô** qua `Array.from(text)` — KHÔNG `.length` UTF-16, KHÔNG grapheme `Intl.Segmenter`, **KHÔNG NFC-normalize** vì server cũng không normalize; khớp `utf8.RuneCountInString(p.Text)` **thô** của `pricing.validateEngrave` cho **cùng chuỗi**, kể cả NFD — user-confirmed 2026-07-04) và **khoá "Thêm vào giỏ"** khi bất kỳ khắc nào vượt `maxChars` (`canAddToCartWithOptions` = colour-lock AND mọi engraving trong hạn), coi text rỗng/chỉ-khoảng-trắng **không bao giờ khoá** (khắc là tuỳ chọn — mirror `TrimSpace==""`), `maxChars` null = không giới hạn, khoảng-trắng-cuối **tính vào hạn** (đúng như server), và over-limit hiện `role=alert` `productDetail.engraveTooLong` + `maxChars` báo qua Input `hint` (native-associated, không clobber) — **KHÔNG cộng `priceDelta` ở client** (tổng server-authoritative qua `POST /price/quote`, P1-k). *(test: `apps/storefront/test/product-detail-view.test.ts` → `engraveLength` ASCII/NFC/**NFD-raw=2**/non-BMP · `isEngraveWithinLimit` blank/null/limit/trailing-space · `canAddToCartWithOptions` truth-table)*
- [ ] `SF-06` — WHEN core-api trả `options[]` cho trang chi tiết, the system shall chiếu qua `toProductDetailView` **giữ `id`/`label`/`description`/`type`/`priceDelta`** và collapse `maxChars` absent/null → `null`, render `type:text` thành **engrave field** (label = `option.label` + live preview + counter) và `type:choice` thành **add-on toggle** (label + `priceDelta` qua `PriceTag`/`@lumin/core`; contract KHÔNG có sub-`values[]` → chọn/bỏ **boolean**), giữ selection **UI-only** tới khi cart lấy live total (P1-k), và **KHÔNG** dựng zoneId UI (§5 DROP — server nhận `zoneId` free-form, chỉ validate text + rune hạn; zone picker draggable-orb là P1-i). *(test: `apps/storefront/test/product-detail-view.test.ts` → `toProductDetailView` options mapping + `maxChars` null-collapse)*

## Cụm 20 — Storefront cart (FE) (`docs/plans/phase-1-storefront.md` §3 · P1-k)

> **CỐ Ý để `[ ]`** (cùng lý do Cụm 17/18/19): test của `SF-*` là **TS storefront** (`apps/storefront/test/*.test.ts`),
> ledger parser chỉ quét `packages/**` → tick `[x]` sẽ làm parser ĐỎ. **Gate thật** = chính test TS đó
> (`pnpm --filter @lumin/storefront test`, chạy trong `app-gates`) **+** ESLint no-Intl (MNY-03) — tiền chỉ qua
> `PriceTag`/`@lumin/core formatVnd`, tạm tính **server-authoritative** (`POST /price/quote`). Ranh giới: **KHÔNG checkout**.

- [ ] `SF-07` — WHEN khách thêm/sửa/xoá món trong giỏ `/gio-hang`, the system shall giữ giỏ qua reload (localStorage) và áp các reducer **thuần**: gộp theo **cấu hình** (`cartLineKey` = product + colour + `optionIds`-sorted + engrave-text ⇒ cùng cấu hình cộng dồn `quantity`), **giảm-tại-1 → xoá** (`setItemQuantity` với `qty≤0` loại dòng), clamp `1..MAX_QUANTITY`, chặn vượt `MAX_LINES`, và `sanitizeCart` **bỏ mọi entry localStorage hỏng/lệch-schema** (đọc không bao giờ ném) — **KHÔNG cộng tiền ở client** (CartItem không mang giá; conventions §Tiền). *(test: `apps/storefront/test/cart.test.ts` → `cartLineKey` · `buildCartItem` (engrave off optionIds, blank=none, key-merge) · `addItem` (merge/append/clamp/`MAX_LINES`/no-mutate) · `setItemQuantity` (dec-at-1-remove/clamp) · `removeItem` · `sanitizeCart`)*
- [ ] `SF-08` — WHEN giỏ được định giá, the system shall lấy **tạm tính + mọi line total CHỈ từ `POST /price/quote`** (server-authoritative) qua Server Action `quoteCart` (client KHÔNG đọc `CORE_API_URL`), với `cartQuoteItems` **gấp engrave option id vào `optionIds`** + bỏ `colorId` khi null + **KHÔNG gửi personalization/giá** lên wire (§5: `zoneId` free-form, tái nhập ở Phase-2 checkout), giữ line **đúng thứ tự index** với response, và **KHÔNG có checkout** — footer chỉ hiện tạm tính + ghi chú ship-tính-sau, **zero order/payment/address code** (ranh giới Phase-1/2 cứng, plan §0). *(test: `apps/storefront/test/cart.test.ts` → `cartQuoteItems` (fold engrave · omit null colorId · order) · `cartSignature` · `cartCount`)*

## Cụm 21 — Storefront customer auth realm (`docs/plans/phase-1-storefront.md` §2 · P1-r · ADR-030)

> **Go-gated — CỐ Ý để `[ ]`** (cùng lý do Cụm 13..16): test của `CUST-*` là **Go**
> (`services/core-api/internal/httpapi`), parser TS không resolve được → tick `[x]` sẽ làm parser ĐỎ.
> **Gate thật** = `guard.test.sh §ARM` (CUST-01: `resolveCustomer` verify qua issuer **customerAuth** riêng + classify `RegisterCustomer`/`LoginCustomer`/`LogoutCustomer` **authPublic** & `GetCustomerOrders` **authCustomer**; CUST-02: `ListOrdersByCustomer` scope `customer_id` tại SQL + main.go `UsesForgeableCustomerJWTSecret` fail-fast) **+** chính các test Go đó (unit Docker-free realm-isolation + integration register→login→orders vs PG thật). `[ ]` = "không do parser-TS gác".

- [ ] `CUST-01` — WHEN một khách POST `/customer/register` (name+email+phone+password) hoặc `/customer/login` (email+password) công khai, the system shall xác thực ở **realm khách RIÊNG** (`auth.CustomerCookieName=lumin_customer` + secret `CUSTOMER_JWT_SECRET` khác admin ⇒ **token admin KHÔNG BAO GIỜ** verify được như session khách và ngược lại — cô lập mật-mã, ADR-030), băm mật khẩu **bcrypt** (không lưu/không trả clear), phát JWT ký đặt trong cookie **httpOnly+Secure+SameSite** (token **KHÔNG** trong body — chặn XSS-theft), coi **email đăng-nhập unique không-phân-biệt-hoa-thường** (partial-unique `lower(email) WHERE password_hash IS NOT NULL` ⇒ trùng khi register là **409 `EMAIL_TAKEN`** do DB, không có race find-then-insert), trả **401 đồng nhất** cho email-lạ **và** sai-mật-khẩu (chạy một bcrypt-compare cả trên nhánh không-tồn-tại/nil-hash — timing không rò, không enumerate), và **KHÔNG cho** một row khách guest (`password_hash IS NULL`) đăng nhập dù trùng SĐT/email. *(test: `httpapi.TestCustomerRegisterLoginFlow` [integration real-PG] + `httpapi.TestResolveCustomerRealmIsolation` + `httpapi.TestRegisterCustomerValidation` + `httpapi.TestClassifyCustomerRealm`)*
- [ ] `CUST-02` — WHEN một khách **đã đăng nhập** GET `/customer/orders`, the system shall trả **chỉ đơn của chính họ** (scope cứng theo `customer_id` từ subject session đã-verify tại SQL `ListOrdersByCustomer` — id lạ ⇒ danh sách rỗng, không bao giờ đơn người khác) dưới dạng **`PublicOrderTimeline` như guest-lookup** (`code`/`status`/`milestones`/`trackingCode?`/`createdAt` — **KHÔNG** tiền/PII/địa chỉ/proof nội bộ, ADR-032), đòi **session khách hợp lệ** (thiếu/hỏng/cookie-admin ⇒ **401** — classify `authCustomer`, resolve qua issuer khách; đơn guest đặt trước khi register **KHÔNG** tự-liên-kết — claiming SĐT chưa xác minh là lỗ bảo mật, hoãn), và server **fail-fast** khi `CUSTOMER_JWT_SECRET` là dev-secret không opt-in (`UsesForgeableCustomerJWTSecret` — token khách giả-mạo-được ⇒ đọc lịch sử đơn người khác, rò PII). *(test: `httpapi.TestGetCustomerOrdersScoped` [integration real-PG: scope + router 200 + no-PII-leak] + `httpapi.TestCustomerOrdersRequiresCustomerSession` + `config` fail-fast tests)*

## Cụm 22 — Checkout config + STK gate (`docs/plans/phase-2-checkout.md` P2-a · D-P2-1 · conventions §Bảo mật)

> **Go-gated — CỐ Ý để `[ ]`** (cùng lý do Cụm 4..12): test của `CHK-06/07` là **Go**
> (`services/core-api/internal/httpapi`), parser TS không resolve được → tick `[x]` sẽ làm parser ĐỎ. **Gate thật** =
> `guard.test.sh §ARM` (checkout_config.go dựng `vietqrUrl` từ STK đã lưu qua `vietQRImageURL` không nhận input client +
> classify `GetCheckoutConfig` **authPublic**; checkout.go web-create gác `errNoSTKConfigured` khi STK trống) **+** chính
> các test Go đó (unit Docker-free helper + integration vs PG thật). `[ ]` = "không do parser-TS gác".

- [ ] `CHK-06` — WHEN storefront GET `/checkout/config` công khai (không session), the system shall trả **whitelist** đúng bốn trường — `bankAccount` (STK), `vietqrUrl` **dựng server-side từ STK đã lưu** (`img.vietqr.io`, D-P2-1: KHÔNG nhận field client, KHÔNG amount/memo → client không tráo được tài khoản đích, conventions §Bảo mật/ADR-010; `accountName` URL-escape), `shippableProvinces` (**keys `settings.shipping_rules`, loại `*` wildcard** + dedup, non-nil `[]`), `refundPolicy` (đổi-trả pre-purchase, compliance §3) — và **KHÔNG lộ** `shopInfo`/PII/bảng phí ship/field settings khác, coi shop **chưa cấu hình STK** (`bank_account` trống/`{}`/thiếu `bin`+`accountNumber`) là **422 `NO_STK_CONFIGURED`** (KHÔNG half-config với QR không render được), và `shipping_rules` hỏng là **500** (server config fault, không rò partial). *(test: `httpapi.TestGetCheckoutConfigEndToEnd` [integration real-PG] + `httpapi.TestGetCheckoutConfigNoSTKConfigured` + `httpapi.TestStkFromSettingsGate` + `httpapi.TestVietQRImageURLServerBuilt` + `httpapi.TestShippableProvincesExcludesWildcard`)*
- [ ] `CHK-07` — WHEN khách tạo đơn **web** qua `POST /orders` mà shop **chưa cấu hình STK**, the system shall **từ chối 422 `NO_STK_CONFIGURED` TRƯỚC mọi write** (không có STK thì không có cách nhận thanh toán web — cùng tín hiệu `/checkout/config` cho) và **KHÔNG để lại** row `customers`/`orders` nào (gate chạy trước tx), trong khi đơn **inbox** (staff tạo, born-`PAID`, CHK-05) **KHÔNG** cần STK lúc tạo. *(test: `httpapi.TestCreateOrderWebRequiresSTK` [integration real-PG: 422 + zero-row] + `httpapi.TestCreateOrderInboxStaffEndToEnd` [inbox không cần STK])*

## Cụm 23 — Payment-proof upload (`docs/plans/phase-2-checkout.md` P2-c · D-P2-2 · ADR-035)

> **Go-gated — CỐ Ý để `[ ]`** (cùng lý do Cụm 4..22): test của `CHK-08` là **Go**
> (`services/core-api/internal/{config,httpapi}`), parser TS không resolve được → tick `[x]` sẽ làm parser ĐỎ. **Gate
> thật** = OpenAPI strict-server/codegen stale-check + chính các test Go Docker-free (policy signing, router authPublic,
> config defaults/env). `[ ]` = "không do parser-TS gác".

- [ ] `CHK-08` — WHEN storefront cần upload ảnh biên lai trước `POST /orders`, the system shall cấp qua `POST /checkout/payment-proof-upload` một **presigned POST** Garage/S3 công khai (không session) với key server-generated không chứa PII, `finalUrl` **host-pinned** từ cấu hình server, policy ngắn hạn (≤5 phút) có **`content-length-range` ≤10MB** và exact `Content-Type` chỉ `image/jpeg|image/png|image/webp` (oversize/wrong-mime bị S3 policy từ chối — KHÔNG dựa client khai size), form fields SigV4 không lộ secret, public signer có token-bucket backstop (**429 `RATE_LIMITED`**), và config upload thiếu/sai **fail-closed** (500 generic, không phát URL giả/partial). *(test: `proofstore.TestStorePresignsHostPinnedPostPolicy` + `proofstore.TestStoreOwnsOnlyHostPinnedURLs` + `proofstore.TestStoreRejectsBadInput` + `httpapi.TestCreatePaymentProofUploadHandler` + `httpapi.TestCreatePaymentProofUploadRateLimited` + `httpapi.TestCreatePaymentProofUploadPublicRoute` + `config.TestLoadPaymentProofUploadDefaults` + `config.TestLoadHonoursPaymentProofUploadEnv`)*
- [ ] `CHK-09` — WHEN một đơn đã ở trạng thái terminal (`COMPLETED`/`CANCELLED`/`REFUNDED`) lâu hơn thời hạn lưu (mặc định 90 ngày tính từ `orders.updated_at` = mốc chuyển terminal, KHÔNG từ lúc upload), the system shall — qua sweeper nền `internal/retention` chạy khi uploads được cấu hình — **xoá object biên lai khỏi Garage RỒI mới null `payment_proof_url`** (object-first: crash giữa chừng để lại ref tới object đã xoá → sweep sau re-select + re-clear idempotent, KHÔNG bao giờ ref sạch tới object còn sống), **chỉ** xoá URL host-pinned do server cấp (URL lạ → không gọi S3 nhưng vẫn null ref theo retention), lỗi một đơn được log-and-skip không chặn batch, và orphan upload (upload không thành đơn, không có mốc terminal) do **bucket lifecycle rule** (infra/README) dọn — backstop. *(test: `retention.TestSweepDeletesObjectThenClearsReference` + `retention.TestSweepKeepsReferenceWhenObjectDeleteFails` + `retention.TestSweepClearsReferenceEvenWhenObjectNotOwned` + `retention.TestSweepSkipsNilProof` + `retention.TestNewClampsNonPositiveConfig` + `proofstore.TestStoreDeleteIgnoresForeignURLs` + `db.TestPurgeableProofOrders` [integration real-PG])*
