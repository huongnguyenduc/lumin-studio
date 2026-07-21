---
description: Luật cho asset-worker (Rust + Blender) — Cycles+CUDA, concurrency=1, presigned multipart, job idempotent.
paths:
  - "services/asset-worker/**"
---

# Asset worker (Rust + Blender)

> Vì sao: [`/docs/decisions.md`](../../docs/decisions.md) **ADR-007** · [`/docs/conventions.md`](../../docs/conventions.md) §3D-upload.

- **Render: Cycles + CUDA only.** KHÔNG OptiX (GTX 1060 Pascal không RT core), KHÔNG EEVEE (chết headless). Denoise = **OpenImageDenoise CPU** (CC 6.1).
- Chạy Blender dạng **subprocess** (không `bpy` in-process) để crash-isolation + retry.
- **concurrency = 1**, chạy off-peak. Decimate + ≤1080p + sample vừa để vừa 6GB VRAM.
- **Upload model:** S3 **multipart presigned-PUT, mỗi part < 100MB** (Cloudflare Tunnel chặn body >100MB). KHÔNG POST proxy qua tunnel.
- **AssetJob idempotent**, tái tạo được từ model gốc. Prefill Product từ trimesh ngay khi đọc xong metadata; render (**360° sprite — KHÔNG poster**) gắn sau khi job `ready`.
- LOD `.glb` nhỏ (<5MB, Draco/meshopt + KTX2, <50k tris); serve **immutable content-hash URL** sau Cloudflare cache.
- **Ảnh shop chụp KHÔNG thuộc worker này.** Rule cũ ghi "derivative AVIF/WebP/JPEG pre-gen lúc upload" — chưa từng được implement, và **ADR-055 đã chốt hướng khác**: resize/WebP làm **on-the-fly bởi imgproxy** (`infra/k8s/imgproxy.yaml`). Đừng thêm bước xử lý ảnh vào worker.
- Consumer NATS: WorkQueue, ack-wait dài + InProgress heartbeat cho render lâu, MaxDeliver + republish DLQ.
- Validate Blender thấy GPU trong chính container (Blender #126014) trước khi coi pipeline là xong.
