import { useTranslations } from 'next-intl';

/** Skeleton for the pet page while GET /pet-tags/{shortId} is in flight (conventions §State). Matches the
 *  sibling loading.tsx idiom (sync server component + useTranslations); animate-pulse is stilled by
 *  prefers-reduced-motion (global tokens CSS). Mobile-first container, mirroring the page states. */
export default function PetPageLoading() {
  const t = useTranslations('petTag');

  return (
    <main
      role="status"
      aria-live="polite"
      className="mx-auto flex min-h-[100dvh] w-full max-w-[440px] flex-col items-center px-5 py-10"
    >
      <span className="sr-only">{t('loading')}</span>
      <div className="mt-10 h-24 w-24 animate-pulse rounded-full bg-surface-sunken" />
      <div className="mt-5 h-7 w-40 animate-pulse rounded-md bg-surface-sunken" />
      <div className="mt-3 h-4 w-56 animate-pulse rounded-md bg-surface-sunken" />
      <div className="mt-8 h-11 w-full animate-pulse rounded-pill bg-surface-sunken" />
    </main>
  );
}
