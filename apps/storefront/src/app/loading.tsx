import { useTranslations } from 'next-intl';

/** Route-level loading skeleton (conventions §State). animate-pulse is stilled by reduced-motion. */
export default function Loading() {
  const t = useTranslations('states');

  return (
    <div
      role="status"
      aria-live="polite"
      className="mx-auto w-full max-w-[1200px] px-4 py-8 md:px-6"
    >
      <span className="sr-only">{t('loading')}</span>
      <div className="h-48 w-full animate-pulse rounded-lg bg-surface-sunken md:h-72" />
      <div className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-4">
        {['a', 'b', 'c', 'd'].map((key) => (
          <div key={key} className="h-64 animate-pulse rounded-lg bg-surface-sunken" />
        ))}
      </div>
    </div>
  );
}
