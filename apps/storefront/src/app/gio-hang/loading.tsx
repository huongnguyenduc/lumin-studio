import { useTranslations } from 'next-intl';

/** Route-level cart skeleton (conventions §State: loading = skeleton). Mirrors the cart layout — a
 *  couple of line rows. animate-pulse is stilled by the global reduced-motion CSS. */
export default function Loading() {
  const t = useTranslations('states');

  return (
    <div
      role="status"
      aria-live="polite"
      className="mx-auto w-full max-w-[720px] px-4 py-6 md:px-6 md:py-10"
    >
      <span className="sr-only">{t('loading')}</span>
      <div className="h-9 w-40 animate-pulse rounded-md bg-surface-sunken" />
      <ul className="mt-6">
        {[0, 1].map((i) => (
          <li key={i} className="flex items-center gap-3 border-b border-border-subtle py-4">
            <span className="h-16 w-16 shrink-0 animate-pulse rounded-md bg-surface-sunken" />
            <span className="h-4 flex-1 animate-pulse rounded bg-surface-sunken" />
          </li>
        ))}
      </ul>
    </div>
  );
}
