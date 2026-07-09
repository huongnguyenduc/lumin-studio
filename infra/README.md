# infra/ — compose skeleton (Phase 0)

Hạ tầng self-host tại nhà cho Lumin Studio. Nguồn chân lý: [`docs/operations.md`](../docs/operations.md) §1–§2,
[`docs/architecture.md`](../docs/architecture.md) §2 (topology). Mọi service chạy bằng Docker Compose trong
**WSL2 Ubuntu + Docker** (ADR-009 — chấp nhận downtime, không VPS edge).

## Có gì trong skeleton này

| Service       | Image                    | Vai trò                                                                 |
| ------------- | ------------------------ | ----------------------------------------------------------------------- |
| `postgres`    | `postgres:17-alpine`     | DB app + bảng `outbox` + queue/job state                                |
| `nats`        | `nats:2.10-alpine`       | JetStream — hàng đợi AssetJob (WorkQueue/DLQ), file store               |
| `garage`      | `dxflrs/garage:v1.0.1`   | S3-compatible object storage (model/STL/.glb/sprite/ảnh), replication=1 |
| `caddy`       | `caddy:2-alpine`         | Routing nội bộ; Phase 0 serve "hello" + `/healthz`                      |
| `cloudflared` | `cloudflare/cloudflared` | Named tunnel ra internet (profile `edge`) — ẩn IP + TLS                 |

> **Chỉ hạ tầng.** App services (`core-api` Go, `asset-worker` Rust+Blender) chưa có image — xem
> [Deferred app services](#deferred-app-services). Storefront/Admin (Next) build thành image, Caddy
> reverse_proxy tới (khối comment trong `Caddyfile`).

## Quickstart

```bash
cd infra
cp .env.example .env

# Điền secret VÀO .env (bắt buộc — các key này để trống, compose ${VAR:?} sẽ chặn `up`).
# Linux/WSL2 (GNU sed). macOS: đổi `sed -i` → `sed -i ''`.
sed -i "s|^GARAGE_RPC_SECRET=.*|GARAGE_RPC_SECRET=$(openssl rand -hex 32)|"   .env
sed -i "s|^GARAGE_ADMIN_TOKEN=.*|GARAGE_ADMIN_TOKEN=$(openssl rand -hex 32)|" .env
sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -hex 24)|"   .env
# (tuỳ chọn) auth cho endpoint metrics garage:
# sed -i "s|^GARAGE_METRICS_TOKEN=.*|GARAGE_METRICS_TOKEN=$(openssl rand -hex 32)|" .env

docker compose up -d                  # local infra (không cần Cloudflare)
docker compose ps                     # 4 service infra phải "healthy"
curl localhost:8080/healthz           # → ok   (Caddy hello)
```

> ⚠️ `garage` báo **healthy** ngay cả khi **chưa** `layout apply` — healthcheck chỉ là
> liveness RPC, chưa phải S3 sẵn-sàng. Chạy bước [layout](#garage--khởi-tạo-layout-1-lần-sau-up-đầu-tiên) bên dưới trước khi ghi object.

Bật tunnel ra internet (cần `TUNNEL_TOKEN` trong `.env`):

```bash
docker compose --profile edge up -d cloudflared
```

Trong dashboard Cloudflare (named tunnel, token-based): trỏ public hostname → service `http://caddy:80`.
Mở hostname đó trên trình duyệt → thấy dòng "Phase 0 skeleton ... tunnel OK" = **plan.md Phase 0 Done "tunnel ra hello"**.

## Garage — khởi tạo layout (1 lần, sau `up` đầu tiên)

Garage fresh chưa có layout → chưa nhận ghi. Gán dung lượng cho node duy nhất:

```bash
docker compose exec garage /garage status              # lấy node id
docker compose exec garage /garage layout assign -z home -c 100G <NODE_ID_PREFIX>
docker compose exec garage /garage layout apply --version 1
# tạo bucket + key cho app (Phase 0 có thể làm khi core-api cần)
```

### Payment-proof bucket (Phase 2 P2-c)

Checkout receipt images use a **dedicated** Garage bucket, not the catalog/model asset bucket. Configure:

- bucket name matching `PAYMENT_PROOF_BUCKET` (default `lumin-payment-proofs`);
- an S3 key scoped to that bucket, wired as `PAYMENT_PROOF_ACCESS_KEY_ID` / `PAYMENT_PROOF_SECRET_ACCESS_KEY`;
- bucket CORS allowing the storefront origin to `POST` form uploads with `Content-Type` and `x-amz-*` fields;
- an object-age **lifecycle rule** as the orphan backstop (abandoned uploads that never became an order). The order-linked deletion — receipt images ~90 days after the order reaches a terminal state — is done by the core-api **retention sweeper** (`PAYMENT_PROOF_RETENTION` / `PAYMENT_PROOF_SWEEP_INTERVAL`), not the lifecycle rule (ADR-035).

The core-api signs a presigned POST policy with MIME + size constraints; it never proxies the image body.

## Secrets

`.env` thật **bị gitignore** (`!.env.example` là exception). Prod: lưu mã hoá **SOPS + age** trong repo,
giải mã per-service lúc deploy (`docs/conventions.md` §Secrets, ADR-024). Đừng `export` token tự-đặt-tên
(vd `GARAGE_RPC_SECRET`) ra shell — env-scrub không đảm bảo strip token tự-đặt-tên.

## Ports (localhost-only)

DB/queue/storage chỉ bind `127.0.0.1` — lối vào public **chỉ** qua Caddy ⇽ cloudflared. Đổi qua `.env`
(`POSTGRES_PORT`, `NATS_PORT`, `GARAGE_S3_PORT`, `GARAGE_ADMIN_PORT`, `CADDY_HTTP_PORT`).

## Deferred app services

Khi `services/core-api` (Go) và `services/asset-worker` (Rust) có `Dockerfile`, bỏ comment khối ở cuối
`docker-compose.yml`. `asset-worker` cần GPU passthrough (`gpus: all` + nvidia-container-toolkit,
`concurrency=1`, off-peak — ADR-014).

## GPU gate (cổng chặn Phase 0 — KHÔNG làm được ở compose này)

`operations.md §3` là cổng chặn riêng, làm trên **host WSL2**: driver NVIDIA (Windows) → `cuda-toolkit-12-x`
(WSL2) → nvidia-container-toolkit → **verify Blender render 1 frame CUDA trong container worker**. Chưa pass
= asset pipeline chưa xong. Skeleton này không động tới GPU.

## Lưu ý dev máy này (macOS) vs prod (WSL2)

Repo dev là macOS/arm64 — `docker compose config` validate được, và postgres/nats/garage/caddy **chạy được**
local để smoke-test. GPU + `asset-worker` chỉ thật trên host WSL2 + GTX 1060.
