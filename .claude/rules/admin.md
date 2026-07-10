---
description: Luật cho Admin (Next.js, desktop + responsive mobile) — Access, STK owner-only, 1-chạm PAID, hàng đợi in SSE.
paths:
  - "apps/admin/**"
---

# Admin (+ Admin Mobile = cùng app responsive)

> Vì sao: [`/docs/decisions.md`](../../docs/decisions.md) ADR-009/010 · [`/docs/conventions.md`](../../docs/conventions.md) · [`/spec.md`](../../spec.md) §08.

- **Admin Mobile KHÔNG tách codebase** — là chính app admin responsive (ADR-002).
- **Auth = self-issued JWT (ADR-030)**, KHÔNG Cloudflare Access: core-api `POST /auth/login` → cookie httpOnly+SameSite=Strict `lumin_session`; middleware verify trên `/admin/*` + RBAC owner/staff. Màn login mỏng ở apps/admin (P3-a). CF Access/WAF nếu bật = lớp edge bổ sung, không bắt buộc.
- **STK/bank-account:** chỉ **owner** sửa + **audit log append-only**; QR render **server-side** từ STK đã lưu (chống tráo STK).
- **Nút 1-chạm → PAID:** owner-only (staff không được), ghi `statusHistory`. Có trên cả Admin và Admin Mobile.
- **Hàng đợi in:** kéo-thả ↔ status, cập nhật **SSE**. Có view "AssetJob failed" (DLQ).
- **Cài đặt:** thiếu STK ⇒ **chặn checkout web** (không cho đặt khi chưa cấu hình nhận tiền).
- **QC:** chụp ảnh đóng gói trước khi chuyển SHIPPING.
- RBAC chặn `staff` sửa cài đặt/STK và reconcile→PAID. Mỗi màn đủ **empty · loading · error**.
