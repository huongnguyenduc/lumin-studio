'use client';

import { useEffect } from 'react';
import { track } from '@/lib/analytics';

// Fires pettag_scanned once when a live pet page renders (spec §10 analytics). The page is a Server
// Component, so this tiny client child is how the browser-side umami.track runs. state = encoded (chip
// written, not yet claimed) · home (activated, not lost) · lost (activated, lost mode on). Consent-gated
// for free: window.umami is undefined until the visitor opts in (components/consent-banner.tsx). Renders
// nothing.
export function TrackScan({ state }: { state: 'encoded' | 'home' | 'lost' }) {
  useEffect(() => {
    track('pettag_scanned', { state });
  }, [state]);
  return null;
}
