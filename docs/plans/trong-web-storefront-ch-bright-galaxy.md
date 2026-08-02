# Checkout — thiết kế lại khu vực giá tiền

## Context

Owner đi thử `/thanh-toan` và thấy trải nghiệm phần giá chưa tốt. Nguyên nhân cụ thể (đã đọc code, không phải cảm tính):

- `checkout-view.tsx:503` đặt `<aside>` chứa thẻ "Đơn hàng" **đầu tiên trong source order**, nên **trên mobile toàn bộ tóm tắt + tổng tiền nằm ở đỉnh trang**, còn nút "Xác nhận đặt đơn" ở tận cuối (sau QR + upload biên lai). Khách phải cuộn ngược lên mới biết mình trả bao nhiêu — giá và nút bấm không bao giờ cùng khung nhìn.
- Thẻ tóm tắt (`checkout-view.tsx:411–483`) là một `const summary = (...)` inline trong file 905 dòng, không phải component — khó tái dùng ở vị trí khác.
- Danh sách món **không có giá từng dòng** (`:421–435`), dù quote API đã trả `lines[i].lineTotal` (`/gio-hang` đã dùng, checkout đang bỏ phí).
- Trên desktop cột phải dính (`lg:sticky lg:top-24`) hiển thị tổng, nhưng nút submit lại ở cuối cột trái — vẫn tách rời giá khỏi hành động.

**Kết quả mong muốn:** giá luôn đi cùng nút đặt hàng, có thể bung xem chi tiết cấu thành (tạm tính / phí ship / tổng), và mỗi món hiện giá riêng.

Hướng đã chốt với owner:
- **Mobile:** thanh dính đáy kiểu Shopee (tổng + nút), bấm "Chi tiết thanh toán" để bung breakdown; thẻ tóm tắt trên đầu thu gọn thành 1 dòng bung ra danh sách món.
- **Desktop:** nút submit chuyển vào thẻ tóm tắt cột phải, ngay dưới dòng Tổng cộng.
- **Có** giá từng dòng, đọc từ `lines[i].lineTotal` của server (không nhân/cộng ở client — ADR-019).

## Ràng buộc bắt buộc

- Mọi số tiền render qua `<PriceTag>` (`packages/ui/src/PriceTag.tsx`) → `formatVnd` (`packages/core/src/money.ts:16`). ESLint chặn `Intl`/`toLocaleString` ngoài `@lumin/core`. **Không có phép tính tiền nào ở client.**
- Chuỗi mới phải vào `apps/storefront/src/messages/vi.ts` namespace `checkout:` (`:259`), key flat camelCase, sentence case, giọng "chúng mình / bạn".
- Chỉ dùng class token semantic (`bg-surface-sunken`, `border-border-strong`, `text-text-muted`…). `bg-surface`/`text-success` là no-op im lặng.
- Hit target ≥ 44px, `:focus-visible` rõ, `motion-reduce:` cho mọi animation.
- Không thêm thư viện. Disclosure = native `<details>/<summary>` (pattern đã có ở `catalog-toolbar.tsx:60`).
- Giữ nguyên: `submitLatch` chống double-submit (ADR-033), dual-ack ADR-012, staleness guard của quote (`checkout-view.tsx:201`), `aria-live="polite"` khi tổng đổi.

## Layout mục tiêu

**Mobile (< lg)** — theo thứ tự cuộn:
```
Đặt hàng
▸ 3 món · Xem đơn hàng          ← <details> thu gọn, bung ra danh sách món + giá/dòng
[form: liên hệ → địa chỉ → đổi-trả → khắc → PDPL → QR → biên lai]
┌───────────────────────────── sticky bottom ─────────┐
│ ▸ Chi tiết thanh toán                                │  ← <details>, mở lên trên
│   Tạm tính              360.000₫                     │
│   Phí ship               30.000₫                     │
│ Tổng cộng 390.000₫   [ Xác nhận đặt đơn ]            │
└──────────────────────────────────────────────────────┘
```

**Desktop (lg:)** — 2 cột giữ nguyên `lg:grid-cols-[1fr_340px]`, cột phải dính:
```
[form nhập liệu]        │ Đơn hàng · 3 món
                        │ ─ danh sách món + giá/dòng ─
                        │ Tạm tính        360.000₫
                        │ Phí ship         30.000₫
                        │ ─────────────────────────
                        │ Tổng cộng      390.000₫
                        │ [ Xác nhận đặt đơn ]
```
Thanh dính mobile `lg:hidden`; thẻ tóm tắt đầu trang `lg:hidden`; `<aside>` cột phải `hidden lg:block`.

## Thay đổi

### 1. File mới `apps/storefront/src/components/checkout-summary.tsx`

Tách phần tóm tắt ra khỏi `checkout-view.tsx` (đang 905 dòng), export 3 thứ nhỏ, **không state riêng** — nhận hết qua props từ `checkout-view`:

- `SummaryLines({ items, lines })` — `<ul>` món: thumb 40px + tên + `×qty` + `<PriceTag amount={lines[i].lineTotal} />`.
  Giá/dòng chỉ render khi `lines` có mặt và `lines.length === items.length` (quote đã settle); chưa có thì bỏ trống (không skeleton từng dòng cho đỡ nhiễu).
  ⚠️ **Kiểm tra khi code:** `PriceQuoteLine` khớp **theo index** với mảng gửi lên. Xác nhận `quoteCart` trong `lib/quote.ts` nhận đúng `cartQuoteItems(items)` cùng thứ tự với `items` render ở đây; nếu `cartQuoteItems` lọc/gộp dòng thì phải map lại theo key thay vì index.
- `SummaryMoney({ quote, err, provinceChosen, onRetry })` — 3 dòng tiền + đủ 4 nhánh state đang có ở `checkout-view.tsx:437–481` (chưa chọn tỉnh → `shippingPending`; ok → ship + tổng; lỗi → alert + nút thử lại; đang quote → skeleton). Bê nguyên logic, chỉ đổi chỗ ở.
- `CheckoutTotalBar({ total, children, ...money })` — thanh dính mobile:
  ```tsx
  <div className="sticky bottom-[76px] z-30 -mx-4 border-t-2 border-border-strong bg-surface-page/95 px-4 py-3 backdrop-blur-sm lg:hidden">
    <details className="mb-2">
      <summary …>Chi tiết thanh toán</summary>
      <SummaryMoney … hideTotal />
    </details>
    <div className="flex items-center gap-3">
      <span>Tổng cộng <PriceTag amount={total} /></span>
      {children /* nút submit */}
    </div>
  </div>
  ```
  Công thức `sticky bottom-[76px] z-30 -mx-4 … backdrop-blur-sm` copy nguyên từ PDP (`product-detail.tsx:286`) — đã kiểm chứng, `sticky` chứ không `fixed`, `bottom-[76px]` để tránh `bottom-nav` (76px, z-40).
  `<details>` nằm **trên** dòng tổng và thanh neo đáy → mở ra tự nở **lên trên**, không cần JS, không cần `flex-col-reverse`.

`SummarySkeleton` hiện là local trong `checkout-view.tsx` → chuyển sang file mới, `checkout-view` import lại.

### 2. `apps/storefront/src/components/checkout-view.tsx`

- Xoá `const summary = (...)` (`:411–483`).
- Trong `<form>` (`:498`):
  - `<details className="lg:hidden">` thu gọn ở đầu: `<summary>` = "{count} món · Xem đơn hàng", nội dung = `<SummaryLines>`.
  - `<aside className="hidden lg:sticky lg:top-24 lg:col-start-2 lg:row-start-1 lg:block">` = thẻ `Đơn hàng` + `SummaryLines` + `SummaryMoney` + **nút submit** (`Button variant="pop" size="lg" className="w-full"`).
  - Cuối cột form: thay nút submit hiện tại bằng `<CheckoutTotalBar>` chứa nút submit (`lg:hidden`).
- **Hai `<button type="submit">` trong cùng form** (một cho mobile, một cho desktop) — chỉ một cái visible tại mỗi breakpoint, cùng dùng `submitDisabled`. `submitLatch` đã chặn double-submit.
- Giữ nguyên `submitDisabled`, `onSubmit`, `scrollIntoView` khi lỗi, ack hint, `formError`/`submitError` — các dòng lỗi này ở lại trong cột form (không nhét vào thanh dính).
- Cập nhật comment `:492–494` mô tả layout mới.

### 3. `apps/storefront/src/messages/vi.ts` (namespace `checkout`, `:259`)

Thêm: `summaryToggle: 'Xem đơn hàng'`, `paymentDetailsToggle: 'Chi tiết thanh toán'`. Không đổi key cũ (`subtotalLabel`/`shippingLabel`/`totalLabel`/`shippingPending`/`orderSummaryHeading`/`summaryItemCount` dùng lại nguyên).

### 4. `apps/storefront/src/app/thanh-toan/loading.tsx`

Skeleton hiện tại (`max-w-520`, 4 dòng field) không còn khớp layout mới → chỉnh cho khớp: khối form + khối thanh đáy.

## Rủi ro đã biết

- **Consent banner** (`consent-banner.tsx:59`) là `fixed bottom-[76px] z-50`, **sẽ che thanh dính** ở lượt truy cập đầu. Chấp nhận (banner dismiss một lần, đúng như PDP hiện nay), nhưng phải xem tận mắt ở bước verify — nếu che hẳn nút submit thì thêm padding-bottom cho form khi banner còn hiện.
- Thứ tự source hiện tại (summary trước form) là cố ý để mobile thấy tóm tắt trước. Thiết kế mới thay bằng `<details>` thu gọn ở đúng vị trí đó → không mất mục đích ban đầu.
- Thanh dính chiếm chỗ khi form đang có lỗi validate ở cuối → `scrollIntoView` hiện có cần kiểm tra lại là lỗi không bị thanh che.

## Verify

1. `pnpm --filter @lumin/storefront typecheck && pnpm --filter @lumin/storefront lint`
2. Chạy stack local theo `lumin-local-smoke-stack` (Postgres `:5433` + core-api `:8090` + storefront), mở Browser pane.
3. Ở `375×812` (mobile): thêm 2 món vào giỏ → `/thanh-toan`:
   - Thanh đáy hiện, có tổng + nút, **không bị `bottom-nav` che**, cuộn cả trang vẫn thấy.
   - Chưa chọn tỉnh → thanh hiện `shippingPending`, không hiện tổng giả.
   - Chọn tỉnh → skeleton → tổng về, `aria-live` báo.
   - Bấm "Chi tiết thanh toán" → bung **lên trên**, thấy tạm tính + phí ship.
   - `<details>` đầu trang bung ra thấy giá từng dòng, cộng lại đúng bằng tạm tính (đối chiếu bằng mắt, không tính ở client).
   - Chọn tỉnh không giao được → thấy `noShippingRule`, nút submit disabled.
4. Ở `1280×800` (desktop): nút submit nằm trong thẻ cột phải ngay dưới Tổng cộng, cột dính khi cuộn, thanh đáy biến mất.
5. Đặt thử một đơn thật đến `PENDING_CONFIRM` để chắc submit từ nút mới vẫn chạy (cả 2 nút cùng form).
6. `read_console_messages` sạch; kiểm `prefers-reduced-motion` (`resize_window` + DevTools) không có animation nào chạy.
7. Chạy `spec-guardian` trên diff trước khi coi là xong.
