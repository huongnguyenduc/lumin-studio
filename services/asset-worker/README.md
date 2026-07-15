# asset-worker — Lumin Studio asset pipeline (Rust + Blender)

Consumes `AssetJob` from NATS JetStream and produces the assets the storefront
serves: a normalised model + extracted dimensions/material (prefills Product),
LOD `.glb`, a **360° sprite** (never a poster), and image derivatives — all
written to Garage. See [`docs/architecture.md`](../../docs/architecture.md) §5.3
and [`conventions.md`](../../docs/conventions.md) §3D-upload / §Queue.

## Status

**Consumer spine (ADR-045).** A durable JetStream **WorkQueue** pull consumer over `ASSET_JOBS` binds
`asset_job.created` (concurrency = 1), runs the process→report→ack lifecycle — at-least-once, InProgress
heartbeat, DLQ on max-deliver — and reports each result to core-api via the render callback
(`PATCH /internal/asset-jobs/{id}`). The **actual per-kind processing is a seam** (`processor::Processor`):
the binary wires `Unimplemented` (every job → Transient → redeliver, so nothing is consumed or failed) until
the real processors land — `model_ingest` (trimesh normalize + gltf-transform LOD glb, **CPU**) and
`sprite_render` (Blender Cycles+CUDA on the GTX 1060, **GPU**) — a later, tooling/GPU-gated slice that also
bakes trimesh/gltf-transform into the image and wires the Garage upload creds.

The reliability logic (payload parse, `pipeline::decide`, `handle_job`) is fully unit-tested Docker-free;
the live NATS bind + drain is a **deploy-time smoke** (below), mirroring the o-1c Blender-sees-GPU gate.

**model_ingest is WIRED end-to-end.** `Dispatcher` routes `model_ingest` to `ModelIngestProcessor`
(`sprite_render` stays `Unimplemented`). The processor: fetch the source model from lumin-assets
(`objectstore.rs`, object_store/S3) → run the trimesh step (`pysrc/ingest.py` via `ingest.rs`, on a
`spawn_blocking` thread so the heartbeat keeps firing) → upload the glb at a content-addressed key
(`derivatives/<source_version>/model.glb`, so a re-render is idempotent) → report `ready` + the URL via
the callback. The output URL is under the assets public base, so core-api's `OwnsOutputURL` host-pin
accepts it. `sprite_render` (Blender/GPU) and the dims→Product prefill (needs a callback field) are the
remaining follow-ups.

Verified: pure URL/dispatch/classify tests run in CI; the **real trimesh** transform runs against
`testdata/box.obj` with `INGEST_PYTHON`; the **full fetch→ingest→upload round-trip** runs against a local
S3 with `MODEL_INGEST_TEST_S3` + `INGEST_PYTHON` + `ASSETS_*` (create the bucket, put `testdata/box.obj`
at `test/box.obj`, then `cargo test real_e2e`) — both skip in CI. The image build (python3 + trimesh) is
box-verified, like the Blender bake.

### Locked constraints for later phases (do not relitigate)

- **Blender: Cycles + CUDA only** — no OptiX (Pascal has no RT cores), no EEVEE
  (dies headless). Run Blender as a **subprocess** (crash isolation + retry),
  **concurrency = 1**, off-peak, on the GTX 1060 6GB. Render a **360° sprite,
  never a poster**. (`conventions.md` §3D-upload; GPU host setup is the Phase-0
  ops gate in `operations.md` §3.)
- **Queue:** durable JetStream WorkQueue, long ack-wait + InProgress heartbeat,
  DLQ on MaxDeliver; jobs are idempotent and rebuildable from the source model
  (`conventions.md` §Queue).

## Run & verify

```bash
# from this directory (needs a reachable NATS at NATS_URL)
NATS_URL=nats://127.0.0.1:4222 cargo run
cargo test

# from the repo root — the gate the harness arms when *.rs lands
make verify-rs   # cargo fmt --check + clippy -D warnings + cargo test
```

Env: `NATS_URL` (`nats://127.0.0.1:4222`), `ASSET_STREAM` (`ASSET_JOBS`), `ASSET_DURABLE`
(`asset-worker`), `ASSET_JOB_SUBJECT` (`asset_job.created`), `ASSET_MAX_DELIVER` (`5`),
`ASSET_ACK_WAIT_SECS` (`30`), `ASSET_HEARTBEAT_SECS` (`10`), `CORE_API_URL` (`http://127.0.0.1:8080`),
`WORKER_CALLBACK_TOKEN` (empty → callback 401s, harmless until the real processor + token land),
`RUST_LOG` (`info`).

**Live drain smoke (on the deployed cluster, once the real processor lands):** publish a test
`asset_job.created` onto `ASSET_JOBS`, then confirm the worker logs `processing asset job` and (for a
`model_ingest`) the product's `model3d_url` is set. With the current `Unimplemented` processor the job
just redelivers — the honest signal that no real processor is wired yet.

## Container image + GPU gate (o-1c)

`Dockerfile` is multi-stage: build the Rust binary (Debian bullseye — older glibc so it runs on
the ubuntu-22.04 runtime) → CUDA-runtime base + headless Blender + the binary. Blender is baked in
**now** even though the worker code doesn't call it yet — o-1c exists to prove the GPU deploy
substrate off the web-live critical path (placing an order renders nothing), so the risky WSL2 GPU
image never blocks go-live.

Wired into `infra/docker-compose.yml` behind the **`gpu` profile** (`--gpus all` needs a real
NVIDIA GPU, so a GPU-less dev `up` stays green):

```bash
# On the WSL2 + GTX 1060 box only (host GPU gate must already pass — operations.md §3):
docker compose --profile gpu build asset-worker
docker compose --profile gpu up -d asset-worker            # worker connects to NATS + idles

# The o-1c done-gate — Blender must enumerate the CUDA GPU INSIDE the container (operations.md §3;
# else the WSL2 "No Compatible GPUs Found" bug #126014). --entrypoint overrides the worker binary;
# a bare Cycles render would silently fall back to CPU, so query the devices explicitly instead:
docker compose --profile gpu run --rm --entrypoint blender asset-worker \
  -b --debug-cycles \
  --python-expr "import bpy; p=bpy.context.preferences.addons['cycles'].preferences; p.compute_device_type='CUDA'; p.refresh_devices(); print('CUDA:', [d.name for d in p.devices if d.type=='CUDA'])"
# expect e.g. CUDA: ['NVIDIA GeForce GTX 1060 6GB'] — an empty list means passthrough is broken.
```

The full render pipeline (JetStream WorkQueue consumer → Blender subprocess → Garage) is a later
worker phase; o-1c ships the deployable image + passthrough only.
