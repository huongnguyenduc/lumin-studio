import type { components } from '@lumin/api-client';

type Model3dView = components['schemas']['Model3dView'];

// A product edit page can render more than one <model-viewer> section at once (align-view, part-object
// picker, engrave-anchor picker) — each used to run its own `import('@google/model-viewer')`. The
// package registers the custom element via `customElements.define('model-viewer', ...)` as a load-time
// side effect, which throws NotSupportedError on a second registration; in Next.js dev (Fast Refresh
// re-runs module init) that throw lands in each call site's own `.catch()` and silently flips it to a
// "failed to load" state — the model just doesn't render, with no visible reason why. One shared,
// already-registered check fixes it for every call site at once instead of guarding three separately.
let modelViewerLoad: Promise<void> | null = null;
export function loadModelViewer(): Promise<void> {
  if (typeof customElements !== 'undefined' && customElements.get('model-viewer')) {
    return Promise.resolve();
  }
  if (!modelViewerLoad) {
    modelViewerLoad = import('@google/model-viewer')
      .then(() => undefined)
      .catch((err) => {
        modelViewerLoad = null; // let a real failure (bad chunk/network) be retried, not cached forever
        throw err;
      });
  }
  return modelViewerLoad;
}

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
 * positions and `el.materialFromPoint` bound as `materialAt`. model-viewer's *FromPoint hit-tests take
 * CLIENT (page) pixel coordinates — its getNDC subtracts the element rect itself, so passing
 * element-local pixels double-subtracts and every pick misses (verified live on prod, 2026-07-19).
 *
 * Ignores a DRAG (an orbit, not a pick — pointer moved > `slop` px between down and up) and an empty/absent
 * material name (a gap in the model, or a fused glb whose one material is unnamed). The material name IS the
 * object name because model_ingest names each object's material after it (f-3), so `getMaterialByName` /
 * `materialFromPoint` both key on it.
 */
export function pickedObjectName(
  down: { x: number; y: number } | null,
  up: { x: number; y: number },
  materialAt: (clientX: number, clientY: number) => { name: string } | null,
  slop = 6,
): string | null {
  if (!down) return null;
  if (Math.hypot(up.x - down.x, up.y - down.y) > slop) return null; // a drag/orbit, not a pick
  const name = materialAt(up.x, up.y)?.name.trim();
  return name ? name : null;
}

type EngraveAnchor = components['schemas']['EngraveAnchor'];

/**
 * Decide what a tap on the engrave-anchor picker maps to: the EngraveAnchor to save, or null to ignore.
 * Pure (testable without WebGL) — the component binds `el.positionAndNormalFromPoint` as `surfaceAt`,
 * fed CLIENT (page) pixel coordinates (same contract as `materialAt` above).
 * Ignores a DRAG (an orbit, same slop rule as pickedObjectName) and a miss (tap on empty space). The
 * position is clamped to the contract envelope ([-100, 100] m) and the normal renormalised to unit
 * length (BE requires each component in [-1, 1] and a non-zero vector); a degenerate zero normal → null.
 */
export function pickedAnchor(
  down: { x: number; y: number } | null,
  up: { x: number; y: number },
  surfaceAt: (
    clientX: number,
    clientY: number,
  ) => {
    position: { x: number; y: number; z: number };
    normal: { x: number; y: number; z: number };
  } | null,
  slop = 6,
): EngraveAnchor | null {
  if (!down) return null;
  if (Math.hypot(up.x - down.x, up.y - down.y) > slop) return null; // a drag/orbit, not a pick
  const hit = surfaceAt(up.x, up.y);
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
