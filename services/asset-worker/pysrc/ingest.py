#!/usr/bin/env python3
"""model_ingest geometry step — normalize a source model and emit a LOD glb + metadata.

Run as a SUBPROCESS by the Rust worker (ADR-007: never in-process, for crash isolation + retry),
NOT imported. It is the CPU half of the asset pipeline (architecture.md §5.3): trimesh loads the source
(.glb/.stl/.obj/.3mf), recenters it to the origin, measures its bounding box (the dims that prefill the
Product), and exports a glb the storefront's model-viewer loads. The heavier gltf-transform LOD pass
(Draco/meshopt/KTX2 compression) is a later slice; this produces a plain, correct glb first.

Contract with the Rust wrapper (src/ingest.rs):
  argv: <input-model-path> <output-dir>
  stdout: ONE line of JSON — {"dimsMm":[w,d,h], "glbPath":"...", "triangles":N, "watertight":bool}
  exit 0 + that manifest on success; exit non-zero + a stderr reason on failure (a bad/unsupported
  model is a permanent failure the wrapper reports as `failed`; the wrapper classifies by exit path).
"""

import json
import sys
from pathlib import Path

import trimesh


def ingest(input_path: str, out_dir: str) -> dict:
    # force='mesh' collapses a multi-part scene into one mesh so extents/export are well-defined.
    mesh = trimesh.load(input_path, force="mesh")
    if mesh.is_empty or mesh.vertices.shape[0] == 0:
        raise ValueError("model has no geometry")

    # Normalize: recenter the bounding-box center to the origin (the worker owns placement; the source
    # may be modelled anywhere). Deterministic and lossless — no scaling, so real-world mm dims survive.
    mesh.apply_translation(-mesh.bounding_box.centroid)

    w, d, h = (round(float(x), 3) for x in mesh.extents)  # bounding-box dims, model units (mm)

    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    glb_path = out / "model.glb"
    glb_path.write_bytes(trimesh.exchange.gltf.export_glb(trimesh.Scene(mesh)))

    return {
        "dimsMm": [w, d, h],
        "glbPath": str(glb_path),
        "triangles": int(mesh.faces.shape[0]),
        "watertight": bool(mesh.is_watertight),
    }


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: ingest.py <input-model-path> <output-dir>", file=sys.stderr)
        return 2
    try:
        manifest = ingest(sys.argv[1], sys.argv[2])
    except Exception as e:  # noqa: BLE001 — any load/export failure is a permanent, reportable error
        print(f"ingest failed: {e}", file=sys.stderr)
        return 1
    print(json.dumps(manifest))
    return 0


if __name__ == "__main__":
    sys.exit(main())
