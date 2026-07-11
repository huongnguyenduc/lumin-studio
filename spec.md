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

**Kênh đặt hàng (`channel`):** đơn đến từ **web** (khách chuyển khoản + **gửi ảnh biên lai** → frontend tạo đơn ở `PENDING_CONFIRM` "Chờ xác nhận" để chủ đối soát) hoặc **inbox MXH**
(nhân viên **tự kiểm tra thấy tiền đã về** rồi mới bấm tạo đơn qua extension → đơn vào thẳng `PAID`, **không** qua "Chờ xác nhận"). Trường `channel` phân biệt 2 nguồn:
`web` · `inbox`. **Cả hai kênh: đơn chỉ tạo SAU khi đã chuyển khoản** — không tạo đơn ở bước checkout. Tạo đơn inbox-đã-`PAID` được phép cho cả nhân viên (xem RBAC §04).

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
| `model3dView` | {orbit θ,φ,radius · target x,y,z}? | Góc xem mặc định shop lưu cho viewer 3D (camera pose, map model-viewer `camera-orbit`/`camera-target`); không có = auto-frame. ADR-038 |
| `images[]` | Image[] | **Ảnh shop chụp**; ảnh đầu (`images[0]`) là ảnh đại diện trên card/list (hover/dừng-2s → 360° sprite) |
| `colors[]` | Color[] | Màu in **có tên** (xem dưới) |
| `parts[]` | Part[]? | Bộ phận có tên (Chao đèn/Đế/Nút bấm); mỗi part có bộ màu riêng. Không có = SP một-khối (màu phẳng). ADR-037 |
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
| `partId` | uuid? → Part (null = màu phẳng cấp SP, mặc định; set = màu của một bộ phận · ADR-037) |

### Part (bộ phận có tên)
| Trường | Kiểu |
|---|---|
| `id` | uuid |
| `name` | string · "Chao đèn" |
| `displayOrder` | int |

> Bộ phận là **tuỳ chọn** (ADR-037): SP một-khối không có part, `colors[].partId = null`. SP nhiều bộ phận:
> mỗi part có bộ màu riêng, khách chọn **một màu mỗi bộ phận** (đèn có chao/đế/nút khác màu). "Chọn part →
> sáng trên model" chỉ là state viewer (không thêm dữ liệu geometry vào catalog).

### Option (tuỳ chọn)
| Trường | Kiểu |
|---|---|
| `id` | uuid |
| `label` | string |
| `description` | string |
| `type` | enum: `text` · `choice` |
| `priceDelta` | int (VND) |
| `maxChars` | int? (giới hạn khắc, đặt khi tạo SP) |
| `choices[]` | OptionChoice[]? (chỉ type=choice; rỗng = toggle như cũ · ADR-037) |

### OptionChoice (lựa chọn của option)
| Trường | Kiểu |
|---|---|
| `id` | uuid |
| `label` | string · "M" |
| `description` | string · "12×9 cm · ~160g" |
| `priceDelta` | int (VND) |

> Chỉ cho option `type=choice` (ADR-037): rỗng = toggle như cũ (giá = option.priceDelta); có lựa chọn = khách
> chọn **một**, giá lấy từ lựa chọn đó (option base bỏ qua).

### Order & OrderItem
| Trường | Kiểu | Ghi chú |
|---|---|---|
| `id` / code | string | Mã hiển thị `#LMN-2261` |
| `channel` | enum | `web` · `inbox` |
| `status` | OrderStatus | Enum dùng chung — xem §04 |
| `customer` | Customer | Tên · SĐT · email · MXH handle |
| `shippingAddress` | Address | Đường · phường/xã · tỉnh (**bỏ quận/huyện**, ADR-017) |
| `items[]` | OrderItem[] | product · color · options · **personalization** · qty · unitPrice |
| `subtotal` · `shippingFee` · `total` | int (VND) | **Tính phía server**, không tin client |
| `paymentMethod` | enum | `bank_transfer` (giai đoạn 1) |
| `paymentProofUrl` | url? | Ảnh chụp biên lai CK khách đính khi tạo đơn (web); shop xem để đối soát |
| `paymentConfirmedAt` | datetime? | Khi shop đối soát xong CK |
| `refundProofUrl` | url? | Ảnh chụp CK hoàn tiền khi đơn vào `REFUNDED` (đối xứng `paymentProofUrl`) |
| `trackingCode` | string? | Mã vận đơn khi giao |
| `note` | string? | Ghi chú của khách / nội bộ |
| `statusHistory[]` | StatusEvent[] | `{from, to, at, byUser, reason}` — `reason` **bắt buộc** cho `CANCELLED`/`REFUNDED` |

> **Personalization (khắc tên):** mỗi OrderItem có thể mang `{ text, zoneId }` — vị trí khắc là
> một trong các "điểm khắc hợp lệ" định nghĩa trên model. Lưu cả `text` lẫn `zone` để xưởng in
> đặt đúng chỗ.

> **Cấu hình nhiều-trục (ADR-037):** với SP nhiều bộ phận / option có lựa chọn, OrderItem còn snapshot
> `partColors[]` (màu mỗi bộ phận) + `optionChoices[]` (lựa chọn mỗi option) — jsonb denormalized (kèm
> `colorName`/`hex`/`choiceLabel`). `color`/`options` phẳng giữ cho SP một-khối + **đơn lịch sử bất biến**.

### Các thực thể khác
| Thực thể | Trường chính |
|---|---|
| `PrintJob` (hàng đợi in) | `orderItemRef` · `stage` (Cần in · Đang in · Đóng gói · Đã giao) · `printer` · `colorName` · `eta` — **ánh xạ từ order status** |
| `Review` | `productId` · `customer` · `rating(1–5)` · `body` · `images[]` · `reply?` · `status(published/hidden)` · `createdAt` |
| `Customer` | `id` · `name` · `phone` · `email?` · `socialHandles[]` · `addresses[]` |
| `User` (nhân viên) | `id` · `name` · `email` · `role(owner/staff)` · `active` |
| `ReplyTemplate` (extension) | `id` · `title` · `body` · `variables[]` (vd `{tên}`, `{mã đơn}`, `{STK}`) |
| `Setting` | `shopInfo` · `bankAccount(VietQR)` · `shippingRules` · `refundPolicy` |

### Vật tư & chi phí (costing engine — ADR-039)
Mô hình giá vốn động (`/vat-tu`, design Admin screen 8). Tồn + giá vốn **derive từ lô** (không lưu), tiền int-VND, giá vốn/biên **tách khỏi giá khách**. Toàn bộ model ở **ADR-039**. Slice 4a land palette+lô; 4b land ledger tiêu hao + định-mức catalog + trừ-khi-in; **slice 4c-1** land máy + chi phí phụ + scrap-log; **slice 4c-2** land `OrderItem.costSnapshot` chốt-lúc-in (rollup máy/hao-hụt/phụ, best-effort SAU commit) + `products.estPrintHours` (định-mức giờ máy) + KPI read (`GET /admin/costing-summary`); FE 4-tab + snapshot card = 4d.
| Thực thể | Trường chính |
|---|---|
| `FilamentMaterial` (cuộn theo màu, shop-wide) | `id` · `name` (màu có tên) · `material` (PLA/PETG/Resin…) · `unit` (gram/ml) · `hex?` · `lowStockThreshold` · `archived` — **tồn + giá vốn/đơn-vị (bình quân gia quyền) DERIVE từ batches** |
| `FilamentBatch` (lô "nhập cuộn") | `id` · `materialId` · `importedAt` · `qtyOriginal` · `qtyRemaining` · `totalCostVnd` — ₫/đơn-vị-lô = total/original (derive); bình quân màu = `Σ(qtyRemaining × ₫/lô) ÷ Σ(qtyRemaining)` |
| `FilamentConsumption` (ledger tiêu hao — 4b) | `id` · `materialId` · `kind` (print\|scrap) · `qty` (**thực** đã trừ, clamp) · `costVnd` (FIFO thực, **đóng băng**) · `orderItemId?` · `productName?` · `reason?` · `note?` · `at` — nguồn chân lý; `qtyRemaining` = cache dựng-lại-được. Scrap (hao-hụt) = row `kind='scrap'` (4c-1, cùng helper trừ FIFO) |
| Định-mức catalog (4b) | `products.estFilamentQty` (SP phẳng) · `parts.estFilamentQty` (per-part, ADR-037 two-tone) · `colors.filamentMaterialId?` (màu → cuộn shop). Trừ-khi-in đọc để trừ FIFO khi print job **lần đầu** vào PRINTING (`filament_deducted_at` claim atomic idempotent) |
| `Machine` (giờ máy — 4c-1) | `id` · `name` · `purchasePriceVnd` · `depreciationMonths` · `expectedHoursPerMonth` · `isPrimary` · `active` — **₫/giờ DERIVE** = purchase ÷ (months × hours). Snapshot (4c-2) tính giờ máy theo máy `isPrimary` |
| `AuxCost` (chi phí phụ — 4c-1) | `id` · `label` · `kind` (per_order\|per_month) · `amountVnd`. Phân bổ/đơn **DERIVE** (4c-2) = `Σper_order + Σper_month ÷ max(1, đơn-thực-30d)` |
| Định-mức giờ máy (4c-2) | `products.estPrintHours` (per-item; lưu **phút chính xác** server-side, wire = giờ). machineVnd = estPrintHours × ₫/giờ máy `isPrimary` |
| `CostSnapshot` (giá vốn chốt-lúc-in — 4c-2, `order_items.cost_snapshot` jsonb NULL) | `filamentVnd` (=Σ `FilamentConsumption.costVnd` print, **đóng băng 4b**) · `machineVnd` · `wasteVnd` (=(filament+machine) × hệ-số-hao-hụt-30d) · `auxVnd` · `totalVnd` · +rate inputs (`estPrintHours`·`machineVndPerHour`·`wasteFactor`) · `at`. Chốt lúc job **lần đầu** vào PRINTING (best-effort SAU commit — lỗi→NULL "chưa chốt", backfill; KHÔNG cuốn đơn đã trả). Biên = giá bán − totalVnd (đọc). NULL ≠ ₫0 (oracle R1). Hệ-số-hao-hụt + đơn-thực-30d **cùng công thức** KPI (`GET /admin/costing-summary`) → biên khớp dashboard |

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

**Một enum duy nhất** — Web khách, Admin, Extension đều khớp. 5 mốc tiến trình + 2 trạng thái đóng đơn (huỷ / hoàn tiền).

```
PENDING_CONFIRM → PAID → PRINTING → SHIPPING → COMPLETED
đóng đơn (tách riêng):  CANCELLED (không hoàn tiền)   REFUNDED (đã hoàn tiền)
```
> **Điểm vào theo kênh:** web → `PENDING_CONFIRM`; inbox → thẳng `PAID` (nhân viên đã tự kiểm tra tiền trước khi tạo). `PENDING_CONFIRM` chỉ tồn tại ở kênh web.

| Mã enum | Nhãn | Ý nghĩa & chuyển tiếp hợp lệ |
|---|---|---|
| `PENDING_CONFIRM` | Chờ xác nhận | (Chỉ web) khách đã CK + gửi biên lai, chờ chủ đối soát → `PAID` hoặc `CANCELLED` |
| `PAID` | Đã thanh toán | Đã đối soát CK (web) / đã kiểm tra tiền (inbox); vào hàng đợi in (= "Cần in") → `PRINTING` · `CANCELLED` · `REFUNDED` |
| `PRINTING` | Đang in | Đang in/đóng gói → `SHIPPING` · `CANCELLED` · `REFUNDED` |
| `SHIPPING` | Đang giao | Đã bàn giao vận chuyển (= "Đã giao" ở hàng đợi) → `COMPLETED` · `CANCELLED` · `REFUNDED` |
| `COMPLETED` | Hoàn tất | **Terminal** — mốc cuối trục tiến trình, không có đường ra (không hoàn hàng) |
| `CANCELLED` | Đã huỷ | **Terminal** — đóng đơn **không hoàn tiền** (tiền chưa về, hoặc lỗi do khách + hàng đã in → giữ tiền); bắt buộc `reason` |
| `REFUNDED` | Đã hoàn tiền | **Terminal** — đóng đơn **đã chuyển tiền lại** khách (thường lỗi do shop); bắt buộc `reason` + `refundProofUrl` |

#### Bảng chuyển trạng thái (transition table — guard ở `packages/core`)
| from | → to | Ai được bấm (RBAC) | Điều kiện / guard | `reason` |
|---|---|---|---|---|
| *(tạo, web)* | `PENDING_CONFIRM` | Khách (frontend) | đã upload ảnh biên lai | — |
| *(tạo, inbox)* | `PAID` | Nhân viên/chủ (Extension) | đã **tự kiểm tra** thấy tiền về | — |
| `PENDING_CONFIRM` | `PAID` | **Chỉ chủ** | ảnh biên lai ↔ sao kê khớp số tiền | — |
| `PENDING_CONFIRM` | `CANCELLED` | Chủ/nhân viên | tiền không về / khách bỏ | ✅ |
| `PAID` | `PRINTING` | Nhân viên/chủ | thủ công, kéo trong hàng đợi in | — |
| `PRINTING` | `SHIPPING` | Nhân viên/chủ | có **ảnh QC** + mã vận chuyển | — |
| `SHIPPING` | `COMPLETED` | Nv/chủ/hệ thống | xác nhận đã giao | — |
| `PAID` · `PRINTING` · `SHIPPING` | `CANCELLED` | Chủ/nhân viên | đóng đơn, **không** hoàn tiền | ✅ |
| `PAID` · `PRINTING` · `SHIPPING` | `REFUNDED` | **Chỉ chủ** (tiền ra) | đã chuyển hoàn cho khách | ✅ + `refundProofUrl` |

**Cấm (guard chặn):** đi lùi (vd `PRINTING → PAID`), nhảy cóc (`PAID → SHIPPING`), mọi đường ra khỏi terminal (`COMPLETED`/`CANCELLED`/`REFUNDED`). `REFUNDED` **không** đạt được từ `PENDING_CONFIRM` (tiền chưa xác nhận) hay `COMPLETED`.

**Ánh xạ Hàng đợi in:** `Cần in` = PAID · `Đang in / Đóng gói` = PRINTING · `Đã giao` = SHIPPING.
Huỷ/Hoàn tiền luôn hiển thị **tách riêng**, không phải một mốc tiến trình. Mọi lần đổi trạng thái ghi
vào `statusHistory {from, to, at, byUser, reason?}`.

**Kế toán:** `Doanh thu ròng = (đơn đã thu: PAID/PRINTING/SHIPPING/COMPLETED) − (đơn REFUNDED)`. `CANCELLED` sau `PAID` mà không hoàn → shop **giữ tiền** = vẫn tính doanh thu. Hàng custom không nhập lại kho; chỉ ghi **filament đã tiêu thành phế phẩm** nếu huỷ sau PRINTING (Spoolman).

---

## 05 · Validation & microcopy

### Quy tắc field (checkout & tạo đơn)
| Trường | Quy tắc | Thông báo lỗi (sentence case) |
|---|---|---|
| Tên | bắt buộc, 2–60 ký tự | "Bạn cho mình xin tên nhé." |
| SĐT | bắt buộc, regex VN `(0\|+84)…` 10 số | "Số điện thoại chưa đúng định dạng." |
| Email | tuỳ chọn, định dạng email | "Email này nhìn chưa hợp lệ." |
| Địa chỉ | bắt buộc đủ tỉnh/phường + đường | "Vui lòng chọn đủ tỉnh, phường và đường." |
| Khắc tên | ≤ giới hạn ký tự theo vùng khắc (`maxChars`) | "Tên hơi dài so với vị trí khắc này." |
| Mã giảm giá | kiểm tra tồn tại + hạn dùng | "Mã này đã hết hạn rồi." |
| Tra cứu đơn | mã + SĐT phải khớp | "Không tìm thấy đơn khớp mã và số này." |

### Microcopy chuẩn (giọng Lumin: ấm, mộc, "chúng mình / bạn")
| Ngữ cảnh | Nội dung |
|---|---|
| Giỏ rỗng | "Giỏ còn trống — mình đi ngắm bộ sưu tập nhé." + nút *Khám phá bộ sưu tập* |
| Trấn an checkout | "Giao trong 3–5 ngày · in lại miễn phí nếu lỗi do shop" |
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

---

## 10 · Pet Tag NFC (định danh thú cưng)

> Bản thiết kế: `designs/Lumin Pet Tag - Hi-fi.dc.html`. Tính năng mới — bán qua storefront, có trang quản trị riêng ở admin.

Pet Tag NFC là **vòng định danh in 3D theo đơn** gắn chip NFC. Khách mua như **một sản phẩm bình thường**
trong storefront (tái dùng đúng khung product detail: status bar, swatch màu, pill nắng, thanh "Thêm vào giỏ").
Sau khi nhận hàng: **chạm điện thoại vào tag → mở trang riêng của bé** ngay trên trình duyệt (không cần app).
Trang pet dùng bố cục "link-in-bio" (layout A) với **1 URL · 3 trạng thái xem** và **công tắc thất lạc** bật
chế độ cứu hộ + gửi GPS cho chủ.

> Pet Tag **không** phải một template riêng — nó là một `Product` + một lớp "trang pet" động. Đơn Pet Tag chạy
> **đúng state machine §04** (`PENDING_CONFIRM → … → COMPLETED`). Việc **kích hoạt & tạo trang pet** diễn ra
> **sau giao hàng**, tách hẳn khỏi vòng đời đơn.

### Sản phẩm Pet Tag (mở rộng Product)
| Trường | Giá trị mẫu | Ghi chú |
|---|---|---|
| `productType` | `nfc_tag` | enum mới trên Product: `standard` · `nfc_tag`. `nfc_tag` báo storefront/admin cần cấp tag + kích hoạt |
| `name` | "Pet Tag NFC" | Hiển thị "Vòng định danh · SMART TAG" |
| `basePrice` | `390000` | `390.000₫`; compare-at `520000` (`520.000₫`, −25%) |
| `material` | `recycled-PLA` | "rPLA tái chế" |
| `dimensions` | `32 mm ø` | Mono; tag tròn đường kính 32 mm |
| `nfcChip` | `NTAG215` | Mono. Mỗi tag in ra → 1 bản ghi `PetTag` với URL quét riêng |
| `colors[]` | swatch 34px | Như mọi SP — chọn màu in, mẫu 3D đổi màu ngay |

### Data model — thực thể mới
**PetTag** (vòng vật lý)
| Trường | Kiểu | Ghi chú |
|---|---|---|
| `id` / `code` | string | Mã hiển thị `#LMN-T0231` |
| `orderItemRef` | uuid → OrderItem | Đơn bán tag (dùng chung Order/PrintJob) |
| `status` | enum | `UNENCODED` · `ENCODED` · `ACTIVATED` — xem "Trạng thái tag" dưới |
| `chipUid` | string? | UID chip NFC, ghi nhận khi encode |
| `url` | string | Ghi vào chip — `lumin.pet/t/{shortId}` |
| `profileId` | uuid? → PetProfile | `null` đến khi kích hoạt |
| `ownerAccountId` | uuid? → Account | Gắn khi khách **đăng nhập lần đầu** |
| `encodedAt` · `activatedAt` | datetime? | Mốc ghi chip · mốc kích hoạt (ISO-8601 UTC) |

**PetProfile** (trang của bé)
| Trường | Kiểu | Ghi chú |
|---|---|---|
| `id` · `tagId` · `ownerAccountId` | uuid | Thuộc 1 tag & 1 tài khoản khách (§08) |
| `petName` · `species` · `breed` · `age` · `weight` | string · enum(`dog`/`cat`/`other`) · … | Hồ sơ bé (bước 1 onboarding) |
| `photoUrl` · `gallery[]` | url · Image[] | Ảnh đại diện + album |
| `bio` · `favorites[]` | text · string[] | Giới thiệu + chip "khoái khẩu" |
| `medical` | `{vaccinated, neutered, allergies, vetClinic}` | Cảnh báo dị ứng hiển thị nổi bật |
| `ownerContact` | `{name, phone, zalo, email?}` | **Hiện khi bé thất lạc; `phone` bắt buộc** |
| `socials[]` | `{platform, handle}[]` | Instagram · TikTok… (tuỳ chọn) |
| `lostMode` | bool | Mặc định `false` (ở nhà); chủ gạt bật |
| `theme` | `{palette, background, bgOpacity, nameFont}` | 5 colorway brand + Đêm cocoa; nền ảnh riêng có độ mờ |
| `blocks[]` | ProfileBlock[] | Thứ tự & ẩn/hiện khối nội dung |

**ProfileBlock** (khối nội dung): `id` · `type` enum `photo_name` · `bio` · `gallery` · `favorites` · `medical` · `socials` · `order` int · `visible` bool.
> Khối `photo_name` (ảnh & tên) **luôn ở đầu, không ẩn được**.

**LostEvent** (lượt quét khi lạc / chia sẻ vị trí): `id` · `tagId` · `scannedAt` · `finderLocation?` `{lat,lng}` (chỉ khi người nhặt **đồng ý gửi 1 lần**) · `ownerNotifiedAt?`. Dùng cho thông báo "Bơ vừa được quét tại {khu vực}" + mở bản đồ.

> **Quan hệ:** `PetTag` 1–1 `PetProfile` (sau kích hoạt) · `PetTag.orderItemRef` → OrderItem · `PetProfile.ownerAccountId` → Account (= tài khoản khách §08). Một tài khoản có thể có **nhiều** PetProfile (nhiều bé).

### Trạng thái tag (fulfillment)
| Mã enum | Nhãn | Ý nghĩa & chuyển tiếp |
|---|---|---|
| `UNENCODED` | Chờ ghi chip | Tag đã in, chip trắng. Nhân viên ghi URL → `ENCODED` (chặng **"Ghi chip NFC"** trong hàng đợi in, **giữa Đang in và Đóng gói**) |
| `ENCODED` | Đã ghi | Chip đã ghi URL & **khoá chống ghi đè**; đóng gói & giao. Chờ khách quét + đăng nhập → `ACTIVATED` |
| `ACTIVATED` | Đã kích hoạt | Đã gắn tài khoản + có `PetProfile`. Trang pet hoạt động; chủ tự sửa được |

> Đây là vòng đời **vật lý của tag**, song song nhưng **tách khỏi** OrderStatus §04 (đơn vẫn `PENDING_CONFIRM → … → COMPLETED`). "Ghi chip NFC" là **chặng PrintJob mới** chỉ áp cho SP `nfc_tag` (xem "Vận hành admin" dưới).

### Luồng kích hoạt & onboarding (quét lần đầu)
1. **Quét tag mới (2a):** URL `lumin.pet/t/{shortId}` của tag `ENCODED` → "Đã nhận tag mới" → đăng nhập (Google / email). **Tag tự gắn vào tài khoản** vừa đăng nhập — **không nhập mã, không bước "kích hoạt" riêng**, **bỏ field số microchip**.
2. **Hồ sơ bé — bước 1/2 (2b):** ảnh · tên · loài · giống · tuổi · nặng · dị ứng/lưu ý y tế.
3. **Liên hệ · y tế · social — bước 2/2 (2c):** liên hệ chủ (tên, SĐT, Zalo) · y tế (tiêm phòng, triệt sản, phòng khám — tuỳ chọn) · social (instagram, tiktok — tuỳ chọn).
4. **Xong (2d):** `PetTag.status → ACTIVATED` (gắn `ownerAccountId` + tạo `PetProfile`); trang pet sẵn sàng. Từ giờ chạm tag là mở.
> Lần quét **sau** (tag `ACTIVATED`): mở thẳng trang pet theo trạng thái xem, bỏ qua onboarding.

### 1 URL · 3 trạng thái + công tắc thất lạc
Công tắc thất lạc = cờ **`lostMode` (bool)** trên PetProfile: **`false`** (ở nhà, mặc định) ↔ **`true`** (thất lạc).
Chỉ **chủ** bật/tắt; đặt ngay đầu trang. Mỗi lần bật/tắt tạo dấu vết (audit) để hỗ trợ thông báo & an toàn.
Routing nhận diện trạng thái xem theo **auth (chủ/người lạ) + `lostMode`**.

| Người xem | `lostMode` | Màn |
|---|---|---|
| **Chủ** (đăng nhập, là owner) | bất kỳ | Layout A **có sửa** (nút ✏️ Sửa trang) + công tắc |
| Người lạ | `false` | **4c** — layout A **chỉ-đọc**, nhãn "🏠 ở nhà · safe", nút liên hệ sen, không nút sửa |
| Người lạ | `true` | **4a** — chế độ cứu hộ: banner "Mình đi lạc rồi! / I'm lost", cảnh báo dị ứng, gọi/Zalo/email sen + **chia sẻ vị trí 1 lần** |

**Cứu hộ → gửi vị trí (4a → 4b):** người nhặt bấm "Gửi vị trí của tôi" → **đồng ý** → **1 lượt** ping vị trí → tạo `LostEvent`, báo chủ ("Bơ vừa được quét tại {khu vực}" + bản đồ + gọi người nhặt). **Chỉ gửi một lần.**

### States cần có (màn mới — ngoài happy path)
| Màn | States |
|---|---|
| Trang pet (`lumin.pet/t/{shortId}`) | loading (skeleton) · tag `UNENCODED`/`ENCODED` chưa kích hoạt (chủ → onboarding; người lạ → "trang chưa sẵn sàng") · 404 (shortId sai) |
| Onboarding 2b/2c | lỗi validate field · đang lưu · lưu lỗi |
| Chia sẻ vị trí (4a) | **từ chối quyền vị trí** (fallback: vẫn gọi/nhắn được) · đang gửi · gửi lỗi · đã gửi (4b) |
| Sửa tại chỗ (5a) / sắp xếp (5b) | đang lưu · lưu lỗi · offline |
| Theme sheet (6) | upload ảnh nền đang chạy/lỗi |

### Validation & microcopy (Pet Tag)
| Trường | Quy tắc | Thông báo (sentence case) |
|---|---|---|
| Tên bé | bắt buộc, 1–40 ký tự | "Bé tên gì nhỉ?" |
| `handle` | auto từ tên, **unique**, slug | "Tên trang này có bé khác dùng rồi — đổi chút nhé." |
| SĐT chủ | regex VN; **cần** để lost mode hữu ích | "Số điện thoại chưa đúng định dạng." |
| instagram / tiktok | tuỳ chọn, là handle (không full URL) | "Chỉ cần tên người dùng thôi nha." |
| Ảnh nền | jpg/png, ≤ giới hạn dung lượng | "Ảnh hơi nặng — chọn ảnh nhẹ hơn giúp mình." |
| Độ mờ nền | 0–100, mặc định 40 | — |

| Ngữ cảnh | Nội dung |
|---|---|
| Lost mode TẮT | "Bơ đang an toàn ở nhà" · phụ: "Gạt sang phải khi bé đi lạc — trang sẽ chuyển sang chế độ cứu hộ & gửi GPS." |
| Banner cứu hộ (4a) | "📣 Mình đi lạc rồi!" / "I'm lost — please help me get home" |
| Xin vị trí (4a) | "Chia sẻ vị trí của bạn để gửi cho sen biết bé đang ở đâu. Chỉ gửi một lần." |
| Đã gửi (4b) | "Đã gửi vị trí cho sen của Bơ! Cảm ơn bạn đã giúp đỡ 🎉" |
| Người lạ · ở nhà (4c) | "Mình không bị lạc đâu — chỉ là chào bạn thôi! 😄" · footer "Chỉ chủ mới sửa được trang này · powered by Lumin" |

### Theme trang pet (chi tiết ở `design-system.md`)
**5 bảng màu dựng sẵn** — Bơ · Bạc hà · Cam nắng · Trời xanh · Nắng — + **Đêm cocoa** (dark). Mỗi bảng đổi
**nền + chip + nút CTA** cùng lúc. Nền: Chấm bi · Trơn · Vân giấy · **Ảnh riêng** (opacity slider, mặc định 40%).
Phông tên: Bricolage · Space Mono. **Không picker tự do.** Theme áp cho **cả 3 trạng thái**; nhưng **chế độ
thất lạc giữ dải cam-đỏ cảnh báo**, ô cảnh báo dị ứng và nút gọi khẩn luôn dùng **màu hệ thống** — theme
**không** ghi đè (ưu tiên an toàn).

### Privacy & tuân thủ (PDPL)
- Trang pet **công khai** (ai quét cũng xem) → **tối thiểu hoá dữ liệu**: SĐT chủ **che một phần** công khai
  (vd `+84 90 •••• 261`); số đầy đủ + nút gọi chỉ lộ khi `lostMode = true` ("hiện khi bé lạc") hoặc cho chủ.
- **Vị trí người nhặt:** chỉ thu khi người nhặt **đồng ý**, **gửi một lần**, dùng để báo chủ; nêu rõ mục đích
  trước khi xin quyền; lưu tối thiểu, có **hạn lưu (retention)** + cho phép xoá.
- Chủ pet = tài khoản khách storefront (§08); chủ kiểm soát **ẩn/hiện từng khối** & thông tin.
- ⚠️ **Phải theo `docs/compliance.md` + skill `vn-compliance`** (consent log/replay, PDPL) **trước khi hoàn tất**
  luồng chia sẻ vị trí & lưu PII bé/chủ. Ghi consent tại 2 điểm: (1) tạo profile (PII bé + chủ), (2) người nhặt chia sẻ vị trí.

### Sự kiện analytics (Pet Tag)
| Event | Khi nào |
|---|---|
| `pettag_scanned` | Mỗi lần quét (kèm `state`: encoded · home · lost) |
| `pet_activated` | Hoàn tất onboarding (tag → `ACTIVATED`) |
| `lostmode_toggled` | Bật/tắt công tắc thất lạc |
| `finder_location_shared` | Người nhặt gửi vị trí thành công |
| `pet_profile_edited` · `pet_theme_changed` | Sửa nội dung · đổi giao diện |

### Hành vi / a11y
- Tôn trọng `prefers-reduced-motion` (toggle lò xo, sheet, entrance). Hit target ≥ 44px (mobile-first, thao tác **1 tay**).
- **Sửa tại chỗ:** 1 chạm = 1 việc — bỏ nút ✎ riêng từng dòng; "sắp xếp khối" (kéo ⠿, gạt ẩn/hiện) tách thành chế độ riêng để khỏi bấm lộn.

### Vận hành admin (Pet Tag)
> Thiết kế: `designs/Lumin Admin - Hi-fi.dc.html` · `designs/Lumin Admin Mobile - Hi-fi.dc.html` (#9 · Pet Tag NFC, "Vòng đời 1 tag").

- **Hàng đợi in** có thêm chặng **"Ghi chip NFC"** (giữa *Đang in* và *Đóng gói*) — **chỉ** áp cho SP `nfc_tag`; ánh xạ `PrintJob.stage`. Ghi URL `lumin.pet/t/{shortId}` (NDEF) vào chip NTAG215, **ghi 1 lần rồi khoá**, lưu `chipUid` + `encodedAt` → tag `ENCODED`.
- Màn **Pet Tag** (admin + admin mobile *tab Thêm*, màn #9): liệt kê tag, **lọc theo 3 trạng thái** `UNENCODED` / `ENCODED` / `ACTIVATED`; xem `chipUid`, URL, chủ (@handle), trạng thái thất lạc ("Chủ đã bật chế độ thất lạc · 2 giờ trước").

### Quyết định đã chốt (Pet Tag)
| Hạng mục | Quyết định | Tác động kỹ thuật |
|---|---|---|
| Chip & ghi dữ liệu | **NTAG215**, ghi URL **1 lần + khoá** | Web NFC / app ghi NDEF; lưu `chipUid`, `encodedAt` |
| URL trang pet | **`lumin.pet/t/{shortId}`** — mở trình duyệt | Không cần app; routing nhận diện 3 trạng thái xem theo **auth + `lostMode`** |
| Kích hoạt | Đăng nhập (Google/email) → **tag tự gắn tài khoản** | Không nhập mã; bỏ bước "kích hoạt" rườm rà |
| Tùy chỉnh trang | **Sửa-tại-chỗ (WYSIWYG)** + chế độ Sắp xếp khối riêng | Block-based; khối `photo_name` cố định trên cùng |
| Giao diện | **5 colorway brand + Đêm cocoa**; nền ảnh riêng có độ mờ | Không picker tự do; cocoa luôn là chữ/viền; cảnh báo dị ứng & nút khẩn **không** bị theme ghi đè |
| Chế độ thất lạc | Mặc định **TẮT**; chủ gạt bật; GPS người nhặt **gửi 1 lần** | Cờ `lostMode`; tạo `LostEvent` + thông báo chủ |
| Vận hành admin | Thêm chặng **Ghi chip NFC** + màn Pet Tag liệt kê tag | Map vào `PrintJob.stage`; danh sách lọc theo 3 trạng thái |
