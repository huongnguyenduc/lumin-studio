import type { components } from '@lumin/api-client';

type Model3dView = components['schemas']['Model3dView'];

// model-viewer's getCameraOrbit() returns theta/phi in RADIANS and radius in METRES, while the ADR-038
// Model3dView (and the <model-viewer> camera-orbit attribute) uses degrees + percent-of-ideal, and
// camera-target uses metres. These pure helpers convert both ways and clamp to the contract ranges — a
// client mirror so a wild drag can't build a body the BE rejects; the BE re-validates regardless.

const DEG_PER_RAD = 180 / Math.PI;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const round = (n: number) => Math.round(n * 1e4) / 1e4; // trim float noise; ample for a camera pose

/** Fold an azimuth (degrees) into [-180, 180] — the same orbit, safely within the contract's [-360, 360]. */
function normalizeTheta(deg: number): number {
  return (((deg % 360) + 540) % 360) - 180;
}

/**
 * Convert a live model-viewer camera (orbit in radians+metres, target in metres) to a Model3dView, using
 * the ideal (100%) radius captured at load to express distance as a percent. Every field is clamped to its
 * ADR-038 range. A non-positive idealRadius (not captured yet) falls back to model-viewer's 105% default.
 */
export function orbitToModel3dView(
  orbit: { theta: number; phi: number; radius: number },
  target: { x: number; y: number; z: number },
  idealRadius: number,
): Model3dView {
  const radiusPct = idealRadius > 0 ? (orbit.radius / idealRadius) * 100 : 105;
  return {
    orbitTheta: round(normalizeTheta(orbit.theta * DEG_PER_RAD)),
    orbitPhi: round(clamp(orbit.phi * DEG_PER_RAD, 0, 180)),
    orbitRadius: round(clamp(radiusPct, 1, 1000)), // (0, 1000]; floor at 1 to stay strictly > 0
    targetX: round(clamp(target.x, -100, 100)),
    targetY: round(clamp(target.y, -100, 100)),
    targetZ: round(clamp(target.z, -100, 100)),
  };
}

/** Build the <model-viewer> camera-orbit / camera-target attribute strings from a saved pose. */
export function model3dViewToAttrs(v: Model3dView): { orbit: string; target: string } {
  return {
    orbit: `${v.orbitTheta}deg ${v.orbitPhi}deg ${v.orbitRadius}%`,
    target: `${v.targetX}m ${v.targetY}m ${v.targetZ}m`,
  };
}

/**
 * Decide what a click on the 3D part-picker (f-2 click-on-model) maps to: the object name to assign, or null
 * to ignore. Pure so it's testable without a WebGL/DOM viewer — the component feeds it the real pointer
 * positions, the viewer's bounding rect, and `el.materialFromPoint` bound as `materialAt`.
 *
 * Ignores a DRAG (an orbit, not a pick — pointer moved > `slop` px between down and up) and an empty/absent
 * material name (a gap in the model, or a fused glb whose one material is unnamed). The material name IS the
 * object name because model_ingest names each object's material after it (f-3), so `getMaterialByName` /
 * `materialFromPoint` both key on it.
 */
export function pickedObjectName(
  down: { x: number; y: number } | null,
  up: { x: number; y: number },
  rect: { left: number; top: number },
  materialAt: (localX: number, localY: number) => { name: string } | null,
  slop = 6,
): string | null {
  if (!down) return null;
  if (Math.hypot(up.x - down.x, up.y - down.y) > slop) return null; // a drag/orbit, not a pick
  const name = materialAt(up.x - rect.left, up.y - rect.top)?.name.trim();
  return name ? name : null;
}

type EngraveAnchor = components['schemas']['EngraveAnchor'];

/**
 * Decide what a tap on the engrave-anchor picker maps to: the EngraveAnchor to save, or null to ignore.
 * Pure (testable without WebGL) — the component binds `el.positionAndNormalFromPoint` as `surfaceAt`.
 * Ignores a DRAG (an orbit, same slop rule as pickedObjectName) and a miss (tap on empty space). The
 * position is clamped to the contract envelope ([-100, 100] m) and the normal renormalised to unit
 * length (BE requires each component in [-1, 1] and a non-zero vector); a degenerate zero normal → null.
 */
export function pickedAnchor(
  down: { x: number; y: number } | null,
  up: { x: number; y: number },
  rect: { left: number; top: number },
  surfaceAt: (
    localX: number,
    localY: number,
  ) => { position: { x: number; y: number; z: number }; normal: { x: number; y: number; z: number } } | null,
  slop = 6,
): EngraveAnchor | null {
  if (!down) return null;
  if (Math.hypot(up.x - down.x, up.y - down.y) > slop) return null; // a drag/orbit, not a pick
  const hit = surfaceAt(up.x - rect.left, up.y - rect.top);
  if (!hit) return null;
  const len = Math.hypot(hit.normal.x, hit.normal.y, hit.normal.z);
  if (!Number.isFinite(len) || len === 0) return null;
  const pos = (n: number) => round(clamp(n, -100, 100));
  const norm = (n: number) => round(clamp(n / len, -1, 1));
  return {
    posX: pos(hit.position.x),
    posY: pos(hit.position.y),
    posZ: pos(hit.position.z),
    normX: norm(hit.normal.x),
    normY: norm(hit.normal.y),
    normZ: norm(hit.normal.z),
  };
}
