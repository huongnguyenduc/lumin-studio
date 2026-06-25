import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Badge } from '@lumin/ui';
import { ArrowRightIcon } from './icons';

/**
 * Landing hero on the signature buttercream surface. The CTAs are real navigation links styled to
 * mirror the `pop` (gold + offset cocoa shadow) and `outline` buttons — links navigate, so this stays
 * a server component (no onClick). Padding (not `h-13`) sizes the primary CTA so it clears 44px.
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
              <Link
                href="/danh-muc"
                className="inline-flex items-center gap-2 rounded-pill border-2 border-border-strong bg-accent-sun px-7 py-3.5 font-display font-bold text-text-strong shadow-pop transition-transform duration-150 ease-out hover:-translate-x-px hover:-translate-y-px active:translate-x-0.5 active:translate-y-0.5 active:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky focus-visible:ring-offset-2 motion-reduce:transform-none"
              >
                {t('primaryCta')}
                <ArrowRightIcon className="h-5 w-5" />
              </Link>

              <Link
                href="/cau-chuyen"
                className="inline-flex items-center rounded-pill border-2 border-border-strong bg-transparent px-6 py-3 font-display font-semibold text-text-strong transition-colors hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky focus-visible:ring-offset-2"
              >
                {t('secondaryCta')}
              </Link>
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
