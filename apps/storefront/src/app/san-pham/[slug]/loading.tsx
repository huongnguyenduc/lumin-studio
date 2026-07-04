import { useTranslations } from 'next-intl';

/** Route-level detail skeleton (conventions §State: loading = skeleton). Mirrors the detail layout —
 *  media square + info lines. animate-pulse is stilled by the global reduced-motion CSS. */
export default function Loading() {
  const t = useTranslations('states');

  return (
    <div
      role="status"
      aria-live="polite"
      className="mx-auto w-full max-w-[1200px] px-4 py-6 md:px-6 md:py-10"
    >
      <span className="sr-only">{t('loading')}</span>
      <div className="flex flex-col gap-8 md:flex-row md:gap-9">
        <div className="aspect-square w-full animate-pulse rounded-lg bg-surface-sunken md:w-[460px] md:shrink-0" />
        <div className="flex flex-1 flex-col gap-4">
          <div className="h-9 w-3/4 animate-pulse rounded-md bg-surface-sunken" />
          <div className="h-7 w-40 animate-pulse rounded-md bg-surface-sunken" />
          <div className="mt-2 h-12 w-full animate-pulse rounded-pill bg-surface-sunken md:w-52" />
          <div className="mt-2 h-28 w-full animate-pulse rounded-md bg-surface-sunken" />
        </div>
      </div>
    </div>
  );
}
