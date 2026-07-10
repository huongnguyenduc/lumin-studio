'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@lumin/ui';

/** Route-level error boundary (conventions §State: error has a retry). Must be a client component. */
export default function ErrorBoundary({ reset }: { reset: () => void }) {
  const t = useTranslations('states');

  return (
    <div role="alert" className="flex flex-col items-center gap-4 py-20 text-center">
      <h1 className="text-2xl">{t('errorTitle')}</h1>
      <p className="text-text-muted">{t('errorBody')}</p>
      {/* The @lumin/ui Button primitive (md = h-11 = 44px, AA-vetted primary tokens) instead of a
          hand-rolled pill, so the retry control can't drift from the design system. */}
      <Button onClick={reset}>{t('retry')}</Button>
    </div>
  );
}
