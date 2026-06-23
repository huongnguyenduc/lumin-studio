# Lumin Studio — Spec triển khai (bản Markdown cho Claude Code)

Bản port Markdown của tài liệu bàn giao. Đây là **nguồn chân lý về hành vi & dữ liệu**.
Giao diện xem `design-system.md`. Các bản thiết kế trực quan ở `designs/`.

---

## 01 · Tổng quan & kiến trúc

Lumin Studio = cửa hàng thiết kế & in 3D đèn / đồ trang trí **theo đơn**. Mọi đơn được in
sau khi khách thanh toán — **không có tồn kho thành phẩm**. Hệ thống gồm 4 bề mặt, vận hành
trên **một bộ trạng thái đơn duy nhất**:

| Bề mặt | Mô tả |
|---|---|
| 🛒 **Storefront** (web khách) | Catalog · chi tiết SP · cá nhân hoá (khắc tên, chọn màu) · giỏ · checkout · tra cứu đơn. **Mobile-first.** |
| ⚙️ **Admin** (desktop-first) | Dashboard · đơn hàng · hàng đợi in · sản phẩm (model 3D + màu + option) · danh mục · đánh giá · cài đặt. |
| 📱 **Admin Mobile** | Bản rút gọn của Admin để xử lý đơn & đổi trạng thái khi không ở máy tính. |
| 🧩 **Browser Extension** | Hiện cạnh Messenger/Instagram. Tạo đơn nhanh từ chat · tra cứu đơn (quét link/mã trong tin nhắn) · mẫu trả lời 1 chạm. |

**Kênh đặt hàng (`channel`):** đơn đến từ **web** (khách chuyển khoản + **gửi ảnh biên lai** → frontend tạo đơn ở "Chờ xác nhận") hoặc **inbox MXH**
(khách báo đã chuyển khoản → nhân viên tạo đơn qua extension). Trường `channel` phân biệt 2 nguồn:
`web` · `inbox`. **Cả hai kênh: đơn chỉ tạo SAU khi khách đã chuyển khoản** — không tạo đơn ở bước checkout.

---

## 02 · Data model & enums

Kiểu chỉ mang tính gợi ý; điều chỉnh theo ORM thực tế. Tiền tệ lưu là **int VND** (không thập phân).
Thời gian lưu **ISO-8601 UTC**.

### Product
| Trường | Kiểu | Ghi chú |
|---|---|---|
| `id` | uuid | Khóa chính |
| `slug` | string | Duy nhất, dùng cho URL |
| `name` | string | Tên hiển thị |
| `description` | richtext | Mô tả + cách dùng |
| `categoryId` | uuid → Category | Đèn bàn, đèn treo, đồ trang trí… |
| `basePrice` | int (VND) | Giá khởi điểm; option có thể cộng thêm |
| `dimensions` | {w,d,h} mm | Hiển thị `180 × 180 × 240 mm` |
| `material` | enum | PLA · PETG · recycled-PLA … |
| `model3dUrl` | url | `.glb` để xem, `.stl`/`.3mf` để in |
| `images[]` | Image[] | **Ảnh shop chụp**; ảnh đầu (`images[0]`) là ảnh đại diện trên card/list (hover/dừng-2s → 360° sprite) |
| `colors[]` | Color[] | Màu in **có tên** (xem dưới) |
| `options[]` | Option[] | Tuỳ chọn có mô tả (khắc tên, kích cỡ…) |
| `status` | enum | `active` · `draft` · `archived` |
| `ratingAvg` · `reviewCount` | float · int | Tính sẵn để hiển thị nhanh |

### Color (màu in có tên)
| Trường | Kiểu |
|---|---|
| `id` | uuid |
| `name` | string · "Kem sữa" |
| `hex` | string |
| `available` | bool (còn cuộn nhựa) |
| `priceDelta` | int (VND, có thể 0) |

### Option (tuỳ chọn)
| Trường | Kiểu |
|---|---|
| `id` | uuid |
| `label` | string |
| `description` | string |
| `type` | enum: `text` · `choice` |
| `priceDelta` | int (VND) |
| `maxChars` | int? (giới hạn khắc, đặt khi tạo SP) |

### Order & OrderItem
| Trường | Kiểu | Ghi chú |
|---|---|---|
| `id` / code | string | Mã hiển thị `#LMN-2261` |
| `channel` | enum | `web` · `inbox` |
| `status` | OrderStatus | Enum dùng chung — xem §04 |
| `customer` | Customer | Tên · SĐT · email · MXH handle |
| `shippingAddress` | Address | Đường · phường · quận · tỉnh |
| `items[]` | OrderItem[] | product · color · options · **personalization** · qty · unitPrice |
| `subtotal` · `shippingFee` · `total` | int (VND) | **Tính phía server**, không tin client |
| `paymentMethod` | enum | `bank_transfer` (giai đoạn 1) |
| `paymentProofUrl` | url? | Ảnh chụp biên lai CK khách đính khi tạo đơn (web); shop xem để đối soát |
| `paymentConfirmedAt` | datetime? | Khi shop đối soát xong CK |
| `trackingCode` | string? | Mã vận đơn khi giao |
| `note` | string? | Ghi chú của khách / nội bộ |
| `statusHistory[]` | StatusEvent[] | `{from, to, at, byUser, reason}` — **bắt buộc** cho huỷ/hoàn |

> **Personalization (khắc tên):** mỗi OrderItem có thể mang `{ text, zoneId }` — vị trí khắc là
> một trong các "điểm khắc hợp lệ" định nghĩa trên model. Lưu cả `text` lẫn `zone` để xưởng in
> đặt đúng chỗ.

### Các thực thể khác
| Thực thể | Trường chính |
|---|---|
| `PrintJob` (hàng đợi in) | `orderItemRef` · `stage` (Cần in · Đang in · Đóng gói · Đã giao) · `printer` · `colorName` · `eta` — **ánh xạ từ order status** |
| `Review` | `productId` · `customer` · `rating(1–5)` · `text` · `images[]` · `reply?` · `status(published/hidden)` · `createdAt` |
| `Customer` | `id` · `name` · `phone` · `email?` · `socialHandles[]` · `addresses[]` |
| `User` (nhân viên) | `id` · `name` · `email` · `role(owner/staff)` · `active` |
| `ReplyTemplate` (extension) | `id` · `title` · `body` · `variables[]` (vd `{tên}`, `{mã đơn}`, `{STK}`) |
| `Setting` | `shopInfo` · `bankAccount(VietQR)` · `shippingRules` · `returnPolicy` |

---

## 03 · Luồng & state từng màn

Thiết kế hi-fi thể hiện **happy path**. Mỗi màn chính cần bổ sung **empty · loading · error**.

### Storefront
| Màn | States cần có | Ghi chú |
|---|---|---|
| Catalog / danh sách | loading (skeleton) · empty (không kết quả lọc) · error (tải lỗi + thử lại) | Giữ bộ lọc khi reload; phân trang / "xem thêm" |
| Chi tiết sản phẩm | loading · hết hàng (màu `available:false`) · 404 | Khoá "Thêm vào giỏ" khi chưa chọn màu/khắc |
| Cá nhân hoá (khắc) | trống (chưa nhập) · text quá dài · vùng khắc không hợp lệ | Chữ chỉ "hít" vào điểm khắc hợp lệ trên model |
| Giỏ hàng | **giỏ rỗng** · cập nhật số lượng · xoá item · lỗi đồng bộ | Empty state có CTA "Khám phá bộ sưu tập" |
| Checkout | lỗi validate · đang gửi (disable nút) · **màn QR tĩnh + đính ảnh CK** · tạo đơn lỗi · thành công → link/tra cứu đơn | QR tĩnh + hướng dẫn CK (memo **không bắt buộc**); **đơn chỉ tạo sau khi gửi ảnh CK + xác nhận** |
| Tra cứu đơn | không tìm thấy (sai mã/SĐT) · loading | Hiện timeline trạng thái khi tìm thấy |

### Admin
| Màn | States cần có | Ghi chú |
|---|---|---|
| Dashboard | loading · chưa có đơn hôm nay | Số liệu rỗng hiển thị 0, không để trống |
| Đơn hàng | danh sách rỗng · lọc rỗng · lỗi · đổi trạng thái (confirm + lý do khi huỷ/hoàn) | Bộ lọc theo trạng thái dùng chung §04 |
| Hàng đợi in | không có việc cần in · kéo-thả đổi chặng · lỗi cập nhật | Ánh xạ stage ↔ order status |
| Sản phẩm | tạo mới · upload model/ảnh đang chạy · upload lỗi · nháp (draft) | Quản lý màu có tên + option có mô tả |
| Đánh giá | chưa có đánh giá · trả lời · ẩn/hiện | — |
| Cài đặt | lưu thành công · lỗi · chưa cấu hình STK (cảnh báo) | Thiếu STK → **chặn checkout web** |

### Extension
| Màn | States cần có | Ghi chú |
|---|---|---|
| Đăng nhập | chưa kết nối · sai thông tin · mất mạng | Chỉ hoạt động trên domain Messenger/IG |
| Tạo đơn nhanh | thiếu trường bắt buộc · tạo lỗi · tạo xong (toast + mã đơn) | Tự điền từ hội thoại nếu nhận diện được |
| Tra cứu đơn | không quét được mã trong tin nhắn · không tìm thấy | Nút "Cập nhật nhanh trạng thái" dùng bộ chung |
| Mẫu trả lời | chưa có mẫu · chèn 1 chạm | Hỗ trợ biến `{tên}`, `{mã đơn}`, `{STK}` |

---

## 04 · Bộ trạng thái đơn hàng (state machine dùng chung)

**Một enum duy nhất** — Web khách, Admin, Extension đều khớp. 5 mốc tiến trình + 2 ngoại lệ.

```
PENDING_CONFIRM → PAID → PRINTING → SHIPPING → COMPLETED
ngoại lệ (tách riêng):  CANCELLED   RETURNED
```

| Mã enum | Nhãn | Ý nghĩa & chuyển tiếp hợp lệ |
|---|---|---|
| `PENDING_CONFIRM` | Chờ xác nhận | Khách đã báo/đã CK, chờ shop đối soát → `PAID` hoặc `CANCELLED` |
| `PAID` | Đã thanh toán | Đã đối soát CK; vào hàng đợi in (= "Cần in") → `PRINTING` |
| `PRINTING` | Đang in | Đang in/đóng gói → `SHIPPING` |
| `SHIPPING` | Đang giao | Đã bàn giao vận chuyển (= "Đã giao" ở hàng đợi) → `COMPLETED` |
| `COMPLETED` | Hoàn tất | Trạng thái cuối của trục tiến trình |
| `CANCELLED` | Đã huỷ | **Ngoại lệ** — từ bất kỳ mốc nào trước Hoàn tất; bắt buộc `reason` |
| `RETURNED` | Hoàn hàng | **Ngoại lệ** — bom hàng/trả về; bắt buộc `reason` |

**Ánh xạ Hàng đợi in:** `Cần in` = PAID · `Đang in / Đóng gói` = PRINTING · `Đã giao` = SHIPPING.
Huỷ/Hoàn luôn hiển thị **tách riêng**, không phải một mốc tiến trình. Mọi lần đổi trạng thái ghi
vào `statusHistory {from, to, at, byUser, reason?}`.

---

## 05 · Validation & microcopy

### Quy tắc field (checkout & tạo đơn)
| Trường | Quy tắc | Thông báo lỗi (sentence case) |
|---|---|---|
| Tên | bắt buộc, 2–60 ký tự | "Bạn cho mình xin tên nhé." |
| SĐT | bắt buộc, regex VN `(0\|+84)…` 10 số | "Số điện thoại chưa đúng định dạng." |
| Email | tuỳ chọn, định dạng email | "Email này nhìn chưa hợp lệ." |
| Địa chỉ | bắt buộc đủ tỉnh/quận/phường + đường | "Vui lòng chọn đủ tỉnh, quận, phường." |
| Khắc tên | ≤ giới hạn ký tự theo vùng khắc (`maxChars`) | "Tên hơi dài so với vị trí khắc này." |
| Mã giảm giá | kiểm tra tồn tại + hạn dùng | "Mã này đã hết hạn rồi." |
| Tra cứu đơn | mã + SĐT phải khớp | "Không tìm thấy đơn khớp mã và số này." |

### Microcopy chuẩn (giọng Lumin: ấm, mộc, "chúng mình / bạn")
| Ngữ cảnh | Nội dung |
|---|---|
| Giỏ rỗng | "Giỏ còn trống — mình đi ngắm bộ sưu tập nhé." + nút *Khám phá bộ sưu tập* |
| Trấn an checkout | "Giao trong 3–5 ngày · đổi trả miễn phí trong 30 ngày" |
| Màn QR (sau checkout) | "Quét mã để chuyển khoản, rồi gửi ảnh biên lai và bấm xác nhận để chúng mình tạo đơn nhé. Đơn được xác nhận ngay khi chúng mình đối soát xong." |
| Toast tạo đơn (extension) | "Đã tạo đơn #LMN-2261 🎉" |
| Lỗi mạng chung | "Mất kết nối một chút — thử lại giúp mình nhé." |
| Hết hàng (màu) | "Màu này tạm hết nhựa — chọn màu khác nha." |

> **i18n:** sentence case mọi nơi. Tiền tệ VND mặc định `390.000₫`. Spec dùng mono `180 × 180 × 240 mm`.
> Tiếng Việt là ngôn ngữ chính; tách khoá chuỗi sẵn để thêm Anh sau.

---

## 06 · Responsive & breakpoints

| Breakpoint | Khoảng | Hành vi |
|---|---|---|
| Mobile | < 640px | Storefront 1 cột; nav thu gọn thành menu; CTA "Thêm vào giỏ" dính đáy |
| Tablet | 640–1024px | Lưới sản phẩm 2 cột; admin sidebar → drawer |
| Desktop | 1024–1440px | Storefront lưới 3–4 cột; admin sidebar cố định |
| Wide | > 1440px | Nội dung tối đa 1160–1320px, canh giữa, gutter 28px |

- **Storefront:** mobile-first. Hit target ≥ 44px. Giỏ & checkout ưu tiên 1 cột trên mobile.
- **Admin:** desktop-first; đã có bản mobile riêng (`designs/Lumin Admin Mobile - Hi-fi.dc.html`). Bảng cuộn ngang khi hẹp.
- **Extension:** panel cố định ~360–400px cạnh khung chat; **không** responsive theo viewport.

---

## 07 · Hành vi & animation

| Thành phần | Đặc tả |
|---|---|
| Transition chung | 120–300ms. Toggle/knob/toast dùng spring `cubic-bezier(.34,1.56,.64,1)`; drawer/sheet dùng `(.4,0,.2,1)` |
| Nút "pop" (CTA) | Bóng đặc 4px không blur. Hover: `translate(-1px,-1px)` bóng lớn hơn. Press: `translate(2px,2px)` lún vào bóng |
| Card | Hover nhấc 4px + bóng lớn hơn. Focus: ring sky 3px |
| Switch | Knob bật lò xo; track chuyển teal khi on |
| Marquee landing | Dải cocoa chạy lặp — animation trang trí **duy nhất** |
| Reduced motion | Tôn trọng `prefers-reduced-motion`: tắt entrance + dừng loop |

> 🐱 **Cat Peek** — tính năng "2 con mèo nhút nhát" có spec riêng đầy đủ ở `Cat Peek - Behavior Spec.md`
> và bản chạy được `designs/Lumin Cat Peek.dc.html`. Khi port: gắn `data-anchor` lên element làm chỗ núp,
> giữ 3 quy tắc cốt lõi (núp sau / trốn-tuck-vào-sau / chỉ chọn spot trong viewport), `pointer-events:none`,
> bọc checkout bằng `[data-no-cat]`, tôn trọng reduced-motion. **Đề xuất:** bật giai đoạn sau, không chặn
> release lõi thương mại.

---

## 08 · Auth · phân quyền · analytics

### Phân quyền nhân viên
| Vai trò | Quyền |
|---|---|
| `owner` | Toàn quyền: sản phẩm, cài đặt, STK, nhân viên, đối soát thanh toán |
| `staff` | Đơn hàng, hàng đợi in, trả lời đánh giá, dùng extension. **Không** sửa cài đặt/STK |

Storefront **có tài khoản khách** (đăng nhập + xem lịch sử đơn) — đã chốt. Vẫn cho đặt nhanh không
bắt buộc đăng nhập; khách vãng lai tra đơn bằng **mã đơn + SĐT**.

### Sự kiện analytics nên gắn
| Event | Khi nào |
|---|---|
| `product_viewed` | Mở chi tiết sản phẩm |
| `personalize_started` | Bắt đầu khắc tên / chọn màu |
| `add_to_cart` | Thêm vào giỏ (kèm color/option) |
| `checkout_started` · `order_placed` | Vào checkout · tạo đơn thành công |
| `order_status_changed` | Mỗi lần đổi trạng thái (admin/extension) |
| `extension_quick_order` | Tạo đơn nhanh từ chat |

---

## 09 · Tài nguyên & quyết định đã chốt

### Checklist tài nguyên
- ✅ **Đã có:** design tokens (`tokens/`); bộ component DS (xem `design-system.md`); logo SVG; tất cả màn hi-fi; spec Cat Peek.
- ⬜ **Cần bổ sung:** ảnh sản phẩm thật (hi-fi đang dùng placeholder "glow"); file model 3D (`.glb` để xem, `.stl`/`.3mf` để in).
- ⬜ Favicon, ảnh OG/social share, icon app (nếu có).
- ⬜ Nội dung thật: danh sách SP + giá VND + màu có tên + mô tả; chính sách đổi trả/vận chuyển; thông tin STK (VietQR).
- ⬜ Bộ mẫu trả lời (reply templates) cho extension.

### Quyết định đã chốt
| Hạng mục | Quyết định | Tác động kỹ thuật |
|---|---|---|
| Xem model 3D | **Có** — xoay 360° trên web | Ảnh card/list = **ảnh shop chụp**; hover (PC)/dừng-2s (mobile) → **360° sprite**; `model-viewer` (.glb) chỉ khi bấm "Xem 3D" (sprite làm fallback no-WebGL); worker render sprite, **KHÔNG poster** |
| Phí vận chuyển | **Theo khu vực** | Bảng phí ship theo vùng trong Settings; `shippingFee` tính ở server theo địa chỉ |
| Đối soát chuyển khoản | **Thủ công** | QR **tĩnh** (memo không bắt buộc); khách **gửi ảnh biên lai** khi đặt → shop **xem ảnh** đối chiếu số tiền → `PAID`; chưa cần webhook ngân hàng |
| Tài khoản khách | **Có** — tài khoản + lịch sử đơn | Thêm auth phía storefront + trang lịch sử đơn; vẫn cho đặt nhanh |
| Đa ngôn ngữ | **Chỉ tiếng Việt** lúc đầu, sẵn sàng i18n | Tách khóa chuỗi ngay, default `vi`; không hard-code text |
| Giới hạn ký tự khắc | Cấu hình **theo từng sản phẩm** lúc tạo | Trường `maxChars` trên Option/Product; validation khắc dựa vào giá trị này |
