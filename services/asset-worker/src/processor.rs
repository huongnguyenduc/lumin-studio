//! The processing seam: turn a source model into derivative outputs. The real implementations
//! (`model_ingest` = trimesh normalize + LOD glb on CPU; `sprite_render` = Blender Cycles+CUDA on the GTX
//! 1060, ADR-049) shell out to subprocesses (ADR-007 crash-isolation). The trait + the reliability spine
//! around it (consume → process → report → ack) are unit-testable without that tooling; the real
//! transforms are gated on a trimesh python / an on-box GPU respectively.

use std::future::Future;

use crate::job::AssetJob;

/// The successful output of processing one job. Exactly ONE field is set per kind (ADR-049): a
/// `model_ingest` sets `model3d_url` (the storefront viewer's LOD glb); a `sprite_render` sets
/// `sprite_sheet_url` (the card-hover 360° turntable + the model-viewer's no-WebGL fallback). `decide`
/// maps whichever is set into the render callback, and core-api writes it to the matching product column.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Outcome {
    pub model3d_url: Option<String>,
    /// f-4: the STRUCTURED glb URL (named objects/materials preserved) a `model_ingest` uploaded alongside
    /// model3d_url — the live viewer recolors per part by object name. None for a `sprite_render` and for a
    /// nameless single-mesh source (the viewer then falls back to model3d_url).
    pub model3d_structured_url: Option<String>,
    pub sprite_sheet_url: Option<String>,
    /// The object/material names a `model_ingest` found in the source model (f-2) — recorded on the product
    /// as the editor's part-mapping option set. Empty for a `sprite_render` (and a nameless single-mesh source).
    pub object_names: Vec<String>,
}

/// Why processing failed — classified for the WorkQueue lifecycle (pipeline::decide).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProcessError {
    /// Retrying can't help (bad/unsupported model / foreign source URL) — report `failed`, ack (never
    /// redeliver). Constructed by both real processors (a foreign source URL, a non-zero tool exit).
    Permanent(String),
    /// A transient hiccup (tool crash, S3 blip) — nak to redeliver, up to the consumer's max-deliver.
    Transient(String),
}

/// Processes one asset job. `+ Send` on the returned future (not a bare `async fn`) both silences the
/// `async_fn_in_trait` lint under `clippy -D warnings` and keeps the future usable across the worker's
/// multi-thread runtime. A fake impl drives the lifecycle tests; the real per-kind impls are
/// `ModelIngestProcessor` (CPU trimesh) and `SpriteRenderProcessor` (Blender GPU).
pub trait Processor {
    fn process(&self, job: &AssetJob)
        -> impl Future<Output = Result<Outcome, ProcessError>> + Send;
}
