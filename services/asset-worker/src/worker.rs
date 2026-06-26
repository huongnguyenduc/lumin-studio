//! The asset-pipeline worker loop.

use anyhow::{Context, Result};

use crate::config::Config;

/// Connect to NATS and run until a shutdown signal arrives.
///
/// Phase 0: establishes the NATS connection and idles until SIGINT/SIGTERM,
/// then flushes and exits. The JetStream WorkQueue consumer (durable,
/// `concurrency = 1`, long ack-wait with InProgress heartbeats, DLQ on
/// MaxDeliver — `conventions.md` §Queue) and the Blender render stages attach
/// here in later phases.
pub async fn run(cfg: Config) -> Result<()> {
    let client = async_nats::connect(cfg.nats_url.as_str())
        .await
        .with_context(|| format!("connecting to NATS at {}", cfg.nats_url))?;
    tracing::info!("connected to NATS");

    // TODO(phase-1): bind a JetStream WorkQueue pull consumer on
    // `cfg.job_subject` with concurrency = 1 and drive the AssetJob pipeline.

    shutdown_signal().await;
    tracing::info!("shutdown signal received, flushing NATS");
    // Phase-1 TODO: once the JetStream WorkQueue consumer exists, replace this
    // flush with a graceful drain (unsubscribe + finish in-flight acks).
    if let Err(e) = client.flush().await {
        tracing::warn!(error = %e, "flush on shutdown failed");
    }
    Ok(())
}

/// Resolve when the process receives SIGINT (Ctrl-C) or SIGTERM.
async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("install Ctrl-C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("install SIGTERM handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {}
        _ = terminate => {}
    }
}
