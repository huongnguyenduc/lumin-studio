'use client';

import { useEffect, useState } from 'react';

/** True when the OS asks for reduced motion — gates JS-driven animation loops (the global CSS rule
 *  can't stop a setInterval/rAF). Client-only; starts false so SSR/first paint match, then syncs after
 *  mount. Shared by SpriteTurntable (storefront card-hover + no-WebGL fallback, admin 360° preview). */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  return reduced;
}
