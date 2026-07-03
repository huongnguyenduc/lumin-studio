# Plan — Phase 1 · Storefront

> **Nguồn:** planning workflow `wf_d4c5772c-9b4` (5 readers → 3 slicing angles → 3-lens judge → synthesis +
> completeness critic, 13 agents). Winner = **Risk-first spine** (top on dependency-soundness + spec-compliance)
> với grafts từ 2 runner-up. Quyết định chủ chốt (user) chốt **2026-07-03**. Đây là plan triển khai chi tiết cho
> `plan.md §Phase 1`; **decisions/conventions/spec vẫn là nguồn chân lý** — plan này chỉ xếp thứ tự + slice.

## 0 · Bối cảnh + ranh giới
Storefront hiện vẫn là **Phase-0 shell** (`apps/storefront` render `lib/demo-products.ts` — placeholder, y hệt
admin trước PR-3j). Phase 1 = swap sang fetch thật + dựng các màn khách. **Backend gap:** slice-3 CỐ Ý cắt catalog
read DTOs → **các endpoint đọc chưa tồn tại**; bảng + sqlc models catalog/identity/reviews ĐÃ có (PR-2c/2d), chỉ
thiếu lớp HTTP đọc.

**Ranh giới Phase-1/2 (cứng):** checkout, thanh toán QR tĩnh, upload biên lai, `POST /orders`, địa chỉ
(province/ward/street — ADR-017) đều là **Phase 2**. Storefront chỉ **đọc/poll**, KHÔNG tạo đơn, KHÔNG tự
transition status. Cart kết thúc ở "add-to-cart (server-priced) + sticky mobile"; KHÔNG có nút checkout.

**Luật xuyên suốt:** tiền int-VND chỉ qua MỘT formatter `packages/core` (`formatVnd`/`formatVnNumber`/`calcTotals`;
cấm `Intl.NumberFormat`/`toLocaleString` ngoài core — ESLint ARM) · mọi chuỗi i18n-key vi (không hard-code) · mỗi
màn đủ empty/loading/error · sprite-first ADR-007 (ảnh mặc định = `Product.images[0]`, KHÔNG worker poster) +
`prefers-reduced-motion` · analytics gated theo consent (PDPL) · guest-lookup constant-time + rate-limit.

## 1 · Quyết định chủ (user 2026-07-03)
- **D-P1-1 · Drop `productType` khỏi Phase-1 Product DTO.** Không có cột/enum `product_type` → thêm vào OpenAPI sẽ
  vỡ 4-way parity test. Pet Tag activation ngoài scope Phase-1 → **bỏ field**, thêm lại khi Pet Tag land (migration
  + parity update lúc đó). *(Giải BLOCKER-1.)*
- **D-P1-2 · Money = `POST /price/quote` server-authoritative.** Wrapper mỏng trên `pricing.PriceItem` (PRC-01 đã
  có) → tổng add-to-cart là **server READ**, engrave maxChars enforce **server-side**. Khớp luật "tổng tiền tính ở
  server". (Không chọn client-side calcTotals display-only.)
- **D-P1-3 · Full scope:** reviews (P1-l/m) + FTS no-dấu search (P1-e) + customer accounts (P1-r/s) **đều ship
  Phase-1**. → BLOCKER-2 (customer-credentials migration + auth mechanism) còn sống nhưng P1-r ở cuối chuỗi, không
  chặn khởi động.

## 2 · Backend endpoints mới (8) — lấp gap slice-3
| Endpoint | PR | Ghi chú |
|---|---|---|
| `GET /products/{slug}` | P1-a | Detail; bundle Product+colors[]+options[] (reuse sqlc reads); active-only, 404 non-active; **KHÔNG productType** (D-P1-1) |
| `POST /price/quote` | P1-b | Server-authoritative line pricing (wrapper `pricing.PriceItem`); Selection KHÔNG mang giá; reject invalid; line/subtotal ONLY (no shipping/address) |
| `GET /products` | P1-c | Catalog list; active-only, paginate+sort+category filter; card projection; denormalized rating (no N+1); khai báo sẵn `?q=` |
| `GET /categories` | P1-d | **NEW `ListCategories` sqlc query** (chỉ có Insert hôm nay) + regen |
| `GET /products?q=` | P1-e | FTS unaccent (ADR-016); migration unaccent+tsvector; điền param đã khai ở P1-c (additive, không mở lại contract) |
| `GET /products/{slug}/reviews` | P1-l | **NEW `ListReviewsByProduct` sqlc query**; published-only (hidden KHÔNG lộ); paginate |
| `GET /orders/lookup?code=&phone=` | P1-n | Guest tra-cứu; phone-guard + constant-time + token-bucket + lockout + uniform not-found + public timeline DTO (KHÔNG lộ Order nội bộ/`TransitionError.Message` — ADR-032) |
| customer auth realm | P1-r | `POST /customer/{register,login,logout}` + `GET /customer/orders`; **realm riêng ADR-030** (không dùng JWT admin); cần migration credentials + chọn cơ chế |

## 3 · Thứ tự sub-PR (19) — dependency-sound
> Track: **BE** backend · **FE** frontend. Mọi FE land SAU endpoint nó tiêu thụ. `armGates` = ARM harness mới cho
> invariant tiền/bảo mật (BE); FE = "none".

| # | Title | Track | dependsOn | Done (rút gọn) |
|---|---|---|---|---|
| **P1-a** | `GET /products/{slug}` detail + author Product/Color/Option schema (money contract) | BE | — | openapi có schema + endpoint; active-only + 404 non-active; int-VND + parity; api-client regen; **KHÔNG productType** |
| P1-b | `POST /price/quote` server-authoritative pricing | BE | P1-a | route qua `pricing.PriceItem`; reject invalid (rune-count maxChars); no client price; messageKey không raw text |
| P1-c | `GET /products` list (active-only, paginate, category, card projection) | BE | P1-a | list + filter + paginate; no N+1; ETag/cache; khai `?q=` param |
| P1-d | `GET /categories` (new `ListCategories` query) | BE | — | new query + regen; empty→`[]` không 404; public cache |
| P1-e | `GET /products?q=` FTS unaccent (ADR-016) | BE | P1-c | migration >head; 'den' match 'đèn'; active-only; response shape unchanged |
| P1-f | FE: wire `@lumin/api-client` + public server-fetch; swap demo→`GET /products` (home) | FE | P1-c | home grid live; api-client transpiled (append array); no Intl ngoài core; no `CORE_API_URL` ở client bundle |
| P1-g | FE: catalog browse `/san-pham` (chips + search + paginate) | FE | P1-c,d,e,f | filter+search+paginate; filters persist reload; empty-filter vs empty-search phân biệt |
| P1-h | FE: product detail `/san-pham/{slug}` (swatches/options/add-to-cart lock) + a11y + visual-fidelity | FE | P1-a,f | detail server-side; add-to-cart khoá tới khi chọn color; out-of-stock block; money formatVnd; screenshots vs hi-fi |
| P1-i | FE: sprite-first 360 media + on-demand model-viewer (ADR-007) | FE | P1-h | default images[0]; hover/dwell→sprite; model-viewer chỉ khi bấm; no-WebGL fallback; reduced-motion |
| P1-j | FE: engrave/personalize (client preview, rune-count maxChars) | FE | P1-b,h | live preview; counter rune-accurate (Intl.Segmenter, KHÔNG `.length`); over-limit block + confirm bởi P1-b 422; no ack/echo (Phase-2) |
| P1-k | FE: cart `/gio-hang` (server-priced Selection, qty/remove, **NO checkout**) | FE | P1-b,h,j | persist reload; subtotal qua `/price/quote`; ZERO order/payment/address code (grep-verifiable) |
| P1-l | BE: `GET /products/{slug}/reviews` (new `ListReviewsByProduct`, published-only) | BE | P1-a | new query + regen; test PROVE hidden không lộ; paginate |
| P1-m | FE: reviews section trên detail | FE | P1-l,h | render published; owner reply; dates/counts qua core formatters |
| P1-n | BE: `GET /orders/lookup` guest (phone-guard + constant-time + rate-limit + timeline DTO) | BE | — | code AND phone match; uniform not-found; token-bucket+lockout; public timeline DTO only |
| P1-o | FE: guest lookup `/tra-cuu-don` + status timeline + auto-poll | FE | P1-n,f | timeline 5 mốc + CANCELLED/REFUNDED riêng; poll flip PENDING→PAID; noindex; **author milestone i18n keys ở @lumin/core** |
| P1-p | FE: consent-gated Umami (PDPL) | FE | P1-h,j,k | ZERO analytics network trước consent (verify network panel); replay off default + forced-off personalize/cart |
| P1-q | FE: SEO — server OG + Product/Offer JSON-LD (PreOrder, no AggregateRating) + sitemap/robots | FE | P1-c,h | OG tags first-HTML; JSON-LD PreOrder; robots chặn admin/checkout/lookup/account |
| P1-r | BE: customer auth realm + order history (ADR-030 realm riêng) | BE | — | register/login/logout cookie riêng (KHÔNG JWT admin); `/customer/orders` scoped; uniform login error; **cần migration credentials + cơ chế** |
| P1-s | FE: customer account + order history (reuse P1-o timeline) | FE | P1-r,f,o | login/register + history reuse timeline; guest path còn nguyên; noindex |

**firstPR = P1-a** — contract anchor, zero deps, reuse `GetProductBySlug`/`ListColorsByProduct`/`ListOptionsByProduct`
(đã có), author superset Product schema (list/quote/reviews subset lại), retire money+engrave contract sớm.

## 4 · BLOCKERs (completeness critic — đã đọc code)
- **BLOCKER-1 (RESOLVED · D-P1-1):** `productType standard|nfc_tag` không có backing (no column/enum; sẽ vỡ
  `internal/contract/parity_test.go`) → **drop khỏi Phase-1 DTO**.
- **BLOCKER-2 (OPEN · gates P1-r, không gates start):** customer auth = KHÔNG phải leaf schema-free. `customers`
  (000004) guest-shaped: no `password_hash`, email **không unique**, no session/token store. ADR-030 chỉ thêm
  `password_hash` cho **users** (admin). → P1-r cần **migration credentials mới (>000011)** + quyết `email unique
  vs guest customers` + **cơ chế auth** (magic-link vs password vs cả hai — open question). Chốt TRƯỚC khi schedule P1-r.

## 5 · Tightenings (IMPORTANT/NOTE — fold vào PR liên quan)
- **IMPORTANT · zoneId (P1-b/P1-j):** `pricing.PriceItem.validateEngrave` **bỏ qua ZoneID**; không có model
  valid-engrave-zones. → hoặc thêm engrave-zones model (declared BE work) rồi extend PriceItem, **hoặc** DROP claim
  reject-zoneId (chấp nhận zoneId free-form, chỉ validate text-option + rune maxChars). *Mặc định: DROP — giữ P1-b
  đúng "thin wrapper".*
- **IMPORTANT · i18n status-timeline keys:** `packages/core/src/i18n/vi.ts` CHƯA có nhãn order-status. P1-o/P1-s
  render 5 mốc + CANCELLED/REFUNDED + ETA + 429 copy. `eslint-plugin-i18next` + `messages.test.ts` armed → hard-block
  nếu thiếu. → **author milestone keys ở @lumin/core (cạnh order-state) trong P1-o** (nguồn chung), enumerate per-screen keys.
- **NOTE · P1-g degrade nếu defer FTS:** (không defer — D-P1-3 giữ FTS) — vẫn ghi fallback: search box ẩn/disable
  hoặc client-filter trang hiện tại.
- **NOTE · migration numbering:** head hiện = **000011** (000008 skip cố ý). P1-e (FTS) + P1-r (credentials) mỗi cái
  phải **>000011** và không đụng nhau (monotonic memory). Cấp số cụ thể khi land, không theo slot.
- **NOTE · sprite pipeline (P1-i):** phụ thuộc render-worker phát sprite-sheet ở content-hash URL — CHƯA xác nhận
  tồn tại. Nếu chưa có → P1-i degrade-only (images[0] + on-demand model-viewer). Cross-team.
- **NOTE · guest consent audit:** P1-p persist localStorage; `consent_grants` (000004) customer-scoped, no
  anonymous path. Gate "no pre-consent call" đủ; server-side audit cho guest defer/tuỳ vn-compliance.

## 6 · Open questions còn lại (quyết khi tới PR)
1. **Caching (gates P1-c/P1-h):** SSG vs ISR + revalidate window; timed ISR (interval?) vs on-write purge
   (`revalidateTag` webhook từ core-api khi đổi giá/status/stock). Stale money/stock là hazard thật.
2. **Sprite source (gates P1-i):** render-worker đã phát 360 sprite-sheet chưa, URL nào? Nếu chưa → degrade-only.
3. **Reviews scope:** ✅ ship (D-P1-3).
4. **FTS scope:** ✅ ship (D-P1-3).
5. **Customer-auth mechanism (gates P1-r):** magic-link ("account ngầm" trong design) vs password vs cả hai? → quyết
   trước P1-r; định hình P1-r/P1-s + migration credentials.
6. **Guest-lookup poll cadence (P1-o):** interval + max duration + backoff, tôn trọng token-bucket P1-n.

## 7 · Nợ chất lượng của plan
- **Designs reader FAILED** (StructuredOutput retry cap) → screen inventory KHÔNG grounded trong đọc thật hi-fi
  HTML. Không ảnh hưởng BE PR. **Trước các FE PR (P1-f trở đi): đọc `designs/Lumin Storefront - Hi-fi.dc.html`**
  (per-screen layout/px/copy/states) để visual-fidelity là thật, không phải suy từ designRefs.

## 8 · Done (Phase 1) — theo plan.md
Duyệt + cá nhân hoá mượt trên mobile; tra đơn được; CWV xanh. Cụ thể: home/catalog/detail render data thật; engrave
preview + rune-count; add-to-cart server-priced; guest lookup + timeline + auto-poll; customer account + history;
consent-gated analytics; SEO OG/JSON-LD; mọi màn đủ empty/loading/error; visual-fidelity vs hi-fi; ranh giới
Phase-1/2 giữ cứng (0 order-creation/payment/address).
