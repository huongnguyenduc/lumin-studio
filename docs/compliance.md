# Compliance — nghĩa vụ pháp lý Việt Nam

> **Mục đích:** những gì một shop bán online nhỏ ở VN **phải** làm (2025–2026). Đã fact-check trong vòng nghiên cứu.
> **Cảnh báo:** đây là tóm tắt kỹ thuật để lập kế hoạch, **không phải tư vấn pháp lý**. Xác nhận với luật sư/kế toán trước khi launch.
> **Liên quan:** [`decisions.md`](decisions.md) ADR-012/017 · [`conventions.md`](conventions.md) §Phân tích & consent.

## 1. Thông báo website với Bộ Công Thương (NĐ 52/2013 + 85/2021) — TRƯỚC khi bán
- Website bán hàng phải **thông báo trên online.gov.vn** trước khi hoạt động. Cơ quan tiếp nhận hiện là **UBND cấp tỉnh**.
- Không thông báo: phạt **10–20tr** (tổ chức **20–40tr**) + có thể bị **rút tên miền .vn**.
- Sau khi duyệt: hiển thị **logo "đã thông báo Bộ Công Thương"** trên storefront (cũng là tín hiệu tin cậy).
- **Việc cho plan:** làm ở Phase 3 (lúc launch). Cần thông tin pháp nhân + tên miền.

## 2. Bảo vệ dữ liệu cá nhân — PDPL (Luật 91/2025/QH15, hiệu lực 1/1/2026)
- **Thông báo quyền riêng tư** tiếng Việt (thu gì, mục đích, lưu bao lâu, quyền của khách).
- **Consent marketing tách riêng, KHÔNG tick sẵn, KHÔNG bundle, KHÔNG gate việc mua**; lưu `{scope, channel, timestamp}` (đã có trên Customer — `plan.md` Core).
- **Gate Umami theo consent**; **session replay TẮT mặc định**, opt-in + che input + tắt ở /personalize + checkout.
- **Tối thiểu hoá dữ liệu:** chỉ thu tên/SĐT/email/địa chỉ cần cho đơn.
- Xử lý yêu cầu **xoá/xuất** dữ liệu; **runbook sự cố** 1 trang (báo trong 72/24 giờ).
- Hộ kinh doanh nhỏ thuộc diện **miễn DPIA/DPO** → làm gọn inline, đừng dựng cả chương trình.
- Self-host giữ dữ liệu **trong nước** (điểm cộng). Marketing còn chịu **NĐ 91/2020** chống spam (opt-out + danh sách Do-Not-Call).
- **Đừng over-engineer:** không CMP/IAB-TCF, không cookie-wall kiểu GDPR.

## 3. Đổi trả hàng cá nhân hoá (Luật BVNTD 19/2023) — ADR-012
- Công bố **đầy đủ, chính xác** mô tả sản phẩm + chính sách đổi/trả **trước khi mua**.
- Hàng **cá nhân hoá/khắc tên** thường **không đổi trả** — hiển thị điều khoản này + **tickbox xác nhận trước thanh toán** để vô hiệu hoá quyền huỷ 30 ngày (hợp đồng từ xa). **Vẫn giữ** nghĩa vụ in lại/đền nếu **lỗi/sai do shop**.
- **Đặt cọc (Điều 328 BLDS)** + mặc định **trả đủ trước** qua VietQR + **không COD hàng khắc** → chống bom hàng (8–30%). Bước **echo lại nội dung khắc** trước khi trả tiền (chứng cứ + chống tranh chấp "in sai").

## 4. Địa chỉ hành chính — bỏ cấp huyện (1/7/2025) — ADR-017
- Mô hình địa chỉ: **tỉnh → phường/xã → đường**. **Không** lưu trường quận/huyện. Áp cho data model + form checkout + tra cứu phí ship.

## 5. Thuế & hoá đơn điện tử
- **Đừng tự động hoá hoá đơn điện tử/thuế lúc này.** Giữ **sổ doanh thu theo đơn sạch sẽ**; xuất hoá đơn thủ công qua cổng nhà cung cấp khi cần.
- Ngưỡng tham khảo (xác nhận với kế toán): doanh thu dưới ~**500tr/năm** thường chưa phải nộp VAT/PIT (nhưng vẫn phải kê khai); ngưỡng máy tính tiền/hoá đơn điện tử POS ~**1 tỷ**. Phụ thuộc **pháp nhân** (hộ KD vs công ty) — xem mục 6.

## 6. Mở (chưa chốt — cho mình biết khi tiện)
- **Pháp nhân:** hộ kinh doanh vs công ty → quyết định ngưỡng thuế, nghĩa vụ hoá đơn điện tử, và tầng miễn trừ PDPL nào áp dụng.
- **Địa chỉ/điểm nhận thật:** có → cân nhắc Google Business Profile + ship nội thành (Ahamove/Grab); thuần online → bỏ qua, đừng bịa địa điểm.
