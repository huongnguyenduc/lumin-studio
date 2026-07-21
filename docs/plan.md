# Plan triển khai theo phase — Lumin Studio

> **Mục đích:** làm gì, theo thứ tự nào, "done" là gì. Cải tiến từ vòng nghiên cứu đã **gộp vào phase sẵn có** (không thêm phase).
> **Liên quan:** [`architecture.md`](architecture.md) · [`conventions.md`](conventions.md) (luật code) · [`decisions.md`](decisions.md) (ADR) · [`compliance.md`](compliance.md).

Nguyên tắc: mỗi màn dựng đủ **empty · loading · error** (không chỉ happy path — `/spec.md` §03). State machine + tính tiền làm sớm và test kỹ (xương sống). **Màn UI:** đối chiếu thị giác vs `designs/*.dc.html` (ADR-027 · `conventions.md` §Visual-fidelity).

---

## Phase 0 · Nền tảng
**Lõi:** monorepo (pnpm+Turborepo); `packages/tokens` → theme (CSS vars/Tailwind preset); `packages/core` (state machine + transition guard + **formatter tiền ₫** + Zod + khoá i18n); compose skeleton (Postgres, NATS, Garage, Caddy, cloudflared); CI → GHCR + self-hosted runner.
**Gộp cải tiến:** sửa **contrast nút coral** ở token (flame-700 `#C93A1A` hoặc cocoa-on-sun; xem `conventions.md` §A11y) + khoá semantic-color alias; self-host font `subsets:['vietnamese','latin']` + nới leading heading ~1.15–1.2; **next-intl (vi + ICU)** + helper `Intl('vi-VN')`; Cloudflare cache-everything (tối ưu ảnh: imgproxy on-the-fly, ADR-055 — KHÔNG pre-gen); wire web-vitals → Umami; viết 1 trang "những gì cố tình KHÔNG test".
**Setup GPU (operations.md):** driver Windows + cuda-toolkit WSL2 + nvidia-container-toolkit + **test Blender render 1 frame bằng CUDA trong container**.
**Done:** `pnpm dev` chạy; state machine có test; tunnel ra "hello"; Blender thấy GPU.

### ⚙️ Phase-0 ARM checklist (audit r3) — bật gate khi code land ("no-op không sống mãi")
> Bất biến harness: *"gate no-op trông y hệt gate pass"* (`agent-harness.md`). Khi code đầu tiên xuất hiện, các gate sau **phải** arm cùng lúc — `tests/harness/guard.test.sh` §ARM-GUARD + `osm-mutation.test.sh` §real-check sẽ **đỏ ở CI** nếu thiếu (đó là điểm: bắt buộc arm). Tick khi xong:
> - [ ] `packages/core` land → root `package.json` có script **`verify`** (`turbo run lint typecheck test` + `format:check`) — arm green-gate `verify-before-stop`.
> - [x] (Core slice-3 PR-3c-2 · §6 D13) `packages/core/test/acceptance.ledger.test.ts` tồn tại + pass — parse `docs/acceptance.md`, fail nếu dòng `[x]` có test-id không resolve tới `it()`/`test()` active trong `packages/**/*.test.ts`; pin **OSM-02 statusHistory** + **MNY-03 money một-formatter**. Armed bởi guard.test.sh §ARM-GUARD (existence). REL-* Go-gated giữ `[ ]` cố ý (parser chỉ resolve id TS).
> - [ ] OSM thật land → wire **real-mutation-arm** trong `osm-mutation.test.sh` (copy → sed-mutant họ allow-all/swap/drop-edge/add-illegal/terminal-escape/drop-history/drop-reason → assert `order_state.*` ĐỎ → restore).
> - [x] (services backbone PR) `services/**/*.go` land → `Makefile` có **`verify-go`**; `*.rs` → **`verify-rs`** — ARM-GUARD xanh; CI `services-gates` chạy thật (không chỉ tồn tại).
> - [x] (Core slice-2 PR-2a) `services/core-api/sqlc.yaml` land → recipe `verify-go` chạy **`sqlc vet`** (+`sqlc diff`); ARM-GUARD soi **THÂN recipe** (không chỉ tên target) + **testcontainers real-check** (arm khi land PR-2b). Pin sqlc v1.30.0 + pgx v5.7.5 (giữ go 1.23) — ADR-028.
> - [ ] `apps/**/*.tsx` land → ESLint config cấm `Intl.NumberFormat`/`toLocaleString` ngoài `packages/core` (MNY-03/i18n).
> - [x] (audit r3 đã xong) CI `harness.yml` trigger trên `packages/**`·`services/**`·`apps/**`·`package.json`·`Makefile` để ARM-GUARD chạy đúng PR land Phase-0.
> - [ ] `packages/core` money land → mở `osm-mutation.test.sh` sang money (formatter + `sum==total`): mutant đổi±/off-by-one/bỏ-grouping **phải** làm `money.*` ĐỎ (ADR-027 · REC-M).
> - [ ] backbone invariant biểu đạt **generative property-test** (money round-trip `parse(format(n))==n` · `sum(parts)==total` ngẫu nhiên · replay `statusHistory`→status qua chỉ transition hợp lệ) — fast-check/gopter (ADR-027 · REC-E).

## Core · Data model + OrderStatus (xương sống — làm sớm)
**Lõi:** sqlc models theo `/spec.md` §02 (Product, Color, Option, Order/OrderItem, PrintJob, **AssetJob**, Review, Customer, User, ReplyTemplate, Setting) + bảng **outbox**; cài state machine (`/spec.md` §04) + transition guard; tính tiền server int VND (subtotal/shippingFee/total).
**Gộp cải tiến (quyết định schema rẻ-giờ/đắt-sau):** địa chỉ `province → ward → street` (**bỏ district**, ADR-017); thêm `zalo` vào enum **`consent_channel`** (Order.`channel` giữ `web`/`inbox` theo `status.go` — ADR-028); bản ghi consent `{scope, channel, timestamp}` trên Customer.
**Test P0:** bảng đầy đủ state machine (mọi from×to×role, append statusHistory, **reason bắt buộc** cho CANCELLED/REFUNDED, **reconcile→PAID + →REFUNDED owner-only**, inbox tạo thẳng PAID) + property-test máy tính tiền (các phần cộng = tổng; **từ chối total do client gửi**).
**Done:** tạo/đổi trạng thái đơn qua API có statusHistory; RBAC chặn staff sửa cài đặt/STK.

## Phase 1 · Storefront
**Lõi:** catalog (SSG/ISR + cache) · chi tiết SP · cá nhân hoá (khắc, `maxChars`) · giỏ · tra cứu đơn (mã + SĐT) · tài khoản khách.
**Gộp cải tiến:** **sprite-first** (ảnh card mặc định = **ảnh shop chụp** `Product.images[0]`; hover PC/dừng-2s mobile → **360° sprite**; `model-viewer` chỉ load khi bấm "Xem 3D"; sprite làm fallback no-WebGL — **KHÔNG render poster**) · **preview khắc client-side + đếm maxChars** (không render server-side mỗi phím) · **sticky add-to-cart mobile** (tổng tiền server live) · **OG card render server-side** (JPG/PNG 1200×630, og tag trong HTML đầu) + **Product/Offer JSON-LD** (`availability=PreOrder`, chưa có AggregateRating) + sitemap/robots/canonical (chặn admin/checkout/lookup) · **privacy notice + Umami gated theo consent** · trust: founder + ảnh khách thật + số lượng review.
**Done:** duyệt + cá nhân hoá mượt trên mobile; tra đơn được; CWV xanh.

## Phase 2 · Checkout & thanh toán
**Lõi:** checkout (**chưa tạo đơn**) → **QR tĩnh** (memo CK **không bắt buộc**) → khách **gửi ảnh CK + xác nhận** → `POST /orders` tạo đơn `PENDING_CONFIRM` (kèm ảnh CK); phí ship theo vùng (server).
**Gộp cải tiến:** checkout **guest-first**, **địa chỉ VN (tỉnh/phường/đường) + phí + ETA hiện TRƯỚC khi commit**; bước **echo lại nội dung khắc**; **đặt cọc/trả trước + tickbox no-return** (ADR-012); **màn "chờ xác nhận" + auto-poll** (lật PAID không cần refresh); email link+mã đơn; guest order-lookup **rate-limit + lockout + so sánh constant-time**.
**Done:** đặt 1 đơn web end-to-end → **QR tĩnh → gửi ảnh CK → tạo đơn** → màn chờ; rate-limit hoạt động.

## Phase 3 · Admin (+ Admin Mobile)
**Lõi:** dashboard · đơn (confirm + lý do huỷ/hoàn) · hàng đợi in (kéo-thả ↔ status, SSE) · sản phẩm (upload model → AssetJob, màu/option) · đánh giá · cài đặt (VietQR/STK; thiếu STK ⇒ chặn checkout web).
**Gộp cải tiến:** **Auth self-issued JWT (ADR-030)** cho Admin + API admin (KHÔNG Cloudflare Access; CF Access/WAF = lớp edge tuỳ-chọn) · **STK chỉ owner sửa + audit log + QR render server-side** · **nút 1-chạm → PAID** (Admin + Admin Mobile) · thông báo online.gov.vn (làm lúc launch, `compliance.md`) · G-code slicer (Orca/Prusa) → giá + PrintJob + Spoolman quản nhựa · **chụp ảnh đóng gói (QC) trước khi SHIPPING**.
**Done:** vận hành trọn vòng đơn từ Admin; responsive mobile.

## Phase 4 · Extension (assistive-only, thu nhỏ)
**Lõi:** panel ~360–400px cạnh chat; chỉ gọi BFF: tra đơn · form tạo đơn (`channel=inbox`) · copy mẫu trả lời (biến `{tên}/{mã đơn}/{STK}`) · quét mã (paste/camera). **Không** inject/scrape DOM Meta (ADR-011).
**Done:** tạo đơn inbox + tra đơn từ panel; không chạm DOM Meta.

## Phase 5 · Ops & lifecycle
**Lõi:** observability (Uptime Kuma + GlitchTip → logs → OpenObserve/Victoria, `cpus=` limit) · **backup pg_dump + restic + TEST restore** (ADR-018 · cơ chế ADR-044) · rate-limit (CF WAF + token-bucket Go) · staging (compose profile) · secrets SOPS+age.
**Gộp cải tiến:** **email thông báo mỗi mốc trạng thái** (off statusHistory, idempotent) · review ảnh ở COMPLETED+3–7d · **GHN** lấy mã vận đơn · referral mã tĩnh (credit thủ công sau khi đơn giới thiệu đạt PAID).
**Test:** 3–6 e2e Playwright (web→QR tĩnh→gửi ảnh CK→tạo đơn, admin reconcile→PAID→queue, inbox order) + integration test (Testcontainers) cho luồng tiền/state.
**Done:** có cảnh báo khi sập + khôi phục được DB.

## Phase 6 · Sau (tuỳ chọn)
Zalo OA + ZNS/ZBS (nâng từ email lên nếu cần) · landing dịp lễ / gift-mode · **Cat Peek** (`/Cat Peek - Behavior Spec.md`) — **cuối cùng, chỉ sau khi CWV xanh**.

---

## Đừng làm (de-scope — chống over-engineer)
Extension tự động hoá Meta · tự viết scrape ngân hàng / cổng thanh toán / webhook bank · render khắc server-side mỗi phím · transform ảnh runtime trên PC · DPIA/CMP/cookie-wall kiểu GDPR · CRM/loyalty điểm/drip lifecycle/ledger referral · đuổi % coverage / full test pyramid / staging phức tạp / Lighthouse-CI gate ngày đầu · ERP/fleet scheduler in / đa sàn · AR/AI configurator/BNPL · tự động hoá hoá đơn điện tử lúc này · đa ngôn ngữ (vi-only, giữ key i18n sẵn). (Chi tiết: `decisions.md`, `compliance.md`.)
