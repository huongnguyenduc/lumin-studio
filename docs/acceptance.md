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
