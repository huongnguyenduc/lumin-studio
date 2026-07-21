//! The `sprite_render` Processor (ADR-049): fetch the source model from Garage, run the Blender turntable
//! (render.rs → pysrc/render.py), upload the derivative WebP sprite sheet, and hand back its URL for the
//! callback to write onto the product's `sprite_sheet_url`. The GPU sibling of `ModelIngestProcessor` —
//! deliberately parallel (fetch → tool → upload → Outcome), differing only in the tool, output type, key
//! namespace and Outcome field, so the two read as a matched pair rather than one forced abstraction.

use std::path::PathBuf;

use crate::job::AssetJob;
use crate::model_ingest::{extension_of, TempJobDir};
use crate::objectstore::AssetStore;
use crate::processor::{Outcome, ProcessError, Processor};
use crate::render::run_render;

/// Processes `sprite_render` jobs. `store` is None when the assets bucket creds are unwired — then every
/// job is Transient (redeliver, wait for creds), mirroring ModelIngestProcessor. `script` is the baked
/// `render.py` path; `python` the interpreter (the same baked python3 that has Pillow) it runs on — Blender
/// itself is a subprocess render.py spawns, off PATH, not invoked from here.
pub struct SpriteRenderProcessor {
    pub store: Option<AssetStore>,
    pub python: String,
    pub script: PathBuf,
    /// Wall-clock budget (secs) for one render.py run (config RENDER_TIMEOUT_SECS).
    pub timeout_secs: u64,
}

impl Processor for SpriteRenderProcessor {
    async fn process(&self, job: &AssetJob) -> Result<Outcome, ProcessError> {
        let Some(store) = &self.store else {
            return Err(ProcessError::Transient(
                "assets bucket not configured — cannot fetch/upload (wire ASSETS_* creds)".into(),
            ));
        };

        // The render source is the ORIGINAL uploaded model (host-pinned by core-api at enqueue), same as
        // model_ingest — render.py/Blender load it by extension and decimate to fit 6GB VRAM (ADR-049).
        let key = store
            .key_from_public_url(&job.source_model_url)
            .ok_or_else(|| {
                ProcessError::Permanent(format!(
                    "source model URL not under the assets origin: {}",
                    job.source_model_url
                ))
            })?;
        let src = store
            .get(&key)
            .await
            .map_err(|e| ProcessError::Transient(format!("fetch source {key}: {e}")))?;
        let ext = extension_of(&key).unwrap_or("glb").to_string();

        // f-5: freeze the per-part {objectName → hex} snapshot into a JSON string the render step hands to
        // Blender via env (render.rs). A String-keyed map can't fail to serialize; "{}" is the belt-and-braces
        // fallback → an uncoloured render, never a hard error.
        let part_colors_json =
            serde_json::to_string(&job.part_colors).unwrap_or_else(|_| "{}".to_string());

        // Write source → run Blender turntable + tile → read the WebP on a BLOCKING thread, so the async
        // runtime (and the JetStream InProgress heartbeat on it) is not stalled during a long GPU render.
        let (python, script, job_id, timeout_secs, camera_theta) = (
            self.python.clone(),
            self.script.clone(),
            job.asset_job_id.clone(),
            self.timeout_secs,
            job.camera_theta,
        );
        let sprite = tokio::task::spawn_blocking(move || -> Result<Vec<u8>, ProcessError> {
            let dir = TempJobDir::create("lumin-sprite", &job_id)
                .map_err(|e| ProcessError::Transient(format!("tmpdir: {e}")))?;
            let input = dir.path().join(format!("input.{ext}"));
            std::fs::write(&input, &src)
                .map_err(|e| ProcessError::Transient(format!("write source: {e}")))?;
            let manifest = run_render(
                &python,
                &script,
                &input,
                dir.path(),
                &part_colors_json,
                camera_theta,
                timeout_secs,
            )?; // already-classified ProcessError
            let sprite = std::fs::read(&manifest.sprite_path)
                .map_err(|e| ProcessError::Transient(format!("read sprite: {e}")))?;
            tracing::info!(job = %job_id, frames = manifest.frames, cols = manifest.cols, "sprite rendered");
            // `dir` drops here (and on every early return above via `?`), always cleaning up.
            Ok(sprite)
        })
        .await
        .map_err(|e| ProcessError::Transient(format!("render task join: {e}")))??;

        // Content-addressed output key (source_version is the content hash) → a re-render produces the SAME
        // URL, so a redelivery is idempotent end-to-end (core-api's `ready` is then a sticky no-op).
        let out_key = format!("derivatives/{}/sprite.webp", job.source_version);
        store
            .put_webp(&out_key, sprite)
            .await
            .map_err(|e| ProcessError::Transient(format!("upload sprite {out_key}: {e}")))?;

        Ok(Outcome {
            sprite_sheet_url: Some(store.output_url(&out_key)),
            ..Default::default()
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::job::JobType;

    // Unconfigured assets (store None) → every sprite_render job is Transient (redeliver), never failed —
    // the fail-closed mirror of ModelIngestProcessor.
    #[tokio::test]
    async fn unconfigured_store_is_transient() {
        let p = SpriteRenderProcessor {
            store: None,
            python: "python3".into(),
            script: "render.py".into(),
            timeout_secs: 300,
        };
        let job = AssetJob {
            asset_job_id: "job-sr".into(),
            product_id: "p".into(),
            job_type: JobType::SpriteRender,
            source_model_url: "https://s3/lumin-assets/x.glb".into(),
            source_version: "cafebabe".into(),
            part_colors: Default::default(),
            camera_theta: Default::default(),
        };
        let err = p.process(&job).await.unwrap_err();
        assert!(matches!(err, ProcessError::Transient(_)), "got {err:?}");
    }
}
