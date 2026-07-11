import { useTranslations } from 'next-intl';

/** Vật tư loading skeleton (conventions §State) — a title, the 4-card KPI row, a tab strip, and a
 *  table/rail block shaped for this route. animate-pulse is stilled by reduced-motion. */
export default function Loading() {
  const t = useTranslations('states');

  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-6">
      <span className="sr-only">{t('loading')}</span>
      <div className="h-9 w-48 animate-pulse rounded-lg bg-surface-sunken" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {['a', 'b', 'c', 'd'].map((key) => (
          <div key={key} className="h-24 animate-pulse rounded-xl bg-surface-sunken" />
        ))}
      </div>
      <div className="flex gap-2">
        {['a', 'b', 'c', 'd'].map((key) => (
          <div key={key} className="h-11 w-28 animate-pulse rounded-lg bg-surface-sunken" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <div className="h-64 animate-pulse rounded-xl bg-surface-sunken" />
        <div className="h-64 animate-pulse rounded-xl bg-surface-sunken" />
      </div>
    </div>
  );
}
