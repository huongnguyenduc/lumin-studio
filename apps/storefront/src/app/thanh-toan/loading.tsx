import { useTranslations } from 'next-intl';

/** Route-level checkout skeleton, shown while the RSC shell fetches the checkout config (conventions
 *  §State: loading = skeleton). Mirrors the info-step layout — a summary card + a few field rows.
 *  animate-pulse is stilled by the global reduced-motion CSS. */
export default function Loading() {
  const t = useTranslations('states');

  return (
    <div
      role="status"
      aria-live="polite"
      className="mx-auto w-full max-w-[520px] px-4 py-6 md:px-6 md:py-10"
    >
      <span className="sr-only">{t('loading')}</span>
      <div className="h-9 w-40 animate-pulse rounded-md bg-surface-sunken" />
      <div className="mt-6 h-16 animate-pulse rounded-lg bg-surface-sunken" />
      <div className="mt-6 flex flex-col gap-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-11 animate-pulse rounded-md bg-surface-sunken" />
        ))}
      </div>
    </div>
  );
}
