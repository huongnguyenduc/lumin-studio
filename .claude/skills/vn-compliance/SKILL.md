---
name: vn-compliance
description: Nghĩa vụ pháp lý Việt Nam cho Lumin — online.gov.vn, PDPL (consent/replay), đổi-trả & quyền huỷ, hoá đơn điện tử, mô hình địa chỉ bỏ cấp huyện. Dùng khi task chạm compliance/legal/privacy/consent/invoice/đổi-trả/đăng-ký-website. Đọc trước khi hoàn tất bất kỳ luồng consent/checkout/hoá-đơn.
---

# Compliance Việt Nam — pointer

> Đây là **pointer** vào nguồn chân lý, không restate luật. Đọc khi làm việc chạm pháp lý.

**Nguồn chân lý:** [`docs/compliance.md`](../../../docs/compliance.md). Quyết định liên quan trong
[`docs/decisions.md`](../../../docs/decisions.md): **ADR-010** (thanh toán/đối soát), **ADR-012** (cọc + no-COD +
tickbox "không đổi trả hàng cá nhân hoá"), **ADR-015** (Umami — session replay TẮT mặc định, PDPL), **ADR-017**
(địa chỉ tỉnh→phường→đường, BỎ quận/huyện từ 2025-07-01).

**Khi nào fire:** đăng ký website với online.gov.vn; thu thập/lưu PII (consent, retention, session replay); chính sách
đổi/trả & quyền huỷ 30 ngày (Luật BVNTD 19/2023) vs hàng cá nhân hoá; xuất hoá đơn điện tử (ngưỡng theo loại pháp nhân —
xem mục Open ở `decisions.md`); form địa chỉ.

**Nhắc nhanh (chi tiết ở doc):** tickbox "không đổi trả hàng cá nhân hoá" phải hiện **trước** thanh toán + có bước echo
nội dung khắc; session replay opt-in, che input, tắt ở `/personalize` + checkout; **không** có trường `district`.
