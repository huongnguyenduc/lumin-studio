---
description: Luật lõi miền — tiền, state machine đơn, i18n keys, outbox, SSE, RBAC. Áp khi chạm packages/core hoặc services/core-api.
paths:
  - "packages/core/**"
  - "services/core-api/**"
---

# Lõi miền (money · order state · server authority)

> Vì sao: [`/docs/conventions.md`](../../docs/conventions.md) · [`/docs/decisions.md`](../../docs/decisions.md) · nguồn chân lý: [`/spec.md`](../../spec.md) §02/§04.

- **Tiền:** lưu **int VND** (không thập phân). `subtotal/shippingFee/total` **tính ở server** — KHÔNG tin total client gửi (client gửi để hiển thị, server tính lại). Định dạng tiền chỉ qua **một** formatter trong `packages/core` (xuất `390.000₫`). Cấm `Intl.NumberFormat`/`.toLocaleString()` rải rác ngoài `core` (ESLint chặn).
- **State machine:** mọi đổi `OrderStatus` đi qua **transition guard** của `packages/core` + **append** `statusHistory{from,to,at,byUser,reason?}`. `reason` **bắt buộc** cho `CANCELLED`/`REFUNDED` (`REFUNDED` kèm `refundProofUrl`). `reconcile → PAID` (và `→ REFUNDED`) là **owner-only**. Chuỗi: `PENDING_CONFIRM→PAID→PRINTING→SHIPPING→COMPLETED`.
- **Tạo đơn:** đơn (`web`/`inbox`) chỉ tạo ở `PENDING_CONFIRM` **sau khi** khách đã CK (web: đính **ảnh biên lai** `paymentProofUrl` + xác nhận) — **không** tạo ở bước checkout. Đối soát = owner xem ảnh → `PAID`.
- **i18n:** không hard-code chuỗi UI — tách khoá `next-intl` (ICU), default `vi`. Số/tiền/ngày qua `Intl('vi-VN')` helper.
- **Outbox (core-api):** publish job NATS **chỉ sau khi** row commit (publish-on-commit) — tránh mất job do dual-write (ADR-006).
- **SSE (core-api):** `no-transform` + `Content-Encoding: identity` + `X-Accel-Buffering: no` + `Flusher` mỗi event + heartbeat (qua được timeout 100s của Cloudflare). NATS không lộ ra browser (ADR-008).
- **Bảo mật:** STK/bank-account **chỉ owner sửa + audit append-only**; **QR tĩnh** render **server-side** từ STK đã lưu (memo CK không bắt buộc). RBAC: `staff` không sửa cài đặt/STK, không reconcile→PAID.
- Server là nguồn chân lý — client không tự nhảy state, không tự tính tiền.
