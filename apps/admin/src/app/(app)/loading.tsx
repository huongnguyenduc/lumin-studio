import { useTranslations } from 'next-intl';

/** Route-level loading skeleton (conventions §State). animate-pulse is stilled by reduced-motion. */
export default function Loading() {
  const t = useTranslations('states');

  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-8">
      <span className="sr-only">{t('loading')}</span>
      <div className="h-10 w-64 animate-pulse rounded-lg bg-surface-sunken" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {['a', 'b', 'c', 'd'].map((key) => (
          <div key={key} className="h-28 animate-pulse rounded-lg bg-surface-sunken" />
        ))}
      </div>
      <div className="h-72 w-full animate-pulse rounded-lg bg-surface-sunken" />
    </div>
  );
}
