'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
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
//
// Mounted once in the root layout (shared by every route), but Lenis installs
// a WINDOW-level wheel listener that takes over scrolling unconditionally —
// nested scrollables (the admin settings drawer) never got a chance to scroll
// themselves, because Lenis always drove the page's scroll first. This is the
// landing-page inertia feel for the public invitation; `/admin` is a plain
// dashboard with real nested scroll regions and never wanted it.
export function SmoothScroll() {
  const pathname = usePathname();
  useEffect(() => {
    if (pathname.startsWith('/admin')) return;
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
  }, [pathname]);

  return null;
}
