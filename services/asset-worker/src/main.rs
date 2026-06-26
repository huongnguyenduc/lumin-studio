//! asset-worker — Lumin Studio asset pipeline worker (Rust + Blender).
//!
//! Phase 0 scaffold: process boot only. It initialises structured logging,
//! loads config from the environment, connects to NATS and idles until a
//! shutdown signal. The real pipeline — consuming AssetJob from a JetStream
//! WorkQueue (`concurrency = 1`), normalising the model with trimesh, rendering
//! a 360° sprite with Blender (Cycles + CUDA, run as a subprocess — never a
//! poster) and writing derivatives to Garage — lands in later phases. See
//! `docs/architecture.md` §5.3 and `conventions.md` §3D-upload / §Queue.

mod config;
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
