'use client';

import { useTranslations } from 'next-intl';
import { RefreshIcon } from '@/components/icons';

/** Route-level error boundary (conventions §State: error has a retry), on the hi-fi 11 card: white
 *  card, cocoa border, dashed-circle glyph, and an OUTLINE "↻ Thử lại". Must be a client component. */
export default function ErrorBoundary({ reset }: { reset: () => void }) {
  const t = useTranslations('states');

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-16 md:px-6">
      <div
        role="alert"
        className="mx-auto flex max-w-sm flex-col items-center gap-3 rounded-lg border-2 border-border-strong bg-surface-card p-10 text-center shadow-pop-sm"
      >
        <span
          aria-hidden="true"
          className="flex h-20 w-20 items-center justify-center rounded-full border-2 border-dashed border-border-default bg-surface-sunken text-text-subtle"
        >
          <RefreshIcon className="h-9 w-9" />
        </span>
        <h1 className="font-display text-lg font-bold text-text-strong">{t('errorTitle')}</h1>
        <p className="text-sm text-text-muted">{t('errorBody')}</p>
        <button
          type="button"
          onClick={reset}
          className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-pill border-2 border-border-strong bg-surface-card px-6 font-display text-sm font-semibold text-text-strong transition-colors hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky focus-visible:ring-offset-2"
        >
          <RefreshIcon className="h-4 w-4" aria-hidden="true" />
          {t('retry')}
        </button>
      </div>
    </div>
  );
}
