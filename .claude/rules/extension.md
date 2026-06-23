---
description: Luật cho Browser Extension (MV3) — ASSISTIVE-ONLY, tuyệt đối không chạm DOM Meta.
paths:
  - "apps/extension/**"
---

# Extension — assistive-only (ADR-011, ràng buộc sống còn)

> Vì sao: [`/docs/decisions.md`](../../docs/decisions.md) **ADR-011** · [`/docs/plan.md`](../../docs/plan.md) Phase 4.

- **TUYỆT ĐỐI KHÔNG** inject/scrape/tự động hoá DOM của messenger.com / instagram.com / facebook.com. Vi phạm Meta Platform Terms ⇒ nguy cơ **khoá vĩnh viễn tài khoản bán hàng** (existential). Đây là lằn ranh đỏ — không có ngoại lệ.
- Panel ~360–400px **chỉ gọi BFF** (core-api): tra đơn · form tạo đơn (`channel=inbox`) · copy mẫu trả lời (biến `{tên}/{mã đơn}/{STK}`) · quét mã (paste/camera).
- **Người dùng tự bấm** mọi thao tác bên trong Meta. Extension không thay người thao tác trên trang Meta.
- Không content-script đọc/ghi DOM trang Meta. Nếu thấy mình định `document.querySelector` trên domain Meta — **dừng lại**, đó là vi phạm.
- Fallback khi cần tự động hoá thật: Zalo OA / Messenger API chính thức (không phải scrape).
