"""Blender-python turntable renderer — runs INSIDE headless Blender, spawned by render.py as
`blender -b -P _bl_render.py -- <input> <frames_dir> <frames> <tile_px>`. NOT the image's plain python3
(this uses `bpy`, only available inside Blender). Renders <frames> frames orbiting the model on the GTX
1060 and writes them as frames_dir/frame_0001.png … which render.py tiles into the WebP sprite sheet.

ADR-007 hard constraints (do not relitigate): Cycles + CUDA only (NO OptiX — Pascal has no RT cores; NO
EEVEE — dies headless), OpenImageDenoise on CPU (CC 6.1), decimate + modest samples + ≤1080p to fit 6GB
VRAM. concurrency=1 / off-peak is enforced by the worker, not here.

⚠️ BOX-GATED (o-1c): the GPU path (CUDA device enable, VRAM budget, camera framing, lighting, samples) can
only be validated on the WSL2 + GTX 1060 box (`blender -b --debug-cycles` must show the card). This is a
correct-by-construction first cut; the marked knobs are meant to be tuned on the box.
"""

import json
import math
import os
import sys
from pathlib import Path

import bpy
from mathutils import Vector

# f-5: the sibling pure-colour helper (sRGB→linear). Blender's `-P` runs this file without its own directory
# on sys.path, so add it before importing _color.
sys.path.insert(0, str(Path(__file__).parent))
from _color import hex_to_linear_rgb  # noqa: E402  (must follow the sys.path tweak)

# --- argv after `--` ---
argv = sys.argv[sys.argv.index("--") + 1:]
if len(argv) != 4:
    print("usage: _bl_render.py -- <input> <frames_dir> <frames> <tile_px>", file=sys.stderr)
    sys.exit(2)
input_path, frames_dir, frames, tile_px = argv[0], argv[1], int(argv[2]), int(argv[3])

# --- VRAM/quality knobs (ADR-007; tune on the box) ---
TRI_BUDGET = 200_000  # decimate above this to fit 6GB VRAM
SAMPLES = 64          # Cycles samples; OIDN denoise picks up the slack
ORBIT_ELEVATION = 0.35  # camera height as a fraction of the model's max dimension
ORBIT_DISTANCE = 2.2    # camera distance as a multiple of the model's max dimension


def die(msg: str) -> None:
    print(msg, file=sys.stderr)
    sys.exit(1)


# --- empty scene, then import the model by extension (Blender native importers) ---
bpy.ops.wm.read_factory_settings(use_empty=True)
ext = Path(input_path).suffix.lower()
try:
    if ext in (".glb", ".gltf"):
        bpy.ops.import_scene.gltf(filepath=input_path)
    elif ext == ".stl":
        bpy.ops.wm.stl_import(filepath=input_path)  # Blender 4.2 native STL importer
    elif ext == ".obj":
        bpy.ops.wm.obj_import(filepath=input_path)
    else:
        # ponytail: .3mf needs a Blender addon (not bundled) — reject for now (Permanent). Add the 3MF io
        # addon + a branch here if the shop starts uploading 3mf sources.
        die(f"unsupported model extension for render: {ext}")
except RuntimeError as e:
    die(f"import failed: {e}")

meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
if not meshes:
    die("no mesh in imported model")

# --- f-5: paint each named part in its frozen filament colour (LUMIN_PART_COLORS, set on this process by
# render.rs and inherited through render.py). Match Blender object name == the model_object_name the owner
# mapped (both derive from the source glb's node names). An unmapped part / absent-or-blank colour / duff hex
# leaves the object's baked material untouched — never grey. Base Color is LINEAR (hex_to_linear_rgb converts
# from the sRGB hex). A MALFORMED env JSON is a poison payload → let it raise → the job fails visibly (D-E:
# never ship a wrong-looking sprite); core-api only ever sets well-formed JSON. ---
part_colors = json.loads(os.environ.get("LUMIN_PART_COLORS", "{}") or "{}")
for o in meshes:
    # ingest.py keys the mapping off trimesh scene.geometry (the glb MESH names), so Blender's mesh-datablock
    # name (o.data.name) is the closest match; o.name (the glb NODE name) is the common-case fallback where a
    # node and its mesh share a name. A miss on both → the part keeps its baked material (never grey).
    hexv = part_colors.get(o.data.name) or part_colors.get(o.name)
    if not hexv:
        continue
    try:
        r, g, b = hex_to_linear_rgb(hexv)
    except ValueError:
        continue  # core-api validated the hex at enqueue (D-E) — skip a bad one rather than crash the render
    mat = bpy.data.materials.new(f"lumin_part_{o.name}")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf is not None:
        bsdf.inputs["Base Color"].default_value = (r, g, b, 1.0)
    o.data.materials.clear()
    o.data.materials.append(mat)

# --- decimate to a VRAM-safe triangle budget (ADR-007) ---
total_tris = sum(len(o.data.polygons) for o in meshes)
if total_tris > TRI_BUDGET:
    ratio = TRI_BUDGET / total_tris
    for o in meshes:
        mod = o.modifiers.new("sprite_decimate", "DECIMATE")
        mod.ratio = ratio

# --- world bounding box (recentered by model_ingest, but not assumed) → center + max dimension.
# 8 local bound_box corners per object, transformed to world space — cheap + importer-agnostic. ---
corners = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
xs = [c.x for c in corners]
ys = [c.y for c in corners]
zs = [c.z for c in corners]
center = ((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, (min(zs) + max(zs)) / 2)
max_dim = max(max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs), 1e-4)
radius = max_dim * ORBIT_DISTANCE
height = center[2] + max_dim * ORBIT_ELEVATION

# --- target empty at center + a camera that Track-To's it (so moving the camera keeps it aimed) ---
target = bpy.data.objects.new("sprite_target", None)
target.location = center
bpy.context.scene.collection.objects.link(target)

cam_data = bpy.data.cameras.new("sprite_cam")
cam = bpy.data.objects.new("sprite_cam", cam_data)
bpy.context.scene.collection.objects.link(cam)
bpy.context.scene.camera = cam
track = cam.constraints.new("TRACK_TO")
track.target = target
track.track_axis = "TRACK_NEGATIVE_Z"
track.up_axis = "UP_Y"

# --- lighting: a key sun + a neutral world so the product is lit but the film stays transparent ---
world = bpy.data.worlds.new("sprite_world")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.9, 0.9, 0.9, 1.0)
world.node_tree.nodes["Background"].inputs[1].default_value = 0.4  # soft ambient
bpy.context.scene.world = world
sun_data = bpy.data.lights.new("sprite_sun", "SUN")
sun_data.energy = 3.0
sun = bpy.data.objects.new("sprite_sun", sun_data)
sun.rotation_euler = (math.radians(55), 0.0, math.radians(30))
bpy.context.scene.collection.objects.link(sun)

# --- Cycles + CUDA (ADR-007: NO OptiX/EEVEE), OIDN on CPU, transparent film, square tile ---
scene = bpy.context.scene
scene.render.engine = "CYCLES"
prefs = bpy.context.preferences.addons["cycles"].preferences
prefs.compute_device_type = "CUDA"
prefs.refresh_devices()
cuda_on = 0
for dev in prefs.devices:
    dev.use = dev.type == "CUDA"
    cuda_on += 1 if dev.type == "CUDA" else 0
# Surface the device state to stderr — the on-box o-1c gate reads this to confirm the GTX 1060 is seen.
print(f"cycles CUDA devices enabled: {cuda_on}", file=sys.stderr)
scene.cycles.device = "GPU"
scene.cycles.samples = SAMPLES
scene.cycles.use_denoising = True
scene.cycles.denoiser = "OPENIMAGEDENOISE"  # CPU denoise (Pascal CC 6.1, ADR-007)
scene.cycles.denoising_use_gpu = False
scene.render.film_transparent = True
scene.render.resolution_x = tile_px
scene.render.resolution_y = tile_px
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"

# --- ADR-038 follow-up: LUMIN_CAMERA_THETA (degrees, set on this process by render.rs) is the
# owner-saved live-viewer azimuth — frame 0 starts there instead of always at 0, so the sprite opens
# facing the same way the owner aligned the interactive viewer. Absent/blank/malformed → 0 (today's
# behaviour, unchanged); never fails the render over a cosmetic starting angle. ---
try:
    camera_theta_deg = float(os.environ.get("LUMIN_CAMERA_THETA", "") or 0.0)
except ValueError:
    camera_theta_deg = 0.0
camera_theta_offset = math.radians(camera_theta_deg)

# --- render each orbit frame → frames_dir/frame_####.png (1-indexed, matches render.py's tiler) ---
out = Path(frames_dir)
out.mkdir(parents=True, exist_ok=True)
for i in range(frames):
    ang = camera_theta_offset + 2 * math.pi * i / frames
    cam.location = (center[0] + radius * math.sin(ang), center[1] - radius * math.cos(ang), height)
    scene.render.filepath = str(out / f"frame_{i + 1:04d}")  # Blender appends .png
    bpy.ops.render.render(write_still=True)
