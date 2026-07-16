import { useTranslations } from 'next-intl';
import { CtaLink } from '@/components/cta-link';

/** Root 404 (hi-fi 11): big coral "404", warm title + body, and the yellow way home. Server component
 *  — Next renders it for any unmatched route (and for notFound() without a closer boundary). */
export default function NotFound() {
  const t = useTranslations('states');

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-16 md:px-6">
      <div className="mx-auto flex max-w-sm flex-col items-center gap-3 rounded-lg border-2 border-border-strong bg-surface-card p-10 text-center shadow-pop-sm">
        <p aria-hidden="true" className="font-display text-5xl font-extrabold text-primary">
          {t('notFoundCode')}
        </p>
        <h1 className="font-display text-lg font-bold text-text-strong">{t('notFoundTitle')}</h1>
        <p className="text-sm text-text-muted">{t('notFoundBody')}</p>
        <CtaLink href="/" className="mt-2">
          {t('notFoundCta')}
        </CtaLink>
      </div>
    </div>
  );
}
