import { getTranslations } from 'next-intl/server';

/** Skeleton for the account hub while GET /customer/orders is in flight. The pulse is stilled by
 *  reduced-motion; a visually-hidden status carries the meaning for assistive tech. */
export default async function AccountLoading() {
  const t = await getTranslations('account');
  return (
    <section className="mx-auto w-full max-w-[640px] px-4 py-6 md:px-6 md:py-10">
      <p className="sr-only" role="status">
        {t('loading')}
      </p>
      <div aria-hidden="true">
        <div className="h-9 w-56 rounded-md bg-surface-sunken motion-safe:animate-pulse" />
        <div className="mt-8 h-6 w-40 rounded-md bg-surface-sunken motion-safe:animate-pulse" />
        <div className="mt-4 flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-20 rounded-lg border-2 border-border-default bg-surface-card motion-safe:animate-pulse"
            />
          ))}
        </div>
      </div>
    </section>
  );
}
