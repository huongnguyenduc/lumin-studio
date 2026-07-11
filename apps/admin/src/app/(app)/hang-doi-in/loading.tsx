import { useTranslations } from 'next-intl';

/** Print-board loading skeleton (conventions §State) — a title bar + four column shells each with a
 *  couple of card placeholders, matching the board's grid so the layout doesn't jump on hydration.
 *  animate-pulse is stilled by reduced-motion. */
export default function Loading() {
  const t = useTranslations('states');

  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-4">
      <span className="sr-only">{t('loading')}</span>
      <div className="h-9 w-48 animate-pulse rounded-lg bg-surface-sunken" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {['a', 'b', 'c', 'd'].map((col) => (
          <div
            key={col}
            className="flex min-h-[340px] flex-col gap-2 rounded-xl border-[1.5px] border-border-subtle bg-surface-sunken p-3"
          >
            <div className="h-5 w-24 animate-pulse rounded bg-surface-card" />
            {['x', 'y'].map((c) => (
              <div key={c} className="h-20 w-full animate-pulse rounded-xl bg-surface-card" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
