'use client';

import { useEffect } from 'react';

// Fire-and-forget open tracking (write-once server-side). A client POST after
// mount instead of a GET side-effect, so link-preview bots (Zalo/Messenger
// fetch the URL server-side) never fake an open. Renders nothing, never blocks.
export function MarkOpened({ slug }: { slug: string }) {
  useEffect(() => {
    void fetch(`/api/invite/${encodeURIComponent(slug)}/opened`, { method: 'POST' }).catch(
      () => undefined,
    );
  }, [slug]);
  return null;
}
