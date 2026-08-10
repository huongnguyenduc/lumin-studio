# PDP redesign — fix thanh color + sticky bar, "đẹp hơn & dễ mua hơn"

## Context
Owner báo 2 lỗi trên PDP mobile (`/san-pham/[slug]`): (1) thanh color trong sticky bar hiển thị lỗi — ring chọn màu bị cắt trên/dưới (`overflow-x-auto` + `py-0.5` 2px < ring ~3px), swatch 32px vi phạm hit-target 44px, không có focus ring; (2) sticky CTA đặt `bottom-[76px]` nhưng bottom-nav thực tế chỉ ~60px → hở dải ~16px thấy content cuộn phía sau, bar dạng blur mờ trong khi hi-fi là footer đặc có border-top + khối "Tổng/giá". Owner chọn **redesign PDP đầy đủ** (multi-PR) và **bỏ hẳn MobileColorBar** (giữ 1 picker duy nhất — ColorSwatches 44px trong configurator).

Files chính: `apps/storefront/src/components/product-detail.tsx` (489L), `src/app/san-pham/[slug]/page.tsx`, `product-configurator.tsx`, `color-swatches.tsx`, `product-reviews.tsx`, `bottom-nav.tsx`, `src/messages/vi.ts`. Hi-fi: `designs/Lumin Storefront - Hi-fi.dc.html` (mobile PDP ~L400-435, desktop ~L845-865).

Nguyên tắc: reorder + restyle JSX sẵn có, zero component mới, 1 prop mới duy nhất (`children` trên ProductDetail). Không đụng server/API.

---

## PR 1 — Fix sticky bar + xoá MobileColorBar (bug-fix)

Tất cả trong `product-detail.tsx`.

1. **Xoá `MobileColorBar` + `SwatchRow`** (~L391-489) + call site (~L291) + import không còn dùng — trong MỘT lượt edit sạch (ESLint PostToolUse hook block trên unused-import tạm thời). i18n: KHÔNG xoá key nào — `selectColorLabel`/`colorUnavailableLabel` vẫn dùng ở `product-configurator.tsx:167`.
2. **Restyle sticky bar** (~L286) thành footer đặc theo hi-fi: `sticky bottom-[60px] z-30 -mx-4 border-t-2 border-border-default bg-surface-card px-4 pb-3.5 pt-[11px] md:static md:m-0 md:border-0 md:bg-transparent md:p-0`. Bỏ `bg-surface-page/95 backdrop-blur-sm`. Tune offset thực tế bằng devtools so với BottomNav (~60px); comment trỏ tới `bottom-nav.tsx`.
3. **Khối "Tổng / giá"** bên trái bar (mobile): label mono uppercase + `PriceTag amount={product.basePrice}`. Chỉ hiện GIÁ GỐC (server tính tổng — không nhân client); khi có option delta hoặc qty > 1 thêm tiền tố "từ".
   - i18n mới trong `vi.ts` `productDetail`: `stickyTotalLabel: 'Tổng'`, `stickyFromPrice: 'từ'`.
4. Giữ nguyên QuantityStepper + CTA layout (đã ≥44px).

Verify: `pnpm turbo run typecheck --filter=@lumin/storefront` + lint (chạy trực tiếp per-filter — Turbo cache gotcha) + vitest; browser smoke 375px: hết hở giữa bar và nav, bar đặc có border-top, chọn màu chỉ còn qua configurator. Screenshot 1 mobile + 1 desktop vs hi-fi trong PR body.

## PR 2 — Reorder section theo hi-fi + specs dạng dl ("đẹp hơn")

Trong `product-detail.tsx` (+ `color-swatches.tsx`, `vi.ts`).

1. **Reorder cột info theo hi-fi:** eyebrow → tên → giá+rating → ConfiguratorFields → qty+CTA bar → **mô tả** → specs. Cụ thể: dời block description (~L268) từ trên ConfiguratorFields xuống dưới sticky-bar div (một order dùng chung mobile + desktop, khớp cả 2 frame hi-fi).
2. **Specs: chips → `<dl>` key/value có divider** (thay `<ul>` chips ~L356-379): `divide-y divide-border-subtle`, mỗi hàng `flex justify-between py-2.5`, dt mono muted / dd semibold. Dòng lead-time giữ accent teal (trust signal made-to-order). Reuse key `specsHeading`/`specMaterial`/`specDimensions`/`leadTimeLabel`/`leadTimeValue`.
3. **Trust signal rẻ:** thêm 1 hàng dl giao hàng — key mới `shippingLabel: 'Giao hàng'`, `shippingValue: 'Giao toàn quốc · 2–4 ngày sau in'` (confirm copy với owner; thuần i18n).
4. **Nhấn swatch được chọn** trong `color-swatches.tsx` theo hi-fi (to hơn + halo kép): selected → `scale-110 ring-2 ring-border-strong ring-offset-2 ring-offset-surface-card`, bọc `motion-safe:transition-transform` (tôn trọng reduced-motion). Giữ 44px. KHÔNG raw hex; grep luminPreset (`packages/ui`) trước khi dùng class mới — token lạ silently no-op.

Verify: như PR 1 + đối chiếu cả frame hi-fi desktop trước khi chốt order; xác nhận `divide-border-subtle` compile.

## PR 3 — Reviews vào trong article, sticky CTA bám tới cuối ("dễ mua hơn")

Vấn đề: `ProductReviews` render là sibling SAU `<ProductDetail>` (`page.tsx:100`) nên sticky bar hết bám trước khi tới reviews — đúng chỗ intent mua cao nhất.

1. `product-detail.tsx`: thêm `children?: ReactNode`, render trong `<article>` sau flex 2 cột. Nếu cột info không cao theo (flex stretch — nên là có), dời sticky-bar div thành con trực tiếp của `<article>`.
2. `page.tsx`: nest `<ProductReviews/>` làm children, xoá sibling render. Giữ anchor `id="reviews"` (redirect `page.tsx:88` phụ thuộc).
3. Kiểm tra desktop: media column `md:sticky top-24` giờ bám lâu hơn (tốt) — check không đè footer.

Verify: browser mobile scroll hết reviews mà CTA vẫn hiện; deep-link `?reviewsPage=2#reviews` vẫn đúng; screenshots.

---

## Deferred (server/API — không làm đợt này)
- Tổng live trong sticky bar (`POST /price/quote` debounced theo selection) — nếu "từ {giá gốc}" chưa đủ.
- Label delta giá trên option pills ("+20.000₫").
- AggregateRating JSON-LD khi rating đủ tin cậy.

## Checklist conventions xuyên PR
- Semantic token only; money qua `formatVnd`/`PriceTag` (@lumin/core), không nhân client.
- Mọi copy qua `vi.ts`; key thêm: `stickyTotalLabel`, `stickyFromPrice` (PR1), `shippingLabel`, `shippingValue` (PR2); không xoá key nào.
- Mỗi PR: 1 screenshot mobile + 1 desktop vs hi-fi (visual-fidelity ADR-027).
- Edit tuần tự sạch (ESLint hook).
- spec-guardian review trước khi coi mỗi PR là done.
