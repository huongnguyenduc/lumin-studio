import { useTranslations } from 'next-intl';
import { Badge } from '@lumin/ui';
import { CtaLink } from './cta-link';
import { ArrowRightIcon } from './icons';

/**
 * Landing hero on the signature buttercream surface. The CTAs are real navigation links (so this
 * stays a server component, no onClick); they use the shared CtaLink, which mirrors the `pop` (gold +
 * offset cocoa shadow) and `outline` button variants and guarantees the 44px hit target.
 */
export function Hero() {
  const t = useTranslations('hero');

  return (
    <section className="mx-auto w-full max-w-[1200px] px-4 py-8 md:px-6 md:py-12">
      <div className="overflow-hidden rounded-lg border-2 border-border-strong bg-surface-cream shadow-pop">
        <div className="grid items-center gap-6 p-6 md:grid-cols-2 md:gap-8 md:p-12">
          <div className="flex flex-col items-start gap-5">
            <Badge tone="sun">{t('eyebrow')}</Badge>

            <h1 className="text-3xl leading-[1.1] text-text-strong md:text-5xl">{t('heading')}</h1>

            <p className="max-w-prose text-base leading-relaxed text-text-body md:text-lg">
              {t('body')}
            </p>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <CtaLink href="/danh-muc">
                {t('primaryCta')}
                <ArrowRightIcon className="h-5 w-5" />
              </CtaLink>

              <CtaLink variant="outline" href="/cau-chuyen">
                {t('secondaryCta')}
              </CtaLink>
            </div>

            <p className="font-mono text-xs text-text-muted">{t('note')}</p>
          </div>

          <div
            aria-hidden="true"
            className="relative mx-auto hidden aspect-square w-full max-w-sm md:block"
          >
            <div className="lumin-dotgrid absolute inset-0 rounded-lg border-2 border-border-strong" />
            <div className="absolute inset-12 rounded-[48%_52%_55%_45%/52%_48%_52%_48%] bg-accent-flame opacity-80 blur-2xl" />
            <div className="absolute inset-10 rounded-[48%_52%_55%_45%/52%_48%_52%_48%] border-2 border-border-strong bg-accent-flame-soft" />
          </div>
        </div>
      </div>
    </section>
  );
}
