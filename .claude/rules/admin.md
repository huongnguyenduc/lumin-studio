---
description: Luật cho Admin (Next.js, desktop + responsive mobile) — Access, STK owner-only, 1-chạm PAID, hàng đợi in SSE.
paths:
  - "apps/admin/**"
---

# Admin (+ Admin Mobile = cùng app responsive)

> Vì sao: [`/docs/decisions.md`](../../docs/decisions.md) ADR-009/010 · [`/docs/conventions.md`](../../docs/conventions.md) · [`/spec.md`](../../spec.md) §08.

- **Admin Mobile KHÔNG tách codebase** — là chính app admin responsive (ADR-002).
- **Cloudflare Access** trùm toàn bộ Admin + API admin (cổng danh tính trước box nhà). Đừng tự dựng auth lộ ra ngoài.
- **STK/bank-account:** chỉ **owner** sửa + **audit log append-only**; QR render **server-side** từ STK đã lưu (chống tráo STK).
- **Nút 1-chạm → PAID:** owner-only (staff không được), ghi `statusHistory`. Có trên cả Admin và Admin Mobile.
- **Hàng đợi in:** kéo-thả ↔ status, cập nhật **SSE**. Có view "AssetJob failed" (DLQ).
- **Cài đặt:** thiếu STK ⇒ **chặn checkout web** (không cho đặt khi chưa cấu hình nhận tiền).
- **QC:** chụp ảnh đóng gói trước khi chuyển SHIPPING.
- RBAC chặn `staff` sửa cài đặt/STK và reconcile→PAID. Mỗi màn đủ **empty · loading · error**.
