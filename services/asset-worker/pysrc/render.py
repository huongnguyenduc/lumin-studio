#!/usr/bin/env python3
"""sprite_render step — render a 360° turntable sprite sheet from a source model (ADR-007 / ADR-049).

Run as a SUBPROCESS by the Rust worker (src/render.rs), NOT imported — same crash-isolation contract as
ingest.py. It is the GPU half of the asset pipeline: it drives headless Blender (Cycles + CUDA on the
GTX 1060) to render N frames around the model, then tiles them into ONE WebP sprite sheet the storefront
uses for the card-hover turntable + the model-viewer no-WebGL fallback.

Two subprocess layers, on purpose: THIS orchestrator runs on the image's plain python3 (which has Pillow)
and shells out to `blender -b -P _bl_render.py` for the actual GPU render (Blender's bundled python has no
Pillow, and bpy must run inside Blender). Keeping render.rs symmetric with ingest.rs — one
`python <script> <input> <out_dir>` call, one JSON manifest — is why the blender+tile orchestration lives
here, not in Rust.

Contract with the Rust wrapper (src/render.rs):
  argv: <input-model-path> <output-dir>
  stdout: ONE line of JSON — {"spritePath":"...", "frames":N, "cols":C}
  exit 0 + that manifest on success; exit non-zero + a stderr reason on failure (a bad/unsupported model
  OR a Blender/GPU failure — the wrapper classifies non-zero as permanent; see render.rs for the ceiling).

The grid is a FIXED shared constant (ADR-049) — the storefront tiler assumes the same FRAMES/COLS, so the
URL alone is a complete contract (no metadata column). Changing it means re-rendering existing products.
"""

import json
import os
import subprocess
import sys
from pathlib import Path

from PIL import Image

# Fixed sprite grid — MUST stay in sync with the storefront tiler (apps/storefront sprite constants).
FRAMES = 24
COLS = 6
TILE_PX = 320  # per-frame square px; sheet = COLS*TILE_PX wide × ceil(FRAMES/COLS)*TILE_PX tall
# ponytail: TILE_PX/FRAMES/COLS are the calibration knobs — a card-hover thumbnail wants small, the
# no-WebGL viewer fallback wants big; 320²×24 is the middle default. Tune on the box (render time ∝ FRAMES).


def render(input_path: str, out_dir: str) -> dict:
    out = Path(out_dir)
    frames_dir = out / "frames"
    frames_dir.mkdir(parents=True, exist_ok=True)

    # 1) GPU render: N frames around the model → frames_dir/frame_0001.png … (Blender subprocess).
    bl_script = Path(__file__).with_name("_bl_render.py")
    blender = os.environ.get("BLENDER_BIN", "blender")  # on PATH in the baked image
    proc = subprocess.run(
        [
            blender, "-b", "--factory-startup", "-noaudio",
            "-P", str(bl_script), "--",
            input_path, str(frames_dir), str(FRAMES), str(TILE_PX),
        ],
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        # Surface Blender's tail — the worker reports this as the failure reason (capped there).
        raise RuntimeError(f"blender exited {proc.returncode}: {proc.stderr.strip()[-800:]}")

    # 2) Tile the frames into ONE transparent WebP sprite sheet (Pillow — CPU, this interpreter).
    rows = (FRAMES + COLS - 1) // COLS
    sheet = Image.new("RGBA", (COLS * TILE_PX, rows * TILE_PX), (0, 0, 0, 0))
    for i in range(FRAMES):
        frame_path = frames_dir / f"frame_{i + 1:04d}.png"
        if not frame_path.exists():
            raise RuntimeError(f"missing rendered frame {frame_path.name}")
        img = Image.open(frame_path).convert("RGBA")
        if img.size != (TILE_PX, TILE_PX):
            img = img.resize((TILE_PX, TILE_PX), Image.LANCZOS)
        sheet.paste(img, ((i % COLS) * TILE_PX, (i // COLS) * TILE_PX))

    sprite_path = out / "sprite.webp"
    sheet.save(sprite_path, "WEBP", quality=82, method=6)
    return {"spritePath": str(sprite_path), "frames": FRAMES, "cols": COLS}


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: render.py <input-model-path> <output-dir>", file=sys.stderr)
        return 2
    try:
        manifest = render(sys.argv[1], sys.argv[2])
    except Exception as e:  # noqa: BLE001 — any render/tile failure is a reportable error
        print(f"render failed: {e}", file=sys.stderr)
        return 1
    print(json.dumps(manifest))
    return 0


if __name__ == "__main__":
    sys.exit(main())
