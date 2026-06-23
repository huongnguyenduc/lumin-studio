# Conventions — luật BẮT BUỘC khi viết code

> **Mục đích:** mã hoá các quyết định thành ràng buộc kỹ thuật. Coi đây là luật cứng. Vi phạm = sai.
> **Liên quan:** [`decisions.md`](decisions.md) (vì sao) · [`/CLAUDE.md`](../CLAUDE.md) §6 (quy ước gốc) · [`/design-system.md`](../design-system.md).

## §Tiền (money)
- Lưu **int VND**, không thập phân. Thời gian lưu **ISO-8601 UTC**.
- `subtotal / shippingFee / total` **tính ở server**. **Không bao giờ** tin total do client gửi; client gửi chỉ để hiển thị, server tính lại.
- Định dạng qua **một** formatter trong `packages/core`: xuất `390.000₫` (không khoảng trắng, ký tự `₫` U+20AB), bằng cách post-process `Intl('vi-VN')`. Không format tiền rải rác (ADR-019).
- Spec kỹ thuật (kích thước) dùng mono: `180 × 180 × 240 mm`.

## §statusHistory & state machine
- Mọi đổi `OrderStatus` đi qua transition guard của `packages/core` và **append** `statusHistory{from, to, at, byUser, reason?}`.
- `reason` **bắt buộc** cho `CANCELLED` và `RETURNED`.
- Reconcile → `PAID` là **owner-only** (staff không được). Chuỗi hợp lệ: `PENDING_CONFIRM→PAID→PRINTING→SHIPPING→COMPLETED`; ngoại lệ `CANCELLED`/`RETURNED` tách riêng (`/spec.md` §04).
- Server là nguồn chân lý; client không tự nhảy state.
- **Tạo đơn kênh `web`:** checkout **không** tạo đơn; chỉ `POST /orders` (tạo ở `PENDING_CONFIRM`) **sau khi** khách đính **ảnh biên lai CK + xác nhận**. Lưu ảnh CK (`paymentProofUrl`); đối soát = **owner xem ảnh** → `PAID`. Kênh `inbox` tương tự (nhân viên tạo sau khi khách báo CK).

## §Tính toàn vẹn test (anti-reward-hacking) — ADR-023/024
- **Không bóp méo test để qua green-gate:** cấm xoá test-case / thêm `.skip`·`t.Skip`·`xit`·`xdescribe` / bỏ assertion trên invariant lõi (statusHistory, money int-VND, reconcile→PAID owner-only, `sum(parts)==total`). Tầng deterministic: `guard-files` **ask**, `spec-guardian` **BLOCKER** (REC-05).
- **Không special-casing implementation:** cấm hardcode `input→output` khớp **y nguyên** fixture/expected của test để làm test xanh thay vì cài logic thật (vd `if total == 390000 return '390.000₫'`). Literal "output đã-tính" hợp lệ chỉ sống ở `packages/core` (formatter tiền + transition-table) — **được exempt**; ngoài `core` mà literal output trùng fixture test đang sửa = nghi special-casing. Tầng deterministic: `guard-files` **ask** + mutation kill-gate `tests/harness/osm-mutation.test.sh` (chứng minh test *ràng buộc*); `spec-guardian` chỉ **WARN** (REC-16/ADR-024).

## §i18n
- **next-intl**, default `vi`, dùng **ICU** (plural/select). Tách khoá chuỗi **từ commit đầu** — **không hard-code text** trong component.
- Số/tiền/ngày qua `Intl('vi-VN')`. Sẵn sàng EN sau (chỉ thêm locale, không refactor).

## §Giọng & chữ
- **Sentence case** mọi nơi; không ALL-CAPS cho câu. Giọng ấm, mộc, xưng "chúng mình / bạn". Microcopy theo `/spec.md` §05.

## §State màn hình
- Mỗi màn chính dựng đủ **empty · loading · error**, không chỉ happy path (`/spec.md` §03). Loading ưu tiên skeleton; error có nút thử lại; empty có CTA.

## §A11y (WCAG 2.2 AA)
- **Tương phản:** primary action KHÔNG dùng trắng-trên-`flame-500` (2.82:1, FAIL). Dùng `flame-700 #C93A1A` (5.12:1) hoặc chữ `cocoa-900` trên `sun-500` (7.67:1). Khoá semantic alias để không chọn nhầm tổ hợp fail.
- Hit target ≥ 44px; `:focus-visible` rõ; label + lỗi gắn với field; nav bàn phím.
- **Tôn trọng `prefers-reduced-motion`**: tắt entrance + dừng loop. Áp cho viewer 3D và **Cat Peek** (`respectReducedMotion`). Animation trang trí không được bẫy focus/AT.
- Typography VN: font có subset `vietnamese`; line-height heading ~1.15–1.2 để không cắt dấu chồng (ế/ữ/ợ).

## §3D-upload (asset pipeline)
- Upload model: **S3 multipart presigned-PUT, mỗi part < 100MB** (Cloudflare Tunnel chặn body >100MB). Không POST proxy qua tunnel.
- Render Blender: **Cycles + CUDA** only. **KHÔNG OptiX** (Pascal không RT core), **KHÔNG EEVEE** (chết headless). Denoise **OpenImageDenoise CPU** (CC 6.1). Chạy Blender dạng **subprocess** (không bpy) để crash-isolation + retry. **concurrency=1**, off-peak; decimate + ≤1080p + sample vừa (6GB VRAM).
- Prefill Product từ trimesh **ngay** khi đọc xong metadata; render (**360° sprite — KHÔNG poster**) gắn sau khi AssetJob `ready`. AssetJob **idempotent**, tái tạo được từ model gốc.
- **Preview khắc tên: client-side** (canvas/CSS), **không** render server-side mỗi phím.
- LOD .glb nhỏ (<5MB, Draco/meshopt + KTX2, <50k tris); pre-gen derivative ảnh (AVIF/WebP/JPEG) lúc upload; serve **immutable content-hash URL** sau Cloudflare cache.
- **Ảnh card/list = ảnh shop chụp** (`Product.images[0]`), **không** phải poster do worker render. Hover (PC) / **dừng-2s (mobile)** → đổi sang **360° sprite** lắc trái-phải; sprite cũng là **fallback no-WebGL** cho `model-viewer` (viewer 3D chỉ load khi bấm "Xem 3D").

## §Realtime (SSE)
- Tiến độ server→browser qua **SSE** từ Core API. NATS không lộ ra browser.
- Route SSE: `Cache-Control: no-transform`, `Content-Encoding: identity`, `X-Accel-Buffering: no`, gọi `http.Flusher` mỗi event, gửi **heartbeat** định kỳ (vượt timeout 100s/524 của Cloudflare). **Smoke-test qua named tunnel.** Fallback: polling ngắn endpoint trạng thái.

## §Queue (NATS + outbox)
- Publish job **chỉ sau khi** row (AssetJob/Order) **commit** — qua bảng **outbox** (publish-on-commit), tránh mất job do dual-write (ADR-006).
- Consumer GPU: WorkQueue, ack-wait dài + **InProgress heartbeat** cho render lâu, MaxDeliver + republish sang stream **DLQ**; có view "AssetJob failed" trong Admin.

## §Bảo mật
- **Cloudflare Access** trùm Admin + API admin/extension (cổng danh tính trước box nhà).
- **STK/bank-account: chỉ owner sửa + audit log append-only**; **QR tĩnh** render **server-side** từ STK đã lưu (chống tráo STK; **nội dung/memo CK không bắt buộc**).
- Rate-limit `/checkout`, order-lookup, auth ở **Cloudflare WAF** + token-bucket trong Go (defense-in-depth).
- Guest order-lookup: so sánh **constant-time** mã+SĐT + lockout chống dò.
- Secrets: **SOPS + age** (.env mã hoá trong repo, giải mã lúc deploy). Không Infisical.
- **Subprocess không kế thừa cred:** `settings.json` đặt `env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1` — Bash/hook/MCP-stdio không nhận `ANTHROPIC_API_KEY` + cred cloud nhận-diện-được (chặn `echo $ENV` làm lộ). **Caveat:** token tự-đặt-tên (vd `NATS_TOKEN`) **không** đảm bảo bị strip → giữ trong SOPS+age decrypt per-service, **đừng** export vào shell. Bổ trợ `permissions.deny` (deny chặn ĐỌC file secret; env-scrub chặn secret RESIDENT trong process) — REC-22/ADR-024.
- RBAC: `owner` toàn quyền; `staff` không sửa cài đặt/STK, không reconcile→PAID (`/spec.md` §08).

## §Phân tích & consent
- Event analytics §08 (`product_viewed → personalize_started → add_to_cart → checkout_started → order_placed`, `order_status_changed`, `extension_quick_order`) phát qua `umami.track()` từ `core/api-client` — một vocabulary cho cả 4 bề mặt.
- Umami **gated theo consent**; session replay **TẮT mặc định**, opt-in + che input + tắt ở `/personalize` + checkout (PDPL — `compliance.md`).
