import { describe, expect, it } from 'vitest';
import { orbitToModel3dView, model3dViewToAttrs, pickedObjectName } from '../src/lib/model-view';

const HALF_PI = Math.PI / 2;
const QUARTER_PI = Math.PI / 4;

describe('orbitToModel3dView', () => {
  it('converts radians→degrees and metres→percent against the captured ideal', () => {
    const v = orbitToModel3dView(
      { theta: QUARTER_PI, phi: HALF_PI, radius: 1.5 },
      { x: 0.1, y: -0.2, z: 0.3 },
      1, // ideal radius = 1m → 1.5m is 150%
    );
    expect(v.orbitTheta).toBeCloseTo(45, 3);
    expect(v.orbitPhi).toBeCloseTo(90, 3);
    expect(v.orbitRadius).toBeCloseTo(150, 3);
    expect(v.targetX).toBeCloseTo(0.1, 4);
    expect(v.targetY).toBeCloseTo(-0.2, 4);
    expect(v.targetZ).toBeCloseTo(0.3, 4);
  });

  it('normalizes azimuth into [-180, 180] (270° → -90°)', () => {
    const v = orbitToModel3dView(
      { theta: 1.5 * Math.PI, phi: 0, radius: 1 },
      { x: 0, y: 0, z: 0 },
      1,
    );
    expect(v.orbitTheta).toBeCloseTo(-90, 3);
  });

  it('clamps radius to (0, 1000] and target to [-100, 100]', () => {
    const v = orbitToModel3dView(
      { theta: 0, phi: HALF_PI, radius: 50 },
      { x: 200, y: -200, z: 0 },
      1, // 50m / 1m = 5000% → clamp 1000
    );
    expect(v.orbitRadius).toBe(1000);
    expect(v.targetX).toBe(100);
    expect(v.targetY).toBe(-100);
  });

  it('falls back to 105% when the ideal radius was not captured (0)', () => {
    const v = orbitToModel3dView({ theta: 0, phi: HALF_PI, radius: 2 }, { x: 0, y: 0, z: 0 }, 0);
    expect(v.orbitRadius).toBe(105);
  });
});

describe('model3dViewToAttrs', () => {
  it('builds the camera-orbit and camera-target attribute strings', () => {
    const attrs = model3dViewToAttrs({
      orbitTheta: 45,
      orbitPhi: 90,
      orbitRadius: 105,
      targetX: 0,
      targetY: 0,
      targetZ: 0,
    });
    expect(attrs.orbit).toBe('45deg 90deg 105%');
    expect(attrs.target).toBe('0m 0m 0m');
  });
});

describe('pickedObjectName (f-2 click-on-model)', () => {
  const rect = { left: 100, top: 50 };
  const hit = (name: string) => () => ({ name });

  it('returns the material name for a click (no pointer movement)', () => {
    const at = hit('Chao đèn');
    expect(pickedObjectName({ x: 130, y: 90 }, { x: 130, y: 90 }, rect, at)).toBe('Chao đèn');
  });

  it('passes viewer-local coordinates (up minus rect) to the hit-test', () => {
    let seen: [number, number] | null = null;
    pickedObjectName({ x: 130, y: 90 }, { x: 130, y: 90 }, rect, (x, y) => {
      seen = [x, y];
      return { name: 'Đế' };
    });
    expect(seen).toEqual([30, 40]); // 130-100, 90-50
  });

  it('ignores a drag (an orbit, moved past the slop) — returns null', () => {
    const at = hit('Chao đèn');
    expect(pickedObjectName({ x: 130, y: 90 }, { x: 150, y: 90 }, rect, at)).toBeNull(); // 20px > 6
  });

  it('allows a tiny jitter within the slop', () => {
    const at = hit('Đế');
    expect(pickedObjectName({ x: 130, y: 90 }, { x: 134, y: 92 }, rect, at)).toBe('Đế'); // ~4.5px < 6
  });

  it('returns null when the click misses geometry (no material)', () => {
    expect(pickedObjectName({ x: 130, y: 90 }, { x: 130, y: 90 }, rect, () => null)).toBeNull();
  });

  it('returns null for an empty / whitespace material name (fused or unnamed)', () => {
    expect(pickedObjectName({ x: 1, y: 1 }, { x: 1, y: 1 }, rect, hit('   '))).toBeNull();
  });

  it('returns null when no pointerdown was captured', () => {
    expect(pickedObjectName(null, { x: 130, y: 90 }, rect, hit('Chao đèn'))).toBeNull();
  });
});
