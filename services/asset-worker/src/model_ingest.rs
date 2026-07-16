//! The `model_ingest` Processor: fetch the source model from Garage, run the trimesh geometry step
//! (ingest.rs), upload the derivative glb, and hand back its URL for the callback to write onto the
//! product. Plus `Dispatcher`, which routes a job to the right processor by `job_type`.

use std::path::PathBuf;

use crate::ingest::run_ingest;
use crate::job::{AssetJob, JobType};
use crate::objectstore::AssetStore;
use crate::processor::{Outcome, ProcessError, Processor};
use crate::sprite_render::SpriteRenderProcessor;

/// What the blocking ingest step hands back: (fused glb bytes, optional structured glb bytes [f-4], object
/// names [f-2]). A named type so the `spawn_blocking` closure signature stays clippy-simple.
type IngestOutput = (Vec<u8>, Option<Vec<u8>>, Vec<String>);

/// Processes `model_ingest` jobs. `store` is None when the assets bucket creds are unwired — then every
/// job is Transient (redeliver, wait for creds) rather than failed, mirroring core-api's fail-closed
/// upload stores. `script` is the baked `ingest.py` path; `python` the interpreter that has trimesh.
pub struct ModelIngestProcessor {
    pub store: Option<AssetStore>,
    pub python: String,
    pub script: PathBuf,
}

impl Processor for ModelIngestProcessor {
    async fn process(&self, job: &AssetJob) -> Result<Outcome, ProcessError> {
        let Some(store) = &self.store else {
            return Err(ProcessError::Transient(
                "assets bucket not configured — cannot fetch/upload (wire ASSETS_* creds)".into(),
            ));
        };

        // Derive the bucket key from the host-pinned source URL (core-api only enqueues URLs it minted).
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

        // Write source → run trimesh → read glb on a BLOCKING thread, so the async runtime (and the
        // JetStream InProgress heartbeat on it) is not stalled during a long ingest.
        let (python, script, job_id) = (
            self.python.clone(),
            self.script.clone(),
            job.asset_job_id.clone(),
        );
        let (glb, structured_glb, object_names) = tokio::task::spawn_blocking(
            move || -> Result<IngestOutput, ProcessError> {
                let dir = std::env::temp_dir().join(format!("lumin-ingest-{job_id}"));
                std::fs::create_dir_all(&dir)
                    .map_err(|e| ProcessError::Transient(format!("tmpdir: {e}")))?;
                let input = dir.join(format!("input.{ext}"));
                std::fs::write(&input, &src)
                    .map_err(|e| ProcessError::Transient(format!("write source: {e}")))?;
                let manifest = run_ingest(&python, &script, &input, &dir)?; // already-classified ProcessError
                let glb = std::fs::read(&manifest.glb_path)
                    .map_err(|e| ProcessError::Transient(format!("read glb: {e}")))?;
                // f-4: read the structured glb too (if the script emitted one — absent for a nameless source).
                let structured = match &manifest.structured_glb_path {
                    Some(p) => Some(std::fs::read(p).map_err(|e| {
                        ProcessError::Transient(format!("read structured glb: {e}"))
                    })?),
                    None => None,
                };
                tracing::info!(job = %job_id, dims_mm = ?manifest.dims_mm, triangles = manifest.triangles, objects = manifest.object_names.len(), structured = structured.is_some(), "model ingested");
                let _ = std::fs::remove_dir_all(&dir); // best-effort
                Ok((glb, structured, manifest.object_names))
            },
        )
        .await
        .map_err(|e| ProcessError::Transient(format!("ingest task join: {e}")))??;

        // Content-addressed output key (source_version is the content hash) → a re-render produces the
        // SAME URL, so a redelivery is idempotent end-to-end (core-api's `ready` is then a sticky no-op).
        let out_key = format!("derivatives/{}/model.glb", job.source_version);
        store
            .put_glb(&out_key, glb)
            .await
            .map_err(|e| ProcessError::Transient(format!("upload glb {out_key}: {e}")))?;

        // f-4: upload the STRUCTURED glb (if any) to a second content-addressed key — same idempotency.
        let structured_url = match structured_glb {
            Some(bytes) => {
                let key = format!("derivatives/{}/model_structured.glb", job.source_version);
                store.put_glb(&key, bytes).await.map_err(|e| {
                    ProcessError::Transient(format!("upload structured glb {key}: {e}"))
                })?;
                Some(store.output_url(&key))
            }
            None => None,
        };

        Ok(Outcome {
            model3d_url: Some(store.output_url(&out_key)),
            model3d_structured_url: structured_url, // f-4: named-objects glb (None for a nameless source)
            object_names, // f-2: the source model's object list (empty for a nameless STL)
            ..Default::default()
        })
    }
}

/// Routes a job to the right processor by kind (ADR-049): `model_ingest` → the trimesh LOD glb,
/// `sprite_render` → the Blender turntable WebP sprite sheet. Each is fail-closed on an unconfigured assets
/// store (Transient redeliver), so a job parks in the queue rather than being consumed or failed.
pub struct Dispatcher {
    pub model_ingest: ModelIngestProcessor,
    pub sprite_render: SpriteRenderProcessor,
}

impl Processor for Dispatcher {
    async fn process(&self, job: &AssetJob) -> Result<Outcome, ProcessError> {
        match job.job_type {
            JobType::ModelIngest => self.model_ingest.process(job).await,
            JobType::SpriteRender => self.sprite_render.process(job).await,
        }
    }
}

/// The file extension of a bucket key (`models/…/abc.GLB` → `GLB`), so the fetched source is written to a
/// temp file the tool (trimesh / Blender) can detect the format of. None when there is no extension. Shared
/// with sprite_render (both write the source by its extension before shelling out).
pub(crate) fn extension_of(key: &str) -> Option<&str> {
    key.rsplit('/')
        .next()
        .and_then(|f| f.rsplit_once('.'))
        .map(|(_, ext)| ext)
        .filter(|e| !e.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn job(kind: JobType, url: &str) -> AssetJob {
        AssetJob {
            asset_job_id: "job-mi".into(),
            product_id: "p".into(),
            job_type: kind,
            source_model_url: url.into(),
            source_version: "cafebabe".into(),
            part_colors: Default::default(),
        }
    }

    #[test]
    fn extension_of_reads_the_last_segment() {
        assert_eq!(extension_of("models/2026/07/15/abc.glb"), Some("glb"));
        assert_eq!(extension_of("a/b/model.STL"), Some("STL"));
        assert_eq!(extension_of("noext"), None);
        assert_eq!(extension_of("trailingdot."), None);
    }

    // Unconfigured assets (store None) → every model_ingest job is Transient (redeliver), never failed.
    #[tokio::test]
    async fn unconfigured_store_is_transient() {
        let p = ModelIngestProcessor {
            store: None,
            python: "python3".into(),
            script: "ingest.py".into(),
        };
        let err = p
            .process(&job(JobType::ModelIngest, "https://s3/lumin-assets/x.glb"))
            .await
            .unwrap_err();
        assert!(matches!(err, ProcessError::Transient(_)), "got {err:?}");
    }

    // The full milestone, gated on a real S3 (MODEL_INGEST_TEST_S3 + creds/bucket) AND a trimesh-capable
    // python (INGEST_PYTHON). Skips in CI. Setup (local minio): create the bucket + put testdata/box.obj
    // at `test/box.obj`, then run with the env below. Proves fetch → trimesh → upload → URL round-trip.
    #[tokio::test]
    async fn real_e2e_fetch_ingest_upload() {
        let (Ok(endpoint), Ok(python)) = (
            std::env::var("MODEL_INGEST_TEST_S3"),
            std::env::var("INGEST_PYTHON"),
        ) else {
            eprintln!(
                "skip: set MODEL_INGEST_TEST_S3 + INGEST_PYTHON (+ ASSETS_* creds) for the e2e"
            );
            return;
        };
        let bucket = std::env::var("ASSETS_BUCKET").unwrap_or_else(|_| "lumin-assets".into());
        let cfg = || crate::objectstore::AssetStoreConfig {
            s3_endpoint: endpoint.clone(),
            s3_region: std::env::var("ASSETS_S3_REGION").unwrap_or_else(|_| "garage".into()),
            bucket: bucket.clone(),
            public_base_url: format!("{}/{bucket}", endpoint.trim_end_matches('/')),
            access_key_id: std::env::var("ASSETS_ACCESS_KEY_ID").unwrap(),
            secret_access_key: std::env::var("ASSETS_SECRET_ACCESS_KEY").unwrap(),
        };
        let verify = AssetStore::new(cfg()).unwrap();
        let script = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("pysrc/ingest.py");

        // source at test/box.obj (pre-uploaded by setup); source_version drives the output key.
        let j = AssetJob {
            asset_job_id: "e2e".into(),
            product_id: "p".into(),
            job_type: JobType::ModelIngest,
            source_model_url: verify.output_url("test/box.obj"),
            source_version: "e2etest".into(),
            part_colors: Default::default(),
        };
        let p = ModelIngestProcessor {
            store: Some(AssetStore::new(cfg()).unwrap()),
            python,
            script,
        };
        let out = p.process(&j).await.expect("e2e ingest");
        assert_eq!(
            out.model3d_url.as_deref(),
            Some(verify.output_url("derivatives/e2etest/model.glb").as_str())
        );
        let glb = verify
            .get("derivatives/e2etest/model.glb")
            .await
            .expect("uploaded glb");
        assert!(glb.len() > 8 && &glb[0..4] == b"glTF", "valid glb magic");
    }

    // Dispatcher routes a sprite_render job to the SpriteRenderProcessor (here unconfigured → Transient),
    // never to the model path — the two kinds stay separated by job_type (ADR-049).
    #[tokio::test]
    async fn dispatcher_routes_sprite_to_sprite_processor() {
        let d = Dispatcher {
            model_ingest: ModelIngestProcessor {
                store: None,
                python: "python3".into(),
                script: "ingest.py".into(),
            },
            sprite_render: SpriteRenderProcessor {
                store: None,
                python: "python3".into(),
                script: "render.py".into(),
            },
        };
        let err = d
            .process(&job(JobType::SpriteRender, "https://s3/lumin-assets/x.glb"))
            .await
            .unwrap_err();
        assert!(matches!(err, ProcessError::Transient(_)), "got {err:?}");
    }
}
