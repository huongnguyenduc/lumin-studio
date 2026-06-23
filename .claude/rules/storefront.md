---
description: Luật cho web khách (Next.js storefront) — sprite-first 3D, preview khắc client-side, SEO, consent.
paths:
  - "apps/storefront/**"
---

# Storefront (web khách)

> Vì sao: [`/docs/plan.md`](../../docs/plan.md) Phase 1 · [`/docs/conventions.md`](../../docs/conventions.md) · [`/spec.md`](../../spec.md).

- **3D sprite-first:** ảnh card/list = **ảnh shop chụp** (`Product.images[0]`); **hover (PC) / dừng-2s (mobile) → 360° sprite** lắc trái-phải. `model-viewer` chỉ load khi khách bấm "Xem 3D"; **360° sprite** server-render làm fallback no-WebGL (**KHÔNG poster**). Đừng auto-load WebGL nặng.
- **Checkout web:** màn QR **tĩnh** (render từ STK; memo CK **không bắt buộc**) → khách **đính ảnh biên lai CK + xác nhận** thì mới `POST /orders` (đơn ở `PENDING_CONFIRM`, kèm `paymentProofUrl`); **không** tạo đơn ở bước checkout. Sau đó điều hướng tới **link tra cứu đơn** (màn "chờ xác nhận" + auto-poll).
- **Preview khắc tên: client-side** (canvas/CSS) + đếm `maxChars`. **KHÔNG** render server-side mỗi phím gõ.
- **Add-to-cart sticky** trên mobile, tổng tiền lấy **live từ server** (không tự cộng ở client).
- **SEO:** OG card render server-side (JPG/PNG 1200×630, tag trong HTML đầu) + JSON-LD `Product/Offer` (`availability=PreOrder`, chưa có AggregateRating) + sitemap/robots/canonical. **Chặn index** admin/checkout/order-lookup.
- **Consent/PDPL:** Umami **gated theo consent**; session replay TẮT mặc định. Privacy notice tiếng Việt.
- **Catalog:** SSG/ISR + cache mạnh (Cloudflare). Search = Postgres FTS + unaccent (ADR-016).
- Mỗi màn dựng đủ **empty · loading · error** (skeleton + nút thử lại + CTA), không chỉ happy path.
- Mục tiêu CWV xanh; ảnh AVIF/WebP pre-gen, serve immutable content-hash URL.
