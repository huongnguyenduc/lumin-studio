import { useTranslations } from 'next-intl';

/** Skeleton for the account hub while GET /customer/orders is in flight (conventions §State). Matches
 *  the sibling loading.tsx idiom (sync server component + useTranslations); animate-pulse is stilled by
 *  prefers-reduced-motion (global tokens CSS). */
export default function AccountLoading() {
  const t = useTranslations('account');

  return (
    <section
      role="status"
      aria-live="polite"
      className="mx-auto w-full max-w-[640px] px-4 py-6 md:px-6 md:py-10"
    >
      <span className="sr-only">{t('loading')}</span>
      <div className="h-9 w-56 animate-pulse rounded-md bg-surface-sunken" />
      <div className="mt-8 h-6 w-40 animate-pulse rounded-md bg-surface-sunken" />
      <div className="mt-4 flex flex-col gap-3">
        {['a', 'b', 'c'].map((key) => (
          <div
            key={key}
            className="h-20 animate-pulse rounded-lg border-2 border-border-default bg-surface-card"
          />
        ))}
      </div>
    </section>
  );
}
