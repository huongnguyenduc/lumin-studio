'use client';

import { useEffect } from 'react';

// Warns before the tab closes/reloads/navigates away while a form has unsaved
// edits (browser's native confirm — same mechanism used for bulk-delete
// confirms elsewhere in admin, no custom modal needed).
export function useUnsavedGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);
}
