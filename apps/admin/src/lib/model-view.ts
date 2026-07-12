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
