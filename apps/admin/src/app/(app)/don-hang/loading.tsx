import { useTranslations } from 'next-intl';

/** Orders-list loading skeleton (conventions §State) — a header bar + filter + a stack of rows,
 *  shaped for this route so it doesn't inherit the dashboard's stat-card skeleton. animate-pulse is
 *  stilled by reduced-motion. */
export default function Loading() {
  const t = useTranslations('states');

  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-6">
      <span className="sr-only">{t('loading')}</span>
      <div className="flex items-center justify-between gap-4">
        <div className="h-9 w-40 animate-pulse rounded-lg bg-surface-sunken" />
        <div className="h-11 w-48 animate-pulse rounded-lg bg-surface-sunken" />
      </div>
      <div className="flex flex-col gap-2">
        {['a', 'b', 'c', 'd', 'e', 'f'].map((key) => (
          <div key={key} className="h-14 w-full animate-pulse rounded-lg bg-surface-sunken" />
        ))}
      </div>
    </div>
  );
}
