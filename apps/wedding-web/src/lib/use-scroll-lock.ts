'use client';

import { useEffect } from 'react';

// Locks the page body while a dialog/drawer is open, so wheel/touch scroll
// gestures always land on the dialog's own scroll container instead of
// chaining to the page underneath once the dialog content hits its own
// top/bottom edge (the classic "can only scroll the page, not the drawer"
// bug). Restores whatever inline `overflow` the body had before.
export function useScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const { style } = document.body;
    const prev = style.overflow;
    style.overflow = 'hidden';
    return () => {
      style.overflow = prev;
    };
  }, [active]);
}
