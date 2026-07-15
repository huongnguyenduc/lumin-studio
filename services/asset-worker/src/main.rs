//! asset-worker — Lumin Studio asset pipeline worker (Rust + Blender).
//!
//! Consumes `asset_job.created` off the JetStream **WorkQueue** ASSET_JOBS (concurrency = 1), runs the
//! pipeline, and reports each result back to core-api via the render callback (ADR-045). This slice
//! ships the reliability spine — the durable consumer, the process→report→ack lifecycle (at-least-once,
//! InProgress heartbeat, DLQ on max-deliver), and the callback client — with the actual per-kind
//! processing behind a seam (`processor::Processor`). The real processors — `model_ingest` (trimesh
//! normalize + gltf-transform LOD glb, CPU) and `sprite_render` (Blender Cycles+CUDA on the GTX 1060,
//! never a poster) — shell out to subprocesses and land in a later, tooling/GPU-gated slice. See
//! `docs/architecture.md` §5.3 and `conventions.md` §3D-upload / §Queue.

mod callback;
mod config;
mod ingest;
mod job;
mod model_ingest;
mod objectstore;
mod pipeline;
mod processor;
mod worker;

use anyhow::Result;

#[tokio::main]
async fn main() -> Result<()> {
    init_tracing();

    let cfg = config::Config::from_env();
    tracing::info!(
        nats_url = %cfg.nats_url,
        job_subject = %cfg.job_subject,
        "asset-worker starting"
    );

    worker::run(cfg).await
}

/// Initialise JSON structured logging, honouring `RUST_LOG` (default `info`).
fn init_tracing() {
    use tracing_subscriber::{fmt, EnvFilter};

    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    fmt().with_env_filter(filter).json().init();
}
