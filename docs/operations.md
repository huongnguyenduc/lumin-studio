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
- **Admin/Storefront (Next):** container đọc **`CORE_API_URL`** (server-only env, **KHÔNG** `NEXT_PUBLIC_`) trỏ tới `core-api:8080` — admin dashboard fetch `GET /admin/dashboard` **server-side** rồi forward cookie `lumin_session` (PR-3j, `apps/admin/.env.example`). Thiếu env ⇒ mỗi request dashboard trả 500 (fail-fast tại request-time, không phải boot-time). **Phải wire vào compose/Caddy khi container admin land** (app services còn deferred ở Phase 0 — chưa có Dockerfile).

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

## 4b. Auth bootstrap & secrets (core-api, ADR-030)
Core-api **tự phát JWT** (không dựa Cloudflare Access). Sau khi migrate xong, bootstrap tài khoản chủ + set secret:

1. **Seed owner đầu (một lần):** `make seed-owner` — đọc **`OWNER_EMAIL`** + **`OWNER_PASSWORD`** (bắt buộc; password ≥ 8 ký tự) + `OWNER_NAME` (tuỳ chọn, default "Chủ shop") + `DATABASE_URL` từ env. Nó bcrypt-hash mật khẩu và **upsert theo email** — chạy lại = **xoay mật khẩu** (không tạo trùng, giữ nguyên id). **KHÔNG** có mật khẩu nào commit vào repo; migration `000009` chỉ là DDL (`ALTER TABLE users ADD COLUMN password_hash`). Ví dụ:
   ```sh
   OWNER_EMAIL=chu@lumin.vn OWNER_PASSWORD='…đặt-ở-đây…' make seed-owner
   ```
2. **`JWT_SECRET` (bắt buộc ở prod):** khoá ký HS256 cho session JWT. **Chưa set = core-api TỪ CHỐI khởi động** (fail-fast) vì dev-secret công khai → token owner **giả mạo được** (reconcile→PAID / đổi STK). Nguồn từ env/secret manager, **không commit**.
   - **Local dev** (chấp nhận dev-secret): đặt `ALLOW_DEV_JWT_SECRET=true` để `go run` chạy được với secret dev (log Warn to). Không dùng cờ này ở prod.
3. **`JWT_TTL`** (default `12h`): tuổi thọ phiên; hết hạn → đăng nhập lại (**không** refresh token — ADR-030). **`COOKIE_SECURE`** (default `true`): cờ Secure của session cookie; chỉ set `false` cho local plain-http dev (không thì browser giữ cookie lại, login "im lặng" hỏng).

## 4c. DB extension `unaccent` (điều kiện migrate — ADR-016 / PR-P1-e)
Migration **`000012`** chạy `CREATE EXTENSION IF NOT EXISTS unaccent` (search catalog no-dấu). `unaccent` **không** phải extension *trusted*, nên role chạy `make migrate` phải có quyền tạo extension:
- **All-home (mặc định):** role migrate = superuser `postgres` → chạy thẳng, không cần gì thêm.
- **Nếu app chạy bằng role hạn chế:** pre-create một lần bằng superuser (`CREATE EXTENSION unaccent;` trong DB đích) **trước** khi migrate; migration `IF NOT EXISTS` sẽ no-op. Testcontainers/CI dùng `postgres:16-alpine` (contrib có sẵn unaccent) nên tự chạy được.
- **Rollback:** `000012` down **chỉ xoá function + index** nó tạo, **KHÔNG** `DROP EXTENSION` — vì UP dùng `IF NOT EXISTS` (có thể không phải nó tạo, extension có thể dùng chung) + role hạn chế không xoá được extension không sở-hữu. Extension còn lại sau rollback là **cố ý** (vô hại, re-CREATE idempotent).
- **Lưu ý:** nếu về sau đổi `unaccent.rules` (từ điển) thì phải `REINDEX INDEX products_search_idx` — `immutable_unaccent` được khai IMMUTABLE dựa trên từ điển cố định (xem comment migration 000012).

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
