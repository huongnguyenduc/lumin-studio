'use client';

import { useEffect } from 'react';
import Lenis from 'lenis';

// Wheel-only inertia easing (mouse wheel steps are discrete/jerky; trackpad
// and touch already get native OS momentum, see below). Skipped under
// prefers-reduced-motion and on touch devices — syncTouch was tried twice
// for phones and reverted both times: full lerp dropped FPS, a tuned
// touchMultiplier instead made the page fly to the bottom on one swipe, both
// worse than iOS/Android's own compositor-driven momentum scroll.
//
// The raf loop only runs while Lenis reports active momentum (`isScrolling`)
// and is kicked off by a real wheel event — idle time (the vast majority of
// a page visit) costs nothing, unlike a permanently-running raf loop.
export function SmoothScroll() {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (window.matchMedia('(pointer: coarse)').matches) return;

    const lenis = new Lenis();
    let frame: number | null = null;

    function loop(time: number) {
      lenis.raf(time);
      frame = lenis.isScrolling ? requestAnimationFrame(loop) : null;
    }
    function onWheel() {
      if (frame === null) frame = requestAnimationFrame(loop);
    }
    window.addEventListener('wheel', onWheel, { passive: true });

    return () => {
      window.removeEventListener('wheel', onWheel);
      if (frame !== null) cancelAnimationFrame(frame);
      lenis.destroy();
    };
  }, []);

  return null;
}
