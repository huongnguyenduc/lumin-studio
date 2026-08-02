# Plan — Sửa 13 vấn đề flow (Storefront · Admin · Lumin Pet)

## Context

Chủ tiệm đi thử end-to-end toàn bộ flow (mua → thanh toán → in → ghi NFC → giao, và Lumin Pet) và
liệt kê 13 điểm gãy. Chúng chia làm ba nhóm:

- **Thật sự lỗi/thiếu đường đi** — admin không có cách nào xem được ảnh chuyển khoản (bucket private,
  không tồn tại presigned GET); hàng đợi in thiếu chữ khắc nên người đứng máy không biết in gì; nút
  "gửi vị trí" của người nhặt được báo lỗi.
- **Ma sát UX** — checkout tách 2 bước không có lý do hợp đồng, không thấy ảnh biên lai đã up, không
  cuộn lên sau khi submit/tạo trang; giỏ hàng chỉ sửa được số lượng; đổi trạng thái đơn phải vào từng đơn.
- **Lệch thiết kế / lệch kỳ vọng** — tay cầm ⠿ hứa kéo-thả nhưng chỉ có nút ▲▼; khối giống/tuổi/nặng
  sơ sài so với `designs/Lumin Pet Tag - Hi-fi.dc.html`; trạng thái đơn không tự chạy theo hàng đợi in.

Kết quả mong muốn: chủ tiệm chạy lại đúng hành trình đó mà không phải giải thích/đi vòng ở bước nào.

**Hai quyết định đã chốt với người dùng, trái với hợp đồng đang có → cần ADR trước khi code:**
1. Đơn **tự** `PAID→PRINTING` theo hàng đợi in — trái D6 (tách rời chủ ý, ghi rõ ở
   `services/core-api/internal/httpapi/admin_print_queue.go:47-51`, `apps/admin/src/components/print-board.tsx:46`).
2. Bỏ trường `zalo` + `vetClinic` khỏi onboarding pet — trái `spec.md:371,399`.

`docs/decisions.md` / `conventions.md` bị hook chặn cứng → mở van `.allow-contract-edit` **sau khi trình
nguyên văn ADR và được đồng ý** (ADR-022, xem memory `contract-edit-deliberate`).

---

## Chia PR

Mỗi nhóm một PR, độc lập, theo thứ tự rủi ro giảm dần.

| PR | Phạm vi | Vì sao tách |
|---|---|---|
| **A** | core-api: presigned GET ảnh proof + hàng đợi in thêm chữ khắc/ghi chú + auto `PAID→PRINTING` | Chạm DB query + ADR + openapi |
| **B** | Admin UI: đổi trạng thái inline ở danh sách · xem ảnh proof · scroll+nhấp nháy sau ghi NFC | Thuần frontend admin, phụ thuộc A |
| **C** | Storefront checkout: gộp 1 bước · preview ảnh biên lai · scroll khi submit xong | Độc lập |
| **D** | Storefront giỏ hàng: modal sửa cấu hình | Độc lập, to nhất |
| **E** | Lumin Pet: form/hiển thị theo design · prefill · bỏ zalo+vetClinic · scroll · kéo-thả · fix chia sẻ vị trí | Độc lập |
| **F** | Trang `/lien-he` (nút "Nhắn shop" đang 404) + cài đặt kênh liên hệ ở Admin + popup nhắn shop toàn site | Độc lập, chạm cả 3 tầng |
| **G** | PDP: cột model sticky (desktop) + swatch màu trong thanh đáy (mobile) | Độc lập, thuần storefront |

---

## PR A — core-api

### A1. Presigned GET cho ảnh chuyển khoản (bug: `AccessDeniedForbidden`)

Hôm nay `apps/admin/src/components/order-detail-view.tsx:431` render `<a href={proofUrl}>` trỏ thẳng
vào `https://s3.luminstudio.vn/lumin-payment-proofs/...`. Garage v1.0.1 không có anon read và bucket này
**cố tình** private (ADR-046) → không có đường nào xem được. `proofstore` chỉ có `PresignPost`.

- `services/core-api/internal/proofstore/proofstore.go`: thêm `PresignGet(ctx, objectURL, ttl) (string, error)`.
  Dùng `client.PresignedGetObject` (minio-go đã có sẵn, cùng client). **Bắt buộc** gọi lại `OwnsURL()`
  trước khi ký để giữ host-pin CHK-04 — không cho ký URL tuỳ ý.
- `services/core-api/internal/httpapi/`: endpoint mới `GET /admin/orders/{id}/proof-url?kind=payment|refund|qc`
  (auth admin, cùng middleware như `GET /admin/orders/{id}`), trả `{url, expiresAt}`. TTL **10 phút**.
  Đọc URL từ chính order (không nhận URL từ client).
- `openapi.yaml`: schema `SignedAssetUrl { url, expiresAt }` + path mới. Nhớ `make oapi` / `sqlc` rồi
  **`git add` codegen trước khi chạy `make verify-go`** (stale-check so working-vs-index — memory
  `lumin-oapi-stale-check-needs-staged-regen`).
- `qcPhotoUrl` đi cùng bucket nên dùng chung endpoint (`kind`), tránh làm lại lần hai.

`ponytail:` không cache URL đã ký — 10 phút, mỗi lần mở đơn ký lại, rẻ hơn cache invalidation.

### A2. Hàng đợi in thiếu thông tin để in

`db/queries/jobs.sql:102 ListPrintQueue` và `GetPrintQueueEntry` (cùng file, ~line 115) không select
`oi.personalization` / `oi.option_choice_labels` / `o.note`, nên card ở
`apps/admin/src/components/print-board.tsx:254` không thể hiện chữ khắc.

- Thêm vào **cả hai** query (hai query phải cùng shape — comment trong file đã nói rõ):
  `oi.personalization`, `oi.option_choice_labels` (nếu cột tồn tại; nếu label nằm trong jsonb thì lấy
  nguyên jsonb như `part_colors` đang làm), `o.note AS order_note`.
- `openapi.yaml` schema `PrintQueueJob` (~line 5655): thêm `personalization?`, `optionChoiceLabels?`,
  `orderNote?` — **không đặt `default:`** cho mảng, nếu không TS sinh ra field bắt buộc (memory
  `lumin-openapi-default-makes-ts-required`).
- `internal/httpapi/admin_print_queue.go`: map thêm field.
- Card UI ở PR B.

### A3. Auto `PAID → PRINTING` (cần ADR mới)

Seam đúng nằm **trong** `withTx` của `AdvancePrintJobStage`
(`services/core-api/internal/httpapi/admin_print_queue.go:59`), sau khi update stage, trước khi đọc lại card:

1. Từ job → `order_item_id` → `order_id` (đã có trong `GetPrintQueueEntry`; `ListPrintQueue` cần thêm
   `oi.order_id` nếu dùng lại query).
2. Query mới trong `db/queries/jobs.sql`: đếm số job của đơn còn ở `NEED_PRINT`.
3. Nếu **0** còn ở `NEED_PRINT` **và** `order.status == PAID` → gọi
   `db.AdvanceStatusTx(ctx, tx, orderID, order.Printing, tctx)` với actor thật (role từ middleware).
   `PAID→PRINTING` không owner-only nên nhân viên làm được.
4. `statusHistory` ghi `reason` = key i18n kiểu `auto_print_stage` (luật always-must: **mọi** transition
   phải ghi statusHistory).

**Không** tự sang `SHIPPING` — cổng ảnh QC + mã vận đơn ở `transition.go` phải giữ. Không tự lùi lại.
Idempotent: nếu status đã ≥ PRINTING thì bỏ qua, không lỗi.

Test: thêm case vào test hiện có của print-queue — 2 item, đẩy 1 item → đơn vẫn PAID; đẩy nốt → PRINTING;
đẩy tiếp lần nữa → không đổi, không lỗi.

**ADR mới** trong `docs/decisions.md`: "hàng đợi in kéo hết ⇒ đơn tự sang Đang in", ghi rõ nó **thu hẹp**
D6 (chỉ một cạnh `PAID→PRINTING`, các cạnh còn lại vẫn tách rời) và vì sao (chủ tiệm một mình, hai nơi
bấm hai lần là nguồn lệch trạng thái). Cập nhật comment D6 ở `admin_print_queue.go:47-51` và
`print-board.tsx:46` cho khỏi drift.

---

## PR B — Admin UI

### B1. Đổi trạng thái ngay ở danh sách đơn

`apps/admin/src/components/orders-table.tsx` — nút "Đổi trạng thái" hàng loạt đang `disabled` (line 56-65).

- Thêm cột hành động: mỗi dòng một nút/menu nhỏ, item lấy từ **`availableTransitions(status, ROLE)`**
  (`apps/admin/src/lib/order-detail.ts`) — tái dùng, không viết lại luật.
- Chọn action → mở lại **`TransitionDialog`** (`apps/admin/src/components/transition-dialog.tsx`) đang
  dùng ở trang chi tiết, gọi **`transitionOrder`** (`apps/admin/src/lib/order-actions.ts`) → `router.refresh()`.
  Dialog đã tự lo `→SHIPPING` cần mã vận đơn + ảnh QC, nên không có đường vòng qua cổng.
- Giữ nút bulk `disabled` như cũ (ngoài phạm vi).

### B2. Xem ảnh chuyển khoản

`order-detail-view.tsx` `ProofLink` (line 431): đổi từ `<a>` sang thumbnail có preview.

- Client component nhỏ: gọi server action mới (wrap `GET /admin/orders/{id}/proof-url`) khi mount hoặc khi
  bấm "Xem ảnh", render `<img src={signedUrl}>` + link mở tab mới.
- Lỗi/hết hạn → nút "Tải lại". Không tự refresh theo timer.
- Áp cho cả `paymentProofUrl`, `refundProofUrl`, `qcPhotoUrl` (cùng card, line ~198-205).

### B3. Card hàng đợi in hiện chữ khắc

`print-board.tsx` `CardFace` (line 254): thêm dòng chữ khắc nổi bật (viền/nền cảnh báo nhẹ, `font-mono`,
`«{text}»`) + option choices + ghi chú đơn nếu có. Giữ nguyên "không tiền, không PII" (line 250) — chỉ
thêm dữ liệu cần để in. Key i18n mới ở `apps/admin/src/messages/vi.ts`.

### B4. Sau khi ghi chip: cuộn xuống "Đóng gói" + nhấp nháy

Redirect hiện tại: `apps/admin/src/app/api/nfc-confirm/[jobId]/[token]/route.ts` → `303 Location: /hang-doi-in`
(**giữ Location tương đối** — lý do ở comment line 42-47, đừng đổi).

- Đổi thành `Location: /hang-doi-in?encoded=<jobId>`.
- `apps/admin/src/app/(app)/hang-doi-in/page.tsx` đọc `searchParams.encoded`, truyền xuống `PrintBoard`.
- `DraggableCard` nhận `highlight` → `id={`job-${card.id}`}` + class nhấp nháy.
- `PrintBoard` effect: `document.getElementById(...)` → `scrollIntoView({block:'center'})`, bật highlight
  ~2.5s rồi tắt, và `router.replace('/hang-doi-in')` để F5 không nháy lại.
- **`prefers-reduced-motion`**: thay animation nhấp nháy bằng viền tĩnh (luật always-must).
- Card ghi chip xong nằm ở cột **PACKING (Đóng gói)**, sắp theo `created_at` → không chắc ở đầu cột, nên
  scroll là bắt buộc chứ không chỉ highlight.

---

## PR C — Storefront checkout

File chính: `apps/storefront/src/components/checkout-view.tsx` (887 dòng).

### C1. Gộp 2 bước thành 1

`step: 'info' | 'payment'` (line 99) tách C1/C2 nhưng **không có ràng buộc hợp đồng nào bắt tách**:
`.claude/rules/storefront.md:12` chỉ yêu cầu "QR tĩnh → đính ảnh biên lai + xác nhận → mới `POST /orders`".
`vietqrUrl` build server-side từ STK, **không phụ thuộc giỏ/tổng tiền** → hiện được ngay từ đầu.

- Bỏ state `step`, gộp về một `<form>`: thông tin nhận hàng → đổi-trả/PDPL/dual-ack → QR + upload biên lai
  → một nút "Xác nhận đặt đơn".
- `onSubmitInfo` (line 204) và `onSubmitOrder` (line 282) nhập thành một handler: chạy
  `validateCheckoutForm` trước; sai → hiện lỗi + focus field đầu tiên; đúng + đã có proof → `placeOrder`.
- Nút submit **không disable theo proof** nữa mà báo lỗi rõ "chưa đính ảnh biên lai" khi bấm — với form
  một trang, nút chết im lặng là bẫy.
- Giữ nguyên: `submitLatch` ref (chống double-submit, ADR-033), dual-ack ADR-012, `SubmittingScreen`,
  `WaitScreen`, ô "no STK configured".
- Bỏ header review người nhận + nút "Sửa" (line ~452) — thừa khi form ở ngay trên.
- Dọn key i18n chết trong `apps/storefront/src/messages/vi.ts` (`deliverToLabel`, `editLabel`,
  `recipientLine`, `addressLine`, `continueCta`…).

### C2. Preview ảnh biên lai

`ProofState` (line 37) chỉ giữ `fileName`; UI (line 546) in `"Đã đính kèm: {name}"`.

- Thêm `previewUrl` vào state `done` bằng `URL.createObjectURL(file)`, `revokeObjectURL` khi đổi ảnh /
  unmount (nếu không là rò bộ nhớ).
- Render thumbnail ~96–120px, bo góc, viền, `object-cover`, kèm tên file nhỏ + nút "Đổi ảnh khác".
- Giữ `aria-live="polite"` + text cho screen reader; ảnh `alt` mô tả.

`ponytail:` dùng object URL local, **không** phải presigned GET — ảnh vừa chọn nằm sẵn trong browser.

### C3. Cuộn lên khi submit xong

Toàn storefront hiện **không có** `scrollTo`/`scrollIntoView` nào.

- Khi `placed` → `WaitScreen` mount: `window.scrollTo({top: 0, behavior: 'smooth'})` +
  focus heading (`tabIndex={-1}` + `.focus()`) để screen reader cũng biết đã đổi màn.
- Cùng cách cho `submitError` (cuộn tới thông báo lỗi) và lỗi validate (cuộn tới field sai).
- Tôn trọng `prefers-reduced-motion` → `behavior: 'auto'`.

---

## PR D — Giỏ hàng sửa tại chỗ (modal)

Hôm nay `apps/storefront/src/components/cart-line.tsx` chỉ cho đổi số lượng + chọn/bỏ chọn; cấu hình là
chuỗi tóm tắt read-only. `CartItem` (`src/lib/cart.ts`) chỉ giữ **id + nhãn đã đóng băng**, không có
`colors/options/parts` → muốn sửa phải nạp lại dữ liệu sản phẩm.

1. **Nạp sản phẩm cho modal**: server action mới `apps/storefront/src/lib/product-fetch.ts` bọc
   **`fetchProductBySlug`** (`src/lib/catalog.ts:203`, server-only) → gọi khi mở modal, cache theo slug
   trong component. Không prefetch cả giỏ.
2. **Tách configurator khỏi PDP**: `apps/storefront/src/components/product-detail.tsx` (781 dòng) đang gói
   cả state chọn màu/part/option/khắc chữ. Tách phần **state + UI chọn** thành
   `product-configurator.tsx` nhận `initialSelection?`, `ProductDetail` dùng lại nó (không đổi hành vi PDP).
   Tái dùng nguyên: `canAddConfiguredToCart` + `buildCartItem` (`src/lib/product-view.ts:472`, `src/lib/cart.ts`)
   và `ColorSwatches` / `EngraveField`.
   *Đây là phần nặng nhất của cả plan — làm trước, để PDP xanh rồi mới gắn modal.*
3. **Reducer thay dòng**: thêm `replaceItem(state, oldKey, newItem)` vào `src/lib/cart.ts` (pure, có test ở
   `apps/storefront/test/cart.test.ts`). Phải xử lý: key mới trùng một dòng khác ⇒ gộp số lượng (clamp 99);
   **giữ `selected`**; **giữ vị trí** dòng cũ (`addItem` hiện append → dòng nhảy xuống cuối, không chấp nhận).
   Expose qua `useCart()` ở `src/lib/cart-store.ts`.
4. **UI**: `cart-line.tsx` thêm nút "Sửa" → `<CartEditDialog>` mới (dialog có focus trap, `Esc` đóng,
   `aria-modal`), seed từ `CartItem`, nút "Cập nhật" → `replaceItem`. Đóng modal → `cartSignature` đổi →
   tự re-quote (đã có sẵn ở `cart-view.tsx`).
5. Sản phẩm đã bị gỡ khỏi catalog (fetch trả `null`) → hiện thông báo + chỉ cho xoá.

Test: `cart.test.ts` cho `replaceItem` (gộp trùng key · giữ selected · giữ vị trí · clamp qty).

---

## PR E — Lumin Pet

### E1. Form hồ sơ theo design (`designs/Lumin Pet Tag - Hi-fi.dc.html` §2, ~line 185)

Design vẽ **ba ô có nhãn riêng, viền `1.5px solid #492F10`, `border-radius:12px`** cho Giống / Tuổi / Nặng;
hiện tại là ba `<Input className="w-24">` chen trong một flex row (`pet-onboarding.tsx:176-181`) và
`pet-editor.tsx`.

- Dựng lại thành lưới 3 ô có nhãn, dùng token của design system (đừng đoán hex; dùng class semantic —
  memory `lumin-tailwind-token-gotcha`: `bg-surface`/`text-success` là no-op câm).
- **Nặng**: giữ kiểu string trên wire (openapi không đổi), thêm **suffix "kg"** hiển thị trong ô +
  `inputMode="decimal"`. Nhãn "Nặng" → "Cân nặng".
- **Hiển thị** ở `pet-page.tsx:44` đang gộp `[breed, age, weight].join(' · ')` thành một dòng xám nhạt →
  đổi thành hàng **chip có nhãn** (mượn vocab pill của design line ~338: bo `14px`, viền `1.5px`, emoji +
  nhãn): `🐾 Giống · Corgi`, `🎂 Tuổi · 2`, `⚖️ Cân nặng · 11kg`. Ô rỗng thì ẩn chip.

### E2. Prefill liên hệ chủ

`page.tsx` (`apps/storefront/src/app/t/[shortId]/page.tsx`) đã gọi `hasCustomerSession()`.

- Đổi sang **`getCustomerProfile()`** (`src/lib/customer-session.ts`, đọc cookie `lumin_customer_profile`
  → `{name, email, phone}`), truyền `{name, phone}` vào `<PetOnboarding>` → seed `emptyOnboardingForm()`.
- Là **seed sửa được**, không phải nguồn chân lý (cookie hiển thị, không xác thực). Không thêm API mới.

### E3. Bỏ `zalo` và `vetClinic`

- Gỡ khỏi `pet-onboarding.tsx` (line ~242 cho vetClinic), `pet-editor.tsx`, `pet-onboarding-form.ts`,
  `pet-editor-form.ts`, key i18n trong `vi.ts` (~677-730, ~788+).
- Trường vẫn optional trên wire/DB → **không cần migration, không đổi openapi**. Chỉ thôi gửi. Hồ sơ cũ đã
  có zalo/vetClinic: quyết định hiển thị hay ẩn ở `pet-page.tsx` — mặc định **ẩn** cho nhất quán.
- Sửa `spec.md:371,399` cho khớp (spec là nguồn chân lý hành vi; spec-guardian sẽ soi drift).

### E4. Cuộn lên sau khi tạo trang xong

`pet-onboarding.tsx:50-73` set `done=true` → đổi sang `<DoneScreen>` tại chỗ, **không cuộn** → người dùng
đang ở cuối form thì nhìn vào khoảng trắng. Tương tự bước 1→2 (`goStep2`, line 41).

- `useEffect` khi `done` (và khi đổi step): `scrollTo({top:0})` + focus heading. Tôn trọng reduced-motion.

### E5. Kéo-thả thật ở trang sắp xếp

`pet-arrange.tsx` chỉ có ▲▼; glyph `⠿` là trang trí `aria-hidden` → hứa suông. Design §5b vẽ rõ
`cursor:grab`/`grabbing` + trạng thái "dragging (lifted)".

- Thêm `@dnd-kit/core` + `@dnd-kit/sortable` vào `apps/storefront/package.json` (đã dùng ở
  `apps/admin` print-board → dep quen thuộc trong repo, không phải dep mới toanh).
- Bọc danh sách khối bằng `DndContext` + `SortableContext`, `PointerSensor` + `KeyboardSensor`, handle là
  chính `⠿` (bỏ `aria-hidden`, cho nó `role`/label thật).
- **Giữ nút ▲▼** làm fallback a11y/bàn phím — cả hai gọi chung **`moveContentBlock`** (`src/lib/pet-blocks.ts`),
  không viết logic thứ hai.
- Khối `photo_name` vẫn ghim trên đầu, không kéo được.
- `prefers-reduced-motion` → tắt transition của dnd-kit.
- Chỉ sắp xếp **khối nội dung**; sắp xếp từng ảnh trong gallery ngoài phạm vi (`GalleryField` hiện chỉ
  thêm/xoá) — ghi `ponytail:` note.

### E6. "Gửi vị trí của tôi" báo lỗi

Chuỗi lỗi đang hiện là `petTag...denied: 'Chưa chia sẻ được vị trí'` (`vi.ts:766`) — **nhánh
`PERMISSION_DENIED`**, không phải lỗi mạng (nhánh mạng có copy khác). Nghĩa là request chưa từng rời
browser. Nguyên nhân xếp theo xác suất:

1. **Origin không phải HTTPS** — `navigator.geolocation` chết trên `http://<LAN-IP>:3000`. Quét NFC bằng
   điện thoại trỏ về LAN là trúng ngay. **Kiểm tra đầu tiên**: bấm thử trên `https://www.luminstudio.vn`.
2. Trình duyệt in-app (Zalo/Messenger/Facebook) chặn prompt vị trí → `PERMISSION_DENIED`.
3. Người dùng (hoặc lần thử trước) đã chọn "Chặn" cho origin — bấm lại vô ích, đúng như mô tả "ấn lại
   cũng không được".

Việc trong PR (`apps/storefront/src/components/finder-location-share.tsx`):
- Tách hẳn ba trạng thái lỗi: **không hỗ trợ / không phải HTTPS** (`!window.isSecureContext` →
  copy riêng, không nói "bạn từ chối"), **bị chặn** (hướng dẫn bật lại trong cài đặt trình duyệt +
  nhắc nút gọi/nhắn vẫn dùng được), **timeout/lỗi mạng** (cho thử lại).
- So `err.code === 1` thay vì `err.PERMISSION_DENIED` (hiện tại nếu error object không chuẩn thì
  `1 === undefined` → rơi nhầm nhánh).
- Thêm nút dự phòng **nhập/dán vị trí thủ công** hoặc mở link bản đồ, để người nhặt được luôn có đường
  báo tin kể cả khi geolocation chết.
- Xác nhận prod thật sự chạy HTTPS; nếu có `Permissions-Policy` ở đâu đó thì đảm bảo `geolocation=(self)`
  (hiện repo không set header nào → mặc định `self`, không phải nguyên nhân).

---

## PR F — Trang `/lien-he` (nút "Nhắn shop" 404)

**Chẩn đoán:** `apps/storefront/src/components/wait-screen.tsx:13` hardcode
`const SHOP_CONTACT_HREF = '/lien-he'` (3 chỗ dùng: đơn bị huỷ, màn theo dõi đơn, link hỏng), **và**
`site-footer.tsx` cũng trỏ `/lien-he`. Route đó **chưa bao giờ được dựng** (`apps/storefront/src/app/`
không có thư mục `lien-he`) → 404 ở cả hai nơi. Không phải lỗi link sai, là trang còn thiếu.

### F1. core-api — kênh liên hệ công khai

`settings.shopInfo` đã tồn tại (jsonb tự do, `openapi.yaml:5178`) nhưng **chỉ đọc được qua
`GET /admin/settings`**; `GET /checkout/config` **cố ý không lộ shopInfo PII** (`openapi.yaml:941`) —
đừng nhét kênh liên hệ vào đó, sẽ phá ranh giới đang có.

- `PATCH /admin/settings/shop-contact` (admin-gated, cùng khuôn `/admin/settings/refund-policy` ở
  `openapi.yaml:1412` — copy pattern đó, đừng nghĩ mới). Ghi vào `shopInfo.contact`.
- `GET /shop/contact` (công khai, có rate limit) trả **đúng** các kênh chủ tiệm đã điền:
  `{zalo?, facebook?, phone?, email?, address?, hours?}`. Field rỗng thì không trả — không có nghĩa là
  "công khai mọi thứ trong shopInfo", chỉ đúng danh sách khoá này.
- Schema `ShopContact` trong `openapi.yaml`, **mọi field optional, không `default:`** (memory
  `lumin-openapi-default-makes-ts-required`).

`ponytail:` không cần bảng riêng — `shopInfo` jsonb đang trống việc, thêm một cột/bảng cho 5 chuỗi là thừa.

### F2. Admin — form "Kênh liên hệ"

Thêm section vào `apps/admin/src/app/(app)/cai-dat` (đã có STK / phí ship / chính sách đổi-trả — bám đúng
cách các form đó gọi server action + `router.refresh()`). 5–6 ô text, lưu một phát.

### F3. Storefront — trang `/lien-he`

- `apps/storefront/src/lib/shop-contact.ts`: reader server-side, **copy nguyên khuôn**
  `src/lib/checkout-config.ts` (kể cả cách nuốt lỗi về một mã `error` — always-must #3, không rò prose backend).
- `apps/storefront/src/app/lien-he/page.tsx`: RSC, liệt kê từng kênh thành hàng bấm được
  (`https://zalo.me/…`, `tel:`, `mailto:`) + giờ làm việc + địa chỉ. Trang này **được index**
  (khác checkout/tra-cứu đang noindex) — thêm `generateMetadata` + JSON-LD `Organization`
  cho khớp luật SEO ở `.claude/rules/storefront.md:15`.
- Chủ tiệm chưa điền kênh nào → trang vẫn 200 với copy ấm ("chúng mình đang cập nhật…"), **không** 404.
- Giữ nguyên `SHOP_CONTACT_HREF` và link footer — sau PR này chúng trỏ vào trang có thật.

### F4. Popup "Nhắn shop" ở mọi trang

Cùng nguồn dữ liệu F1 → không có endpoint thứ hai, không hardcode link lần nữa.

- `<ShopContactSheet>` (client): bấm → sheet/popup liệt kê từng nền tảng thành nút lớn (Zalo · Messenger ·
  Gọi · Email), mỗi nút mở link tương ứng. Focus trap, `Esc` đóng, `aria-modal`, `prefers-reduced-motion`.
- **Desktop:** bóng chat nổi góc dưới-phải, render trong `layout.tsx` nên có ở mọi trang.
- **Mobile:** *không* dùng bóng nổi — thêm một mục "Nhắn shop" vào `bottom-nav.tsx` đã có, tránh chồng
  bottom-nav (76px) và thanh thêm-vào-giỏ sticky của PDP.
- Dữ liệu kênh fetch **một lần ở `layout.tsx`** (RSC, cùng `shop-contact.ts`) rồi truyền xuống — không gọi
  API mỗi lần mở popup.
- Chưa cấu hình kênh nào → **không render** nút/mục, thay vì popup rỗng.
- Popup có link "Xem trang liên hệ" → `/lien-he` (nơi có giờ làm việc + địa chỉ).
- `SHOP_CONTACT_HREF` ở `wait-screen.tsx:13`: giữ là link tới `/lien-he` (màn theo dõi đơn cần chỗ đọc kỹ,
  không phải popup vội).

---

## PR G — PDP: chọn màu mà không phải cuộn

Vấn đề: model 3D nằm ở cột media (`product-detail.tsx:335`, `md:w-[460px] md:shrink-0`, **không sticky**),
swatch màu/khắc chữ nằm dưới trong cột phải → chọn màu xong phải cuộn ngược lên xem model đổi.

**Desktop (`md:` trở lên):** cột media thành `md:sticky md:top-24 md:self-start`. Một dòng class. Cột phải
dài hơn nên cuộn tự nhiên, model đứng yên trong tầm mắt.

**Mobile:** thanh sticky đáy đã tồn tại (`product-detail.tsx:689`, `sticky bottom-[76px] z-30`). Thêm vào
**trên** hàng nút một dải swatch cuộn ngang:
- Sản phẩm phẳng → swatch màu; sản phẩm nhiều part (ADR-037) → chip chọn part đang sửa + swatch màu của part đó.
- Tái dùng đúng state + handler đang có (`selectedColorId` / `partColorByPart`) và component `ColorSwatches`
  (`product-detail.tsx:38`) — **không** nhân bản logic chọn màu, nếu không hai nơi sẽ lệch.
- Chỉ hiện khi thực sự có lựa chọn màu; sản phẩm một màu thì thanh giữ nguyên như cũ.
- Khối swatch gốc ở giữa trang **giữ nguyên** (nơi có nhãn tên màu, tuỳ chọn khác, khắc chữ) — thanh đáy là
  lối tắt, không phải bản thay thế; hai nơi cùng đọc/ghi một state nên luôn đồng bộ.
- Chiều cao thanh tăng → kiểm tra lại `bottom-[76px]` không che nội dung cuối trang (padding đáy của
  `<article>`).

`ponytail:` không đụng "model thu nhỏ dính đỉnh khi cuộn" trên mobile — sticky + swatch tại chỗ giải quyết
đúng cái đau, mà không phải chỉnh lại vòng đời WebGL.

---

## Kiểm chứng

**Off-box (làm được ngay):**
```bash
pnpm verify
```
- `pnpm --filter @lumin/storefront typecheck` chạy **riêng** sau khi đổi `schema.gen.ts` — Turbo cache che
  lỗi downstream (memory `lumin-turbo-cache-masks-typecheck`).
- Test admin đặt ở `apps/admin/test/**`, colocate `src/**/*.test.ts` sẽ **không chạy** mà vẫn xanh
  (memory `lumin-admin-vitest-test-dir`).
- Go: `cd services/core-api && git add <codegen> && make verify-go`. Hàng EARS phía Go trong
  `docs/acceptance.md` **giữ `[ ]`**, đánh `[x]` là gãy app-gate (memory `lumin-go-ears-stay-unchecked`).
- Migration mới (nếu A2 cần cột): đánh số **trên** số cao nhất đang có ở `main`, không theo slot plan
  (memory `lumin-migration-numbering-monotonic`).

**Test DB tích hợp (Docker local):**
```bash
colima start
```
rồi chạy go test với `DOCKER_HOST=unix:///Users/duchuong/.colima/default/docker.sock` +
`TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock` (memory `lumin-testcontainers-local-docker`).

**Smoke end-to-end trên máy** (dựng stack theo memory `lumin-local-smoke-stack`, dùng Browser pane, không đọc `.env`):
1. PDP → thêm giỏ → **bấm "Sửa" ở giỏ**, đổi màu + chữ khắc → dòng cập nhật đúng chỗ, tổng tiền re-quote.
2. Checkout **một trang**: điền form, chọn ảnh biên lai → **thấy thumbnail**, submit → **cuộn lên** màn chờ.
3. Admin `/don-hang`: **đổi trạng thái ngay ở dòng** → PAID. Mở chi tiết → **ảnh chuyển khoản hiện ra**.
4. `/hang-doi-in`: card hiện **chữ khắc**. Kéo hết item của đơn khỏi "Cần in" → quay lại `/don-hang`,
   đơn đã ở **"Đang in"**; `statusHistory` có dòng tự động.
5. Ghi chip (hoặc gọi tay route `/api/nfc-confirm/...`) → về `/hang-doi-in`, **cuộn tới cột Đóng gói**,
   card **nhấp nháy** rồi tắt.
6. `/t/{shortId}`: onboarding **prefill tên+SĐT**, ba ô Giống/Tuổi/Cân nặng theo design, **không còn Zalo
   / Phòng khám**, tạo xong **cuộn lên**. Trang sắp xếp: **kéo-thả được** + ▲▼ vẫn chạy.
7. Từ màn theo dõi đơn bấm **"Nhắn shop"** → ra `/lien-he` có kênh liên hệ (không còn 404); link ở
   **footer** cũng vậy. Xoá hết kênh trong Admin → trang vẫn 200 với copy chờ cập nhật.
8. Bóng "Nhắn shop" (desktop) / mục trong thanh đáy (mobile) → popup liệt kê đúng các kênh đã bật.
9. PDP **desktop**: cuộn xuống phần chọn màu, model vẫn nằm trong tầm mắt và đổi màu ngay.
   PDP **mobile**: đổi màu ngay ở thanh đáy, không cuộn, model phía trên đổi theo.
10. Vị trí: mở trang lost qua **HTTPS**, bấm "Gửi vị trí" → gửi được; chặn quyền → hiện đúng copy "bị chặn"
   kèm hướng dẫn, không phải thông báo chung chung.

**Trước khi coi là xong:** chạy `spec-guardian` trên diff của mỗi PR (đặc biệt PR A vì có ADR mới, và PR E
vì sửa `spec.md`).
