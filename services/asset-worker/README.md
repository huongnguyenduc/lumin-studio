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
