import { useTranslations } from 'next-intl';

/** Product-editor loading skeleton (conventions §State) — a header bar and two form cards shaped for this
 *  route. animate-pulse is stilled by reduced-motion. */
export default function Loading() {
  const t = useTranslations('states');

  return (
    <div role="status" aria-live="polite" className="flex max-w-2xl flex-col gap-6">
      <span className="sr-only">{t('loading')}</span>
      <div className="flex items-center justify-between gap-4">
        <div className="h-9 w-56 animate-pulse motion-reduce:animate-none rounded-lg bg-surface-sunken" />
        <div className="h-11 w-28 animate-pulse motion-reduce:animate-none rounded-lg bg-surface-sunken" />
      </div>
      {['info', 'spec'].map((key) => (
        <div key={key} className="flex flex-col gap-4 rounded-xl bg-surface-sunken p-5">
          <div className="h-5 w-32 animate-pulse motion-reduce:animate-none rounded bg-surface-card" />
          <div className="h-11 w-full animate-pulse motion-reduce:animate-none rounded-lg bg-surface-card" />
          <div className="h-11 w-full animate-pulse motion-reduce:animate-none rounded-lg bg-surface-card" />
          <div className="h-24 w-full animate-pulse motion-reduce:animate-none rounded-lg bg-surface-card" />
        </div>
      ))}
    </div>
  );
}
