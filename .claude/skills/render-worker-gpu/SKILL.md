---
name: render-worker-gpu
description: Ràng buộc GPU/VRAM của render-worker Blender chạy trên GTX 1060 6GB tại nhà. Dùng khi task chạm render 360°/Blender/CUDA/VRAM/asset-pipeline/ops-deploy của worker — kể cả khi đang ở ngoài services/asset-worker/**. Đọc trước khi chọn render path / đổi VRAM/concurrency.
---

# Render-worker GPU — pointer

> **Pointer**, không restate. Đọc khi task chạm render/GPU/deploy-worker.

**Nguồn chân lý:** [`docs/operations.md`](../../../docs/operations.md) (§GPU/WSL2) + [`.claude/rules/asset-worker.md`](../../rules/asset-worker.md).
Quyết định: [`decisions.md`](../../../docs/decisions.md) **ADR-007** (giữ render 360° server-side) + **ADR-006** (NATS+outbox)
+ **ADR-009** (all-home, chấp nhận downtime).

**Vì sao là skill (không phải rule):** rule `asset-worker.md` chỉ auto-load khi chạm `services/asset-worker/**`. Nhưng
quyết định **ops/deploy/cost** (compose, cpus/VRAM limit, scheduling off-peak) hay chạm render từ **ngoài** path đó — skill
này surface ràng buộc đúng lúc.

**Ràng buộc cứng (chi tiết ở ADR-007):** Cycles + **CUDA** (KHÔNG OptiX — Pascal không RT core; KHÔNG EEVEE — chết
headless); OpenImageDenoise chạy **CPU** (CC 6.1); Blender **subprocess** (crash-isolation + retry), **concurrency=1**,
**off-peak**; decimate + ≤1080p + sample vừa để vừa **6GB VRAM**. WSL2: driver NVIDIA trên Windows + cuda-toolkit trong
WSL2, **không** cài driver Linux trong WSL2; validate Blender thấy GPU trong container trước khi coi là xong. Worker
**KHÔNG** render poster — ảnh đại diện dùng `Product.images[0]` (ảnh shop chụp).
