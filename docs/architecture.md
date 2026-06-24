# Kiến trúc hệ thống — Lumin Studio

> **Mục đích:** bức tranh tổng thể — hệ gồm gì, chạy ở đâu, dữ liệu chảy thế nào.
> **Liên quan:** [`decisions.md`](decisions.md) (vì sao) · [`conventions.md`](conventions.md) (luật code) · [`operations.md`](operations.md) (deploy) · [`/spec.md`](../spec.md) §02 (data model), §04 (state machine).

## 1. Một dòng

Cửa hàng **thiết kế & in 3D theo đơn** (made-to-order, không tồn kho thành phẩm). **4 bề mặt** chạy trên **một bộ trạng thái đơn duy nhất**: Storefront (web khách) · Admin (desktop) · Admin Mobile · Browser Extension (bán qua inbox MXH).

Nguyên tắc xuyên suốt: **OrderStatus state machine + tính tiền là của server**, mọi client chỉ là vỏ. Tiền là **int VND**, thời gian **ISO-8601 UTC**, mọi đổi trạng thái ghi `statusHistory`.

## 2. Topology (tất cả self-host tại nhà)

```
        Cloudflare:  Tunnel + WAF/rate-limit + Cache(catalog, asset hash bất biến) + Access(admin)
                                          │ cloudflared (named tunnel)
   ┌─────────────────────  PC nhà — Windows + WSL2 Ubuntu + Docker (GTX 1060 6GB)  ──────────────┐
   │  Caddy ─┬─ Next storefront      Next admin (+ responsive Admin Mobile)                       │
   │         └─ Core API (Go + Chi) ──┬─ PostgreSQL (app)        Postgres (umami, DB riêng)        │
   │            OpenAPI · SSE · RBAC  ├─ NATS JetStream ───────── Rust Worker ── Blender (Cycles)  │
   │            outbox · tính tiền    │   (WorkQueue, DLQ,          trimesh · gltf-transform · sharp│
   │                                  │    concurrency=1)                                          │
   │                                  └─ Garage (S3, replication=1) ◄── presigned multipart PUT    │
   │  Observability: OTel Collector → OpenObserve/Victoria · Uptime Kuma · GlitchTip               │
   │  Analytics: Umami v3.1   |  Backup: WAL-G + restic → offsite   |  Secrets: SOPS + age          │
   └───────────────────────────────────────────────────────────────────────────────────────────────┘
```

Chấp nhận downtime (xem ADR-009). Read-path dựa vào **Cloudflare cache + asset bất biến** để web vẫn duyệt được khi PC reboot.

## 3. Thành phần & trách nhiệm

| Thành phần | Công nghệ | Trách nhiệm |
|---|---|---|
| **Storefront** | Next.js (App Router) | Catalog, chi tiết SP, cá nhân hoá, giỏ, checkout→QR tĩnh (đơn tạo **sau khi** khách gửi ảnh CK + xác nhận), tra cứu đơn, tài khoản khách. Mobile-first. SSG/ISR + cache edge. |
| **Admin / Admin Mobile** | Next.js (responsive) | Dashboard, đơn, hàng đợi in, sản phẩm (upload model), đánh giá, cài đặt. Sau Cloudflare Access. |
| **Extension** | Manifest V3 | **Assistive-only** (ADR-011): tra đơn, form tạo đơn, copy mẫu trả lời, quét mã — chỉ gọi BFF, **không** đụng DOM Messenger/IG. |
| **Core API (BFF)** | Go + Chi v5, pgx, sqlc, jwtauth | Auth + RBAC (owner/staff), domain đơn/sản phẩm/cài đặt, **state machine**, **tính tiền server**, phát job qua outbox→NATS, SSE tiến độ. Hợp đồng OpenAPI→codegen cho client TS. |
| **Asset Worker** | Rust (async-nats, tokio) + Blender | Tiêu thụ AssetJob: chuẩn hoá model, trích kích thước/material (prefill Product), tạo LOD .glb, **render 360° sprite** (KHÔNG render poster), tạo derivative ảnh **shop chụp**. Ghi Garage. |
| **PostgreSQL** | — | Dữ liệu app + bảng `outbox` + queue/job state. Một DB **riêng** cho Umami. |
| **NATS JetStream** | — | Hàng đợi job (WorkQueue, DLQ, ack-wait dài + heartbeat). concurrency=1 cho consumer GPU. |
| **Garage** | S3-compatible | Object storage tại nhà: model gốc, STL/3MF in, .glb LOD, sprite, ảnh. Không có versioning → dựa backup. |
| **Cloudflare** | Tunnel + cache + WAF + Access | Edge: TLS, ẩn IP, cache catalog/asset, rate-limit, cổng danh tính cho Admin. |

## 4. Monorepo

```
packages/
  tokens     ← tokens/*.css → CSS vars + Tailwind preset (1 nguồn)
  ui         ← primitives theo design-system.md (Button/Card/Badge/Input…)
  core       ← OrderStatus state machine + transition guard · formatter tiền (₫) · Zod schema · khoá i18n (vi)
  api-client ← client sinh từ OpenAPI (openapi-typescript + openapi-fetch), types dùng chung
apps/
  storefront · admin · extension
services/      (Go/Rust — ngoài workspace JS)
  core-api   ← Go + Chi
  asset-worker ← Rust + Blender
```

> `core` là **xương sống dùng chung 4 bề mặt**. State machine + tính tiền đặt ở đây (kiểu/guard) nhưng **server là nguồn chân lý**.

## 5. Order lifecycle (luồng đơn)

### 5.1 Kênh `web` (pay-then-confirm — thủ công, ADR-010)
1. **Màn checkout (chưa tạo đơn):** khách nhập thông tin; server tính `subtotal/shippingFee/total` (theo vùng) để **hiển thị**. Chưa ghi đơn nào xuống DB.
2. **Màn QR:** hiện **QR tĩnh** (server render từ STK đã lưu; **nội dung/memo CK không bắt buộc**) + hướng dẫn chuyển khoản.
3. Khách chuyển khoản → **đính ảnh chụp biên lai + bấm xác nhận**. **Chỉ lúc này** frontend mới `POST /orders` → server **tạo đơn** ở `PENDING_CONFIRM` (kèm ảnh CK). Trả về link+mã đơn (email cho khách).
4. Khách theo **link tra cứu đơn** → **màn "chờ xác nhận"** (timeline + thời gian dự kiến + **auto-poll** trạng thái). Chủ shop đối soát **thủ công** (xem ảnh biên lai, đối chiếu số tiền) → bấm 1 chạm "đã nhận CK" → `PAID` (owner-only). UI khách tự lật sang PAID.
5. `PAID → PRINTING → SHIPPING → COMPLETED`. Đóng đơn `CANCELLED` (không hoàn) / `REFUNDED` (đã hoàn — owner-only) — bắt buộc `reason`.

### 5.2 Kênh `inbox`
Nhân viên **tự kiểm tra thấy tiền đã về** rồi dùng Extension (assistive) → form tạo đơn gọi `POST /orders` (`channel=inbox`) → đơn vào **thẳng `PAID`** (không qua `PENDING_CONFIRM`). Người tự thao tác bên trong Messenger/IG. `→ REFUNDED` & sửa STK vẫn **owner-only**.

### 5.3 Asset pipeline (upload model)
```
Admin upload (presigned multipart PUT → Garage) → Core API tạo AssetJob (pending), ghi outbox
  → (sau commit) publish NATS → Rust Worker (processing):
      trimesh: chuẩn hoá + trích dims/material  → prefill Product NGAY
      gltf-transform: LOD .glb + nén meshopt/KTX2
      Blender (Cycles+CUDA): render 360° sprite   (KHÔNG poster; concurrency=1, off-peak)
      sharp: derivative ảnh shop chụp (AVIF/WebP/JPEG)
      → upload Garage → callback Core API → AssetJob ready
  (failed → retry; job idempotent, tái tạo được từ model gốc)
```

**Ảnh sản phẩm trên storefront:** ảnh đại diện/list là **ảnh shop chụp** (`Product.images[0]`) — worker **không** tạo poster. Khi khách **hover (PC)** hoặc **dừng xem 2s (mobile)**, card đổi sang **360° sprite** lắc trái-phải (xem wireframe). Sprite cũng làm **fallback no-WebGL** cho viewer 3D (`model-viewer` chỉ load khi bấm "Xem 3D").
Tiến độ đẩy về Admin qua **SSE**. Xem `conventions.md` §3D-upload cho các ràng buộc bắt buộc (Cycles không OptiX/EEVEE, subprocess, presigned <100MB/part…).

## 6. OrderStatus state machine (tóm tắt — chi tiết ở `/spec.md` §04)

```
PENDING_CONFIRM → PAID → PRINTING → SHIPPING → COMPLETED   (inbox vào thẳng PAID)
đóng đơn:  CANCELLED (không hoàn)   REFUNDED (đã hoàn)       (đều bắt buộc reason)
```
Ánh xạ hàng đợi in: `Cần in` = PAID · `Đang in/Đóng gói` = PRINTING · `Đã giao` = SHIPPING.
Mọi transition: append `statusHistory{from,to,at,byUser,reason?}`. Reconcile → PAID là **owner-only**. Đây là phần được test kỹ nhất (xem `plan.md` Core, `conventions.md` §statusHistory).

## 7. Realtime

SSE từ Core API (server→browser: tiến độ hàng đợi in + AssetJob). NATS **không** lộ ra browser. Route SSE phải cấu hình chống buffer của Cloudflare + heartbeat; có fallback polling (xem `conventions.md` §Realtime).
