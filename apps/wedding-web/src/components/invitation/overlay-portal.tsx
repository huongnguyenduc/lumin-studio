'use client';

import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

// Full-screen overlays (map lightbox, gallery lightbox) must render OUTSIDE the
// invitation's scaled canvas. `.invite-scale` (invitation-card.tsx) sets
// `zoom` ≈1.27 on desktop, and `zoom` multiplies every length its descendants
// resolve — including viewport units. A `position: fixed` lightbox sizing its
// image at `max-width: 92vw` therefore painted ~117% of the window: the map bled
// off both edges and, in browsers where `zoom` also scales fixed descendants,
// the close button and zoom controls landed past the screen edge with no way
// back out. Portalling into <body> puts overlays in a zoom-free coordinate
// space, so vw/vh mean what they say.
//
// Safe without a mounted-guard: overlays only ever render after a click, so this
// never runs during SSR/hydration (the `typeof document` check covers the
// server pass anyway).
export function OverlayPortal({ children }: { children: ReactNode }) {
  if (typeof document === 'undefined') return null;
  return createPortal(children, document.body);
}
