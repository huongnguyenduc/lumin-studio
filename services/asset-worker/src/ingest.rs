//! The `model_ingest` geometry step — a thin Rust wrapper around `pysrc/ingest.py` (trimesh), run as a
//! SUBPROCESS (ADR-007: crash-isolation + retry, never in-process). It turns a source model file into a
//! recentered glb + its bounding-box dims. The S3 fetch that feeds it and the upload that consumes its
//! glb — plus wiring this into the `model_ingest` `Processor` — are the next slice; THIS ships the
//! verified transform and its output parsing.

use std::path::Path;
use std::process::Command;

use serde::Deserialize;

use crate::processor::ProcessError;

/// The manifest `ingest.py` prints on success (one line of JSON, camelCase). `dims_mm` is the recentered
/// bounding box `[w, d, h]` in model units (mm) — the values that prefill Product; `glb_path` is the
/// exported glb the caller uploads to lumin-assets.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub dims_mm: [f64; 3],
    pub glb_path: String,
    pub triangles: u64,
    pub watertight: bool,
    /// The object/material names in the SOURCE model (f-2). The recentered export fuses to one mesh, so
    /// these are read separately (ingest.py `scene.geometry.keys()`) and never affect dims/glb. Empty for a
    /// single-mesh source (an STL). `#[serde(default)]` keeps an older ingest.py that omits the field parseable.
    #[serde(default)]
    pub object_names: Vec<String>,
}

/// run_ingest invokes `python ingest.py <input> <out_dir>` and parses the manifest. Error classification
/// drives the WorkQueue lifecycle (processor::ProcessError):
///   - non-zero exit → **Permanent** (the script's contract: a bad/unsupported model — retrying can't
///     help; the worker reports `failed`).
///   - spawn failure (python/script missing) or an exit-0-but-unparseable stdout → **Transient** (an
///     environment/tooling fault, not the model's — redeliver, so a mis-provisioned image never burns a
///     good job as `failed`).
pub fn run_ingest(
    python: &str,
    script: &Path,
    input: &Path,
    out_dir: &Path,
) -> Result<Manifest, ProcessError> {
    let output = Command::new(python)
        .arg(script)
        .arg(input)
        .arg(out_dir)
        .output()
        .map_err(|e| ProcessError::Transient(format!("spawn {python}: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let code = output
            .status
            .code()
            .map(|c| c.to_string())
            .unwrap_or_else(|| "signal".into());
        return Err(ProcessError::Permanent(format!(
            "ingest exited {code}: {}",
            stderr.trim()
        )));
    }
    parse_manifest(&output.stdout)
}

/// parse_manifest reads the script's stdout JSON. A tool that exits 0 but emits junk is a script/env bug,
/// not the model's fault → Transient (redeliver) rather than marking a good model `failed`.
fn parse_manifest(stdout: &[u8]) -> Result<Manifest, ProcessError> {
    serde_json::from_slice(stdout)
        .map_err(|e| ProcessError::Transient(format!("unparseable ingest manifest: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn crate_dir() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
    }

    // --- pure parsing (CI-portable, no subprocess) ---
    #[test]
    fn parses_the_scripts_manifest() {
        let m = parse_manifest(
            br#"{"dimsMm":[20.0,30.0,40.0],"glbPath":"/out/model.glb","triangles":12,"watertight":true}"#,
        )
        .expect("parse manifest");
        assert_eq!(m.dims_mm, [20.0, 30.0, 40.0]);
        assert_eq!(m.triangles, 12);
        assert!(m.watertight);
        assert!(m.glb_path.ends_with(".glb"));
    }

    #[test]
    fn parses_object_names_and_defaults_empty() {
        // f-2: objectNames flows through when present…
        let m = parse_manifest(
            r#"{"dimsMm":[1.0,2.0,3.0],"glbPath":"/o/m.glb","triangles":4,"watertight":false,"objectNames":["Chao đèn","Đế"]}"#
                .as_bytes(),
        )
        .expect("parse with names");
        assert_eq!(
            m.object_names,
            vec!["Chao đèn".to_string(), "Đế".to_string()]
        );
        // …and an older ingest.py that omits it still parses (serde default → empty), never a Transient fail.
        let m0 = parse_manifest(
            br#"{"dimsMm":[1.0,2.0,3.0],"glbPath":"/o/m.glb","triangles":4,"watertight":false}"#,
        )
        .expect("parse without names");
        assert!(m0.object_names.is_empty());
    }

    #[test]
    fn exit0_but_junk_stdout_is_transient() {
        // A script that exits 0 with unparseable output is an env/script bug, not a bad model → retry.
        assert!(matches!(
            parse_manifest(b"not json"),
            Err(ProcessError::Transient(_))
        ));
    }

    // --- subprocess classification (CI-portable: no trimesh needed) ---
    #[test]
    fn missing_interpreter_is_transient() {
        let err = run_ingest(
            "definitely-not-a-real-interpreter-xyz",
            Path::new("ingest.py"),
            Path::new("in.obj"),
            Path::new("/tmp/out"),
        )
        .unwrap_err();
        assert!(matches!(err, ProcessError::Transient(_)), "got {err:?}");
    }

    #[test]
    fn nonzero_exit_is_permanent() {
        // `sh /nonexistent-script …` exits non-zero — stands in for the ingest script rejecting a bad
        // model (its contract: non-zero exit = permanent). Uses sh (present in CI), not trimesh.
        let err = run_ingest(
            "sh",
            Path::new("/nonexistent-ingest-script-xyz"),
            Path::new("in.obj"),
            Path::new("/tmp/out"),
        )
        .unwrap_err();
        assert!(matches!(err, ProcessError::Permanent(_)), "got {err:?}");
    }

    // --- the REAL transform, gated on a trimesh-capable python (INGEST_PYTHON). Skips in CI (no
    // trimesh), runs locally / on the box. Proves the script+wrapper against the committed fixture. ---
    #[test]
    fn real_trimesh_ingests_the_fixture() {
        let Ok(python) = std::env::var("INGEST_PYTHON") else {
            eprintln!("skip: set INGEST_PYTHON to a python with trimesh to run the real ingest");
            return;
        };
        let script = crate_dir().join("pysrc/ingest.py");
        let input = crate_dir().join("testdata/box.obj");
        let out = std::env::temp_dir().join("lumin-ingest-test");
        let m = run_ingest(&python, &script, &input, &out).expect("real ingest");
        // The fixture is a 20×30×40 box translated off-origin — recentering must not change the dims.
        assert_eq!(m.dims_mm, [20.0, 30.0, 40.0]);
        assert!(std::path::Path::new(&m.glb_path).exists(), "glb written");
        assert!(m.triangles > 0);
    }
}
