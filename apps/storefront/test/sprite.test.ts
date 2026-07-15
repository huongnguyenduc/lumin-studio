import { describe, it, expect } from 'vitest';
import { SPRITE_COLS, SPRITE_FRAMES, SPRITE_ROWS, spriteFrameCss } from '../src/lib/product-view';

// The pure sprite-sheet frame math (ADR-049). The grid is a fixed shared constant with the render worker
// (pysrc/render.py) — these pin the layout the storefront turntable assumes, and the background-position
// math the SpriteTurntable component steps over. The component's timer/reduced-motion is UI, not tested here.
describe('sprite sheet grid (ADR-049)', () => {
  it('has a grid big enough for every frame', () => {
    expect(SPRITE_COLS * SPRITE_ROWS).toBeGreaterThanOrEqual(SPRITE_FRAMES);
    expect(SPRITE_ROWS).toBe(Math.ceil(SPRITE_FRAMES / SPRITE_COLS));
  });

  it('maps frame 0 to the top-left tile', () => {
    expect(spriteFrameCss(0)).toEqual({ backgroundPositionX: '0%', backgroundPositionY: '0%' });
  });

  it('walks the first row across, then wraps to the next row', () => {
    // last column of row 0 → right edge, top row
    expect(spriteFrameCss(SPRITE_COLS - 1)).toEqual({
      backgroundPositionX: '100%',
      backgroundPositionY: '0%',
    });
    // first column of row 1 → left edge, one row down
    expect(spriteFrameCss(SPRITE_COLS)).toEqual({
      backgroundPositionX: '0%',
      backgroundPositionY: `${(1 / (SPRITE_ROWS - 1)) * 100}%`,
    });
  });

  it('maps the last frame to the bottom-right tile', () => {
    expect(spriteFrameCss(SPRITE_FRAMES - 1)).toEqual({
      backgroundPositionX: '100%',
      backgroundPositionY: '100%',
    });
  });

  it('clamps out-of-range and truncates fractional indices into the sheet', () => {
    expect(spriteFrameCss(-5)).toEqual(spriteFrameCss(0));
    expect(spriteFrameCss(9999)).toEqual(spriteFrameCss(SPRITE_FRAMES - 1));
    expect(spriteFrameCss(2.9)).toEqual(spriteFrameCss(2));
  });
});
