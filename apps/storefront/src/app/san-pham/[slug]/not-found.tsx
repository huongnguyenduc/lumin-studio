import { useTranslations } from 'next-intl';
import { CtaLink } from '@/components/cta-link';

/** Rendered when the detail page calls notFound() (unknown slug or draft/archived product — uniform,
 *  no catalog-existence leak). Recovers toward the browse surface (conventions §State: 404 needs a
 *  useful CTA), matching the empty-state target elsewhere. */
export default function NotFound() {
  const t = useTranslations('productDetail');

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col items-center gap-4 px-4 py-20 text-center md:px-6">
      <h1 className="font-display text-2xl md:text-3xl">{t('notFoundTitle')}</h1>
      <p className="text-text-muted">{t('notFoundBody')}</p>
      <CtaLink href="/danh-muc" className="mt-2">
        {t('notFoundCta')}
      </CtaLink>
    </div>
  );
}
