'use client';

import { useTranslations } from 'next-intl';

/** Route-level error boundary (conventions §State: error has a retry). Must be a client component. */
export default function ErrorBoundary({ reset }: { reset: () => void }) {
  const t = useTranslations('states');

  return (
    <div
      role="alert"
      className="mx-auto flex w-full max-w-[1200px] flex-col items-center gap-4 px-4 py-20 text-center md:px-6"
    >
      <h1 className="text-2xl">{t('errorTitle')}</h1>
      <p className="text-text-muted">{t('errorBody')}</p>
      <button
        type="button"
        onClick={reset}
        className="inline-flex items-center rounded-pill border-2 border-border-strong bg-primary px-6 py-3 font-display font-bold text-on-primary transition-colors hover:bg-primary-press focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky focus-visible:ring-offset-2"
      >
        {t('retry')}
      </button>
    </div>
  );
}
