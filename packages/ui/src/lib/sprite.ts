// 360° sprite-sheet grid (ADR-049): the render worker tiles a fixed 24-frame 6-column sheet. Changing
// them means re-rendering existing products — keep in lockstep with the worker's sprite_render config.
export const SPRITE_FRAMES = 24;
export const SPRITE_COLS = 6;
export const SPRITE_ROWS = Math.ceil(SPRITE_FRAMES / SPRITE_COLS); // 4

/**
 * The CSS background-position for one frame of the sprite-sheet grid (ADR-049). With the element sized to
 * one tile and `background-size: (SPRITE_COLS*100)% (SPRITE_ROWS*100)%`, percentage positioning lands frame
 * `n` exactly on its tile: column `n % COLS` at `col/(COLS-1)*100%`, row `floor(n / COLS)` at
 * `row/(ROWS-1)*100%`. `frame` is clamped into range so a bad index never scrolls off the sheet. Pure →
 * unit-tested; SpriteTurntable steps `frame` over time (respecting prefers-reduced-motion).
 */
export function spriteFrameCss(frame: number): {
  backgroundPositionX: string;
  backgroundPositionY: string;
} {
  const n = Math.max(0, Math.min(Math.trunc(frame), SPRITE_FRAMES - 1));
  const col = n % SPRITE_COLS;
  const row = Math.floor(n / SPRITE_COLS);
  const x = SPRITE_COLS > 1 ? (col / (SPRITE_COLS - 1)) * 100 : 0;
  const y = SPRITE_ROWS > 1 ? (row / (SPRITE_ROWS - 1)) * 100 : 0;
  return { backgroundPositionX: `${x}%`, backgroundPositionY: `${y}%` };
}
