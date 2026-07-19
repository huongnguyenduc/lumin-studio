'use client';

import { useEffect } from 'react';
import Lenis from 'lenis';

// Inertia scroll (Lenis) — skipped under prefers-reduced-motion (less motion
// requested) and on touch devices. Tried syncTouch (full and tuned) to make
// iOS Safari match desktop wheel-scroll feel: full lerp dropped FPS, a tuned
// touchMultiplier instead made the page fly to the bottom on one swipe —
// both worse than doing nothing. iOS's own compositor-driven momentum
// scroll is already smooth; leave it alone.
export function SmoothScroll() {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (window.matchMedia('(pointer: coarse)').matches) return;

    const lenis = new Lenis();
    let frame: number;
    function raf(time: number) {
      lenis.raf(time);
      frame = requestAnimationFrame(raf);
    }
    frame = requestAnimationFrame(raf);

    return () => {
      cancelAnimationFrame(frame);
      lenis.destroy();
    };
  }, []);

  return null;
}
