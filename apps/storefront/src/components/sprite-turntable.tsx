'use client';

import { useEffect, useState } from 'react';
import { SPRITE_COLS, SPRITE_FRAMES, SPRITE_ROWS, spriteFrameCss } from '@/lib/product-view';
import { usePrefersReducedMotion } from '@/lib/use-prefers-reduced-motion';

// Per-frame dwell for the turntable cycle. 65ms × 46 ping-pong steps ≈ 3s — one full gentle
// there-and-back that lands on frame 0 right as CardCover's 3s play window hands back to the photo.
// ponytail: tuned blind — the feel needs real sprites on the box; calibration knob.
const FRAME_MS = 65;

/**
 * The 360° sprite-sheet turntable (ADR-049 / ADR-007 "lắc trái-phải"). Renders one frame of the sheet as a
 * background and, while `active`, ping-pongs through the frames (0→N-1→0) — a rock left-right preview.
 * prefers-reduced-motion (or `active=false`) pins it to frame 0: no autonomous motion (a11y rule). The pure
 * frame math lives in product-view.spriteFrameCss; this only owns the timer + the reduced-motion gate.
 *
 * Used two ways: the catalog card drives `active` from hover; the model-viewer no-WebGL fallback passes
 * `active` steadily so the product turns on its own (still stilled under reduced-motion).
 */
export function SpriteTurntable({
  src,
  alt,
  active,
  className,
}: {
  src: string;
  alt: string;
  active: boolean;
  className?: string;
}) {
  const reduced = usePrefersReducedMotion();
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (!active || reduced) {
      setFrame(0); // idle / reduced-motion → the static first frame, no timer
      return;
    }
    let i = 0;
    let dir = 1;
    const id = setInterval(() => {
      i += dir;
      if (i >= SPRITE_FRAMES - 1) dir = -1;
      else if (i <= 0) dir = 1;
      setFrame(i);
    }, FRAME_MS);
    return () => clearInterval(id);
  }, [active, reduced]);

  return (
    <div
      role="img"
      aria-label={alt}
      // While idle the sprite sits invisible (opacity-0) on top of the real photo, which has its own
      // alt — hide it from AT then so a screen reader hears ONE image per tile, not two.
      aria-hidden={!active}
      className={className}
      style={{
        backgroundImage: `url("${src}")`,
        backgroundRepeat: 'no-repeat',
        backgroundSize: `${SPRITE_COLS * 100}% ${SPRITE_ROWS * 100}%`,
        ...spriteFrameCss(frame),
      }}
    />
  );
}
