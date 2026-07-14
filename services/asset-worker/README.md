# asset-worker — Lumin Studio asset pipeline (Rust + Blender)

Consumes `AssetJob` from NATS JetStream and produces the assets the storefront
serves: a normalised model + extracted dimensions/material (prefills Product),
LOD `.glb`, a **360° sprite** (never a poster), and image derivatives — all
written to Garage. See [`docs/architecture.md`](../../docs/architecture.md) §5.3
and [`conventions.md`](../../docs/conventions.md) §3D-upload / §Queue.

## Status

**Phase 0 scaffold.** Process boot only: JSON structured logging, env config,
a NATS connection, and graceful shutdown on SIGINT/SIGTERM. No JetStream
consumer and no Blender yet.

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

Env: `NATS_URL` (default `nats://127.0.0.1:4222`), `ASSET_JOB_SUBJECT`
(default `asset.job`), `RUST_LOG` (default `info`).

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
