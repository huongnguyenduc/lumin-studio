import { useTranslations } from 'next-intl';

/** Product-list loading skeleton (conventions §State) — a header bar, a tab/search row, and a grid of
 *  card placeholders shaped for this route. animate-pulse is stilled by reduced-motion. */
export default function Loading() {
  const t = useTranslations('states');

  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-6">
      <span className="sr-only">{t('loading')}</span>
      <div className="flex items-center justify-between gap-4">
        <div className="h-9 w-40 animate-pulse rounded-lg bg-surface-sunken" />
        <div className="h-11 w-44 animate-pulse rounded-lg bg-surface-sunken" />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="h-11 w-64 animate-pulse rounded-lg bg-surface-sunken" />
        <div className="ml-auto h-11 w-48 animate-pulse rounded-lg bg-surface-sunken" />
      </div>
      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
        {['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((key) => (
          <li key={key} className="animate-pulse rounded-xl bg-surface-sunken pb-3">
            <div className="aspect-square rounded-xl bg-surface-sunken" />
            <div className="mx-3 mt-3 h-4 w-3/4 rounded bg-surface-card" />
            <div className="mx-3 mt-2 h-4 w-1/3 rounded bg-surface-card" />
          </li>
        ))}
      </ul>
    </div>
  );
}
