'use client';

import { useEffect, useRef } from 'react';

// Minimal modal-dialog focus management for our two `aria-modal` overlays (the
// settings drawer and the map lightbox): when the dialog opens, move focus
// inside it; trap Tab within it while open; restore focus to whatever was
// focused before (the trigger) on close. Escape-to-close is wired separately by
// each dialog. Attach the returned ref to the dialog container and give that
// container `tabIndex={-1}` so it can hold focus when it has no focusable child.
export function useDialogFocus<T extends HTMLElement>(active: boolean) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!active) return;
    const node = ref.current;
    if (!node) return;
    const restoreTo = document.activeElement as HTMLElement | null;

    const focusables = () =>
      Array.from(
        node.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.getClientRects().length > 0);

    (focusables()[0] ?? node).focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) {
        e.preventDefault();
        node.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const current = document.activeElement;
      if (!node.contains(current)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && current === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && current === last) {
        e.preventDefault();
        first.focus();
      }
    };

    node.addEventListener('keydown', onKey);
    return () => {
      node.removeEventListener('keydown', onKey);
      // Only pull focus back if it's still inside the (now closing) dialog —
      // otherwise a click elsewhere already placed it where the user wants.
      if (!restoreTo) return;
      if (document.activeElement === document.body || node.contains(document.activeElement)) {
        restoreTo.focus?.();
      }
    };
  }, [active]);
  return ref;
}
