//! The asset-pipeline worker loop: a durable JetStream **WorkQueue** pull consumer over the ASSET_JOBS
//! stream (core-api provisions the stream; the worker owns the consumer — natsx/conn.go). It pulls one
//! `asset_job.created` at a time (concurrency = 1, ADR-007/ADR-014), runs the pipeline with an InProgress
//! heartbeat so a long render is not redelivered mid-flight, then settles the message (ack/nak/term).
//! Durability lives in JetStream + the committed asset_jobs row, so a crash loses nothing (restart
//! rebinds the durable consumer and redelivers un-acked messages).

use std::future::Future;
use std::time::Duration;

use anyhow::{Context as _, Result};
use async_nats::jetstream::consumer::{pull, AckPolicy};
use async_nats::jetstream::{self, AckKind, Message};
use futures::StreamExt;

use crate::callback::{HttpReporter, Reporter};
use crate::config::Config;
use crate::job::AssetJob;
use crate::model_ingest::{Dispatcher, ModelIngestProcessor};
use crate::objectstore::AssetStore;
use crate::pipeline::{handle_job, Ack};
use crate::processor::Processor;
use crate::sprite_render::SpriteRenderProcessor;

/// Connect to NATS and run the consumer until a shutdown signal arrives.
pub async fn run(cfg: Config) -> Result<()> {
    let client = async_nats::connect(cfg.nats_url.as_str())
        .await
        .with_context(|| format!("connecting to NATS at {}", cfg.nats_url))?;
    tracing::info!("connected to NATS");

    let reporter = HttpReporter::new(&cfg);
    let processor = build_processor(&cfg);
    consume(client, &cfg, &processor, &reporter).await
}

/// Builds the job dispatcher: a `ModelIngestProcessor` (trimesh CPU) and a `SpriteRenderProcessor` (Blender
/// GPU, ADR-049), sharing one cheaply-cloned assets store. The store is None when its creds are unwired (or
/// fail to build) — both processors then redeliver (fail-closed), never `failed`.
fn build_processor(cfg: &Config) -> Dispatcher {
    let store = match cfg.assets_config() {
        Some(sc) => match AssetStore::new(sc) {
            Ok(s) => Some(s),
            Err(e) => {
                tracing::error!(error = %e, "assets store build failed — jobs will redeliver");
                None
            }
        },
        None => {
            tracing::warn!(
                "assets bucket unconfigured — model_ingest/sprite_render redeliver until ASSETS_* creds are set"
            );
            None
        }
    };
    Dispatcher {
        model_ingest: ModelIngestProcessor {
            store: store.clone(),
            python: cfg.ingest_python.clone(),
            script: cfg.ingest_script.clone().into(),
            timeout_secs: cfg.ingest_timeout_secs,
        },
        sprite_render: SpriteRenderProcessor {
            store,
            python: cfg.ingest_python.clone(),
            script: cfg.render_script.clone().into(),
            timeout_secs: cfg.render_timeout_secs,
        },
    }
}

/// consume binds the durable WorkQueue consumer and drives the drain loop.
async fn consume<P: Processor, R: Reporter>(
    client: async_nats::Client,
    cfg: &Config,
    processor: &P,
    reporter: &R,
) -> Result<()> {
    let js = jetstream::new(client);
    let stream = js
        .get_stream(&cfg.asset_stream)
        .await
        .with_context(|| format!("get JetStream stream {}", cfg.asset_stream))?;
    let consumer = stream
        .create_consumer(pull::Config {
            durable_name: Some(cfg.durable_name.clone()),
            filter_subject: cfg.job_subject.clone(),
            ack_policy: AckPolicy::Explicit,
            ack_wait: cfg.ack_wait,
            max_deliver: cfg.max_deliver as i64,
            ..Default::default()
        })
        .await
        .context("create durable WorkQueue consumer")?;
    tracing::info!(stream = %cfg.asset_stream, subject = %cfg.job_subject, "consumer bound");

    let mut messages = consumer.messages().await.context("open message stream")?;
    loop {
        tokio::select! {
            _ = shutdown_signal() => {
                tracing::info!("shutdown signal received — exiting after the current message");
                break;
            }
            next = messages.next() => match next {
                Some(Ok(msg)) => handle_message(&msg, cfg, processor, reporter).await,
                Some(Err(e)) => tracing::warn!(error = %e, "message stream error (will retry)"),
                None => break, // stream closed
            },
        }
    }
    Ok(())
}

/// handle_message parses one message, runs the pipeline under an InProgress heartbeat, and settles the
/// message per the returned Ack. A poison (unparseable) message is Termed to the DLQ straight away —
/// redelivering a body that can't be parsed never helps.
async fn handle_message<P: Processor, R: Reporter>(
    msg: &Message,
    cfg: &Config,
    processor: &P,
    reporter: &R,
) {
    let delivered = msg.info().map(|i| i.delivered as u64).unwrap_or(1);
    let job = match AssetJob::parse(&msg.payload) {
        Ok(j) => j,
        Err(e) => {
            tracing::warn!(error = %e, "poison message (unparseable AssetJob) — Term to DLQ");
            let _ = msg.ack_with(AckKind::Term).await;
            return;
        }
    };
    tracing::info!(job = %job.asset_job_id, delivered, "processing asset job");

    let ack = with_heartbeat(
        msg,
        cfg.heartbeat,
        handle_job(&job, processor, reporter, delivered, cfg.max_deliver),
    )
    .await;

    let settled = match ack {
        Ack::Ack => msg.ack().await,
        Ack::Nak => msg.ack_with(AckKind::Nak(None)).await,
        Ack::Term => msg.ack_with(AckKind::Term).await,
    };
    if let Err(e) = settled {
        // The ack itself failed (broker blip); the message redelivers on ack-wait. The callback is
        // idempotent (core-api `ready` is sticky), so re-processing a done job is a safe no-op.
        tracing::warn!(job = %job.asset_job_id, error = %e, "settling message failed — will redeliver");
    }
}

/// with_heartbeat runs `fut` while sending AckKind::Progress every `interval`, resetting the JetStream
/// ack-wait so a long render is not redelivered mid-flight (conventions §Queue). Returns `fut`'s output.
async fn with_heartbeat<F>(msg: &Message, interval: Duration, fut: F) -> F::Output
where
    F: Future,
{
    tokio::pin!(fut);
    let mut tick = tokio::time::interval(interval);
    tick.tick().await; // interval's first tick is immediate — consume it so the first heartbeat waits
    loop {
        tokio::select! {
            out = &mut fut => return out,
            _ = tick.tick() => {
                if let Err(e) = msg.ack_with(AckKind::Progress).await {
                    tracing::warn!(error = %e, "heartbeat (InProgress) failed");
                }
            }
        }
    }
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
