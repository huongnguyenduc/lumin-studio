//! The `sprite_render` GPU step — a thin Rust wrapper around `pysrc/render.py`, run as a SUBPROCESS
//! (ADR-007: never in-process, for crash isolation + retry). render.py drives headless Blender (Cycles +
//! CUDA on the GTX 1060) to render a 360° turntable, then tiles the frames into ONE WebP sprite sheet — the
//! GPU sibling of ingest.rs. This wrapper owns the invocation + error classification; the real GPU render
//! is gated on a Blender + GPU box (the o-1c gate), so only the classification is unit-tested here.

use std::path::Path;
use std::process::Command;

use serde::Deserialize;

use crate::processor::ProcessError;

/// The manifest `render.py` prints on success (one line of JSON, camelCase). `sprite_path` is the tiled
/// WebP sheet the caller uploads; `frames`/`cols` echo the fixed grid (ADR-049) the storefront tiler needs.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderManifest {
    pub sprite_path: String,
    pub frames: u64,
    pub cols: u64,
}

/// run_render invokes `python render.py <input> <out_dir>` and parses the manifest. Same error taxonomy as
/// run_ingest (ingest.rs):
///   - non-zero exit → **Permanent** (a bad/unsupported model, OR a Blender/GPU failure — the worker
///     reports `failed` so the owner sees it in Admin).
///     // ponytail: GPU faults are lumped into Permanent — on a dedicated concurrency=1 off-peak box GPU
///     // availability is stable, not blippy, and a genuine "no CUDA" won't self-heal on retry. If the box
///     // shows GPU flakiness, give render.py a distinct exit code for env faults and map it to Transient.
///   - spawn failure (python/script missing) or an exit-0-but-unparseable stdout → **Transient** (an
///     environment/tooling fault, not the model's — redeliver, so a mis-provisioned image never burns a job).
pub fn run_render(
    python: &str,
    script: &Path,
    input: &Path,
    out_dir: &Path,
) -> Result<RenderManifest, ProcessError> {
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
            "render exited {code}: {}",
            stderr.trim()
        )));
    }
    parse_manifest(&output.stdout)
}

/// parse_manifest reads render.py's stdout JSON. A tool that exits 0 but emits junk is a script/env bug,
/// not the model's fault → Transient (redeliver) rather than marking a good model `failed`.
fn parse_manifest(stdout: &[u8]) -> Result<RenderManifest, ProcessError> {
    serde_json::from_slice(stdout)
        .map_err(|e| ProcessError::Transient(format!("unparseable render manifest: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- pure parsing (CI-portable, no subprocess) ---
    #[test]
    fn parses_the_scripts_manifest() {
        let m = parse_manifest(br#"{"spritePath":"/out/sprite.webp","frames":24,"cols":6}"#)
            .expect("parse manifest");
        assert_eq!(m.frames, 24);
        assert_eq!(m.cols, 6);
        assert!(m.sprite_path.ends_with(".webp"));
    }

    #[test]
    fn exit0_but_junk_stdout_is_transient() {
        // A script that exits 0 with unparseable output is an env/script bug, not a bad model → retry.
        assert!(matches!(
            parse_manifest(b"not json"),
            Err(ProcessError::Transient(_))
        ));
    }

    // --- subprocess classification (CI-portable: no Blender needed) ---
    #[test]
    fn missing_interpreter_is_transient() {
        let err = run_render(
            "definitely-not-a-real-interpreter-xyz",
            Path::new("render.py"),
            Path::new("in.glb"),
            Path::new("/tmp/out"),
        )
        .unwrap_err();
        assert!(matches!(err, ProcessError::Transient(_)), "got {err:?}");
    }

    #[test]
    fn nonzero_exit_is_permanent() {
        // `sh /nonexistent-script …` exits non-zero — stands in for render.py rejecting a bad model or a
        // Blender/GPU failure (its contract: non-zero exit = permanent). Uses sh (present in CI), not Blender.
        let err = run_render(
            "sh",
            Path::new("/nonexistent-render-script-xyz"),
            Path::new("in.glb"),
            Path::new("/tmp/out"),
        )
        .unwrap_err();
        assert!(matches!(err, ProcessError::Permanent(_)), "got {err:?}");
    }
}
