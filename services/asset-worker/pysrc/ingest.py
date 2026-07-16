#!/usr/bin/env python3
"""model_ingest geometry step — normalize a source model and emit a LOD glb + metadata.

Run as a SUBPROCESS by the Rust worker (ADR-007: never in-process, for crash isolation + retry),
NOT imported. It is the CPU half of the asset pipeline (architecture.md §5.3): trimesh loads the source
(.glb/.stl/.obj/.3mf), recenters it to the origin, measures its bounding box (the dims that prefill the
Product), and exports a glb the storefront's model-viewer loads. The heavier gltf-transform LOD pass
(Draco/meshopt/KTX2 compression) is a later slice; this produces a plain, correct glb first.

Contract with the Rust wrapper (src/ingest.rs):
  argv: <input-model-path> <output-dir>
  stdout: ONE line of JSON — {"dimsMm":[w,d,h], "glbPath":"...", "triangles":N, "watertight":bool,
          "objectNames":[...], "structuredGlbPath":"..."?}
          objectNames = f-2 part-mapping options ([] for a single-mesh source); structuredGlbPath = the f-4
          named-objects glb, OMITTED when the source has no named objects (the viewer falls back to glbPath).
  exit 0 + that manifest on success; exit non-zero + a stderr reason on failure (a bad/unsupported
  model is a permanent failure the wrapper reports as `failed`; the wrapper classifies by exit path).
"""

import json
import sys
from pathlib import Path

import trimesh


def structured_artifact(input_path: str, translation, out_dir: str):
    """f-2/f-4: load the SOURCE as a Scene (names + materials intact — the fused export below drops them),
    apply the SAME recenter translation as the fused export (D-B: identical vector, else the ADR-038 camera
    pose de-frames one derivative), and emit (object-name list, structured glb Path | None). Best-effort: any
    load/export quirk → ([], None), so neither the dropdown options nor the structured glb can fail an
    otherwise-good ingest. A single-mesh source (an STL) has no named objects → ([], None). Names are in MODEL
    order (deterministic per file), matching the whole f-2/f-4 chain."""
    try:
        scene = trimesh.load(input_path)
        geometry = getattr(scene, "geometry", None)  # a Scene has .geometry; a lone Trimesh (STL) does not
        if not geometry:
            return [], None
        names = list(geometry.keys())
        # f-3: name each object's material after the object, so the storefront live viewer can address it via
        # model-viewer `getMaterialByName(objectName)` (model-viewer recolors by MATERIAL — mesh→material is
        # not public API). A geometry with no material (e.g. vertex-colour visuals) is skipped → that part
        # simply won't recolour (graceful), never a crash.
        for name, geom in geometry.items():
            material = getattr(getattr(geom, "visual", None), "material", None)
            if material is not None:
                material.name = name
        scene.apply_translation(translation)  # the SAME vector as the fused export → the two stay aligned
        structured_path = Path(out_dir) / "model_structured.glb"
        structured_path.write_bytes(trimesh.exchange.gltf.export_glb(scene))
        return names, structured_path
    except Exception:  # noqa: BLE001 — the structured artifact is optional metadata; never fail the ingest over it
        return [], None


def ingest(input_path: str, out_dir: str) -> dict:
    # force='mesh' collapses a multi-part scene into one mesh so extents/export are well-defined.
    mesh = trimesh.load(input_path, force="mesh")
    if mesh.is_empty or mesh.vertices.shape[0] == 0:
        raise ValueError("model has no geometry")

    # Normalize: recenter the bounding-box center to the origin (the worker owns placement; the source may be
    # modelled anywhere). Deterministic and lossless — no scaling, so real-world mm dims survive. The SAME
    # translation is reused for the structured export (D-B) so both derivatives frame identically.
    translation = -mesh.bounding_box.centroid
    mesh.apply_translation(translation)

    w, d, h = (round(float(x), 3) for x in mesh.extents)  # bounding-box dims, model units (mm)

    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    glb_path = out / "model.glb"
    glb_path.write_bytes(trimesh.exchange.gltf.export_glb(trimesh.Scene(mesh)))

    # ponytail: a SECOND load (in structured_artifact) reads names + exports the structured glb — keeps THIS
    # fused path (what ADR-038's pose is curated against) byte-identical; dedupe to one load only if latency bites.
    names, structured_path = structured_artifact(input_path, translation, out_dir)

    manifest = {
        "dimsMm": [w, d, h],
        "glbPath": str(glb_path),
        "triangles": int(mesh.faces.shape[0]),
        "watertight": bool(mesh.is_watertight),
        "objectNames": names,  # f-2: named parts for the editor mapping (empty for STL)
    }
    if structured_path is not None:
        manifest["structuredGlbPath"] = str(structured_path)  # f-4: named-objects glb (omitted when none)
    return manifest


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
