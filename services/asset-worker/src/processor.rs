//! The processing seam: turn a source model into derivative outputs. The real implementations
//! (`model_ingest` = trimesh normalize + gltf-transform LOD glb on CPU; `sprite_render` = Blender
//! Cycles+CUDA on the GTX 1060) shell out to subprocesses and land in a later, tooling/GPU-gated slice.
//! THIS slice ships the trait + the reliability spine around it (consume → process → report → ack), all
//! unit-testable without any of that tooling.

use std::future::Future;

use crate::job::AssetJob;

/// The successful output of processing one job. `model3d_url` is the uploaded LOD glb a `model_ingest`
/// produces (the storefront viewer's `model3d_url`); a `sprite_render` writes a sprite with no product
/// column yet (ADR-045), so it carries `None`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Outcome {
    pub model3d_url: Option<String>,
}

/// Why processing failed — classified for the WorkQueue lifecycle (pipeline::decide).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProcessError {
    /// Retrying can't help (bad/unsupported model) — report `failed`, ack (never redeliver).
    // allow(dead_code): the real processors (next slice) construct this for a bad model; the
    // Unimplemented stub only yields Transient. `pipeline::decide` already matches on it (+ tested).
    #[allow(dead_code)]
    Permanent(String),
    /// A transient hiccup (tool crash, S3 blip) — nak to redeliver, up to the consumer's max-deliver.
    Transient(String),
}

/// Processes one asset job. `+ Send` on the returned future (not a bare `async fn`) both silences the
/// `async_fn_in_trait` lint under `clippy -D warnings` and keeps the future usable across the worker's
/// multi-thread runtime. A fake impl drives the lifecycle tests; the real per-kind impls land later.
pub trait Processor {
    fn process(&self, job: &AssetJob)
        -> impl Future<Output = Result<Outcome, ProcessError>> + Send;
}

/// The processor the binary wires until the real trimesh/Blender impls land: every job is a **Transient**
/// failure, so the WorkQueue REDELIVERS (never Terms, never marks `failed`) — jobs simply wait in the
/// queue for a real worker. This makes deploying this slice early safe: it drains nothing permanently.
pub struct Unimplemented;

impl Processor for Unimplemented {
    async fn process(&self, _job: &AssetJob) -> Result<Outcome, ProcessError> {
        Err(ProcessError::Transient(
            "asset-worker processing not deployed yet (trimesh/Blender processors land in a later slice)"
                .into(),
        ))
    }
}
