# Operations — deploy / CI-CD / backup / observability / GPU

> **Mục đích:** chạy hệ ở đâu và bằng cách nào. Tất cả self-host tại nhà (ADR-009).
> **Liên quan:** [`architecture.md`](architecture.md) §Topology · [`decisions.md`](decisions.md) ADR-005/006/007/009/014/018.

## 1. Máy & runtime
- **Host:** Windows + **WSL2 Ubuntu** + Docker (Docker Desktop dùng backend WSL2). GPU: **1× NVIDIA GTX 1060 6GB** (Pascal, CC 6.1).
- Mọi service chạy bằng **Docker Compose** trong WSL2. Lộ ra internet qua **Cloudflare Tunnel (`cloudflared`, named tunnel)**.
- Pin `.wslconfig` giới hạn RAM (WSL2 cache hung hãn). **32GB RAM gần như bắt buộc** vì giữ render Blender (ADR-007).

## 2. Compose (phác thảo)
Service: `core-api` (Go), `asset-worker` (Rust+Blender, `--gpus all`), `postgres`, `postgres-umami`, `nats` (JetStream, file store), `garage`, `caddy` (routing nội bộ), `cloudflared`, + (Phase 5) `otel-collector`, `openobserve` (hoặc victoria*), `uptime-kuma`, `glitchtip`, `umami`.
- `restart: unless-stopped` + healthcheck mọi service.
- **`cpus=` + `cpu_shares` limit** cho mọi container observability/analytics để Blender/BFF luôn thắng CPU khi render (ADR-014).
- Garage `replication_factor = 1`; data trên ext4 trong WSL2 (tránh path interop Windows chậm).

## 3. GPU trong WSL2 (làm ở Phase 0 — đây là cổng chặn)
1. Cài **driver NVIDIA trên Windows** (R535+). **KHÔNG** cài driver GPU Linux trong WSL2 (ghi đè libcuda → hỏng `/dev/dxg`).
2. Trong WSL2 Ubuntu: cài **`cuda-toolkit-12-x`** từ repo `wsl-ubuntu`.
3. **NVIDIA Container Toolkit**: `nvidia-ctk runtime configure --runtime=docker`; verify bằng container `nbody`/`nvidia-smi`.
4. **Validate Blender thấy GPU trong chính container worker** (`blender -b --debug-cycles`) — Blender hay báo "No Compatible GPUs Found on WSL2" (#126014), thường fix bằng cuda-toolkit ở bước 2. Chưa pass = pipeline chưa xong.

## 4. CI/CD
- **GitHub Actions** + Turborepo cache, build **affected-only**.
- Frontend (Next): build → image. Go/Rust services: build image. Đẩy **GHCR**.
- Rollout: **self-hosted runner** hoặc **Watchtower** trên PC pull image mới → `docker compose up -d`.
- Migration DB: chạy như **one-shot job** trong bước deploy (gated). 3 môi trường: preview (PR) · staging (compose profile riêng + DB/bucket prefix throwaway) · prod. Region gần VN (PC đặt tại VN).

## 5. Backup & DR (điều kiện launch — ADR-018)
- **Postgres:** WAL-G (Go, S3-native — hợp; hoặc pgBackRest đã hồi sinh 5/2026) — base backup + WAL liên tục → bucket offsite.
- **Object (Garage) + compose/secrets:** **restic** (mã hoá, dedup) → offsite + 1 ổ ngoài để restore nhanh (3-2-1).
- Garage **không versioning** → backup là lưới an toàn duy nhất; thêm soft-delete + key content-hash bất biến trong BFF.
- Lịch off-peak (backup upload đua băng thông nhà). **TEST một lần restore trước launch.**

## 6. Observability (Phase 5 — ADR-014)
- 1 **OTel Collector** (memory_limiter + batch) làm phễu; app emit OTLP tới nó.
- Backend: **đánh giá OpenObserve trước** (1 binary Rust, lưu vào Garage). Fallback VictoriaMetrics + VictoriaLogs. Trace để sau (Tempo single-binary nếu cần).
- **Uptime Kuma** ping storefront/admin/BFF/Garage/worker + hostname public — và **ping từ ngoài host** để biết khi cả máy sập.
- **GlitchTip** (SDK Sentry trong Next/Go/Rust). Lộ UI observability **chỉ sau Cloudflare Access**, không lộ cổng OTLP thô.
- Instrument worker: span mỗi stage AssetJob + metric `gpu_render_duration` để tương quan contention với latency API.

## 7. Edge (Cloudflare)
- Tunnel ẩn IP + TLS. **Cache Rules**: cache catalog + asset (URL content-hash bất biến, TTL dài) + **Tiered Cache** (free) để web sống khi PC reboot.
- **Access** trùm Admin + API admin/extension. **WAF** rate-limit checkout/lookup/auth.
- Lưu ý ToS: serve file lớn từ origin nhà qua CDN free có rủi ro — giữ asset nhỏ; lối thoát là bucket R2 cho asset public (ADR-005).

## 8. Bù downtime (gần-free, nên làm)
UPS cho PC · tắt auto-reboot Windows update · cache catalog mạnh · Uptime Kuma cảnh báo từ ngoài. (User chấp nhận downtime — không VPS edge, ADR-009.)
