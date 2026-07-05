import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('chinhSach');
  // Public, indexable policy page — a trust signal, unlike the noindex account/lookup pages. Pin the
  // canonical so the checkout consent / đổi-trả links (which land here with `#doi-tra` anchors and may
  // carry query strings) consolidate to the bare `/chinh-sach` (matches home/danh-muc/detail pattern).
  return {
    title: t('metaTitle'),
    description: t('metaDescription'),
    alternates: { canonical: '/chinh-sach' },
  };
}

/**
 * Legal / policy page (/chinh-sach, P2-h). Static i18n prose with two deep-linkable sections:
 * #doi-tra (return/exchange, Luật BVNTD 19/2023, ADR-012) and #quyen-rieng-tu (PDPL privacy notice,
 * compliance §2). The checkout consent + đổi-trả links (P2-d) point here. No runtime fetch — a legal
 * page must render even when the API is down; the shorter refundPolicy blurb (settings.refund_policy)
 * is rendered inline at checkout, this is the full policy.
 */
export default async function ChinhSachPage() {
  const t = await getTranslations('chinhSach');
  const collectItems = Object.values(t.raw('privacy.collectItems') as Record<string, string>);
  const rightsItems = Object.values(t.raw('privacy.rightsItems') as Record<string, string>);

  return (
    <div className="mx-auto w-full max-w-[720px] px-4 py-8 md:px-6 md:py-12">
      <h1 className="font-display text-2xl font-bold text-text-strong md:text-3xl">
        {t('heading')}
      </h1>
      <p className="mt-3 max-w-prose text-base leading-relaxed text-text-body">{t('intro')}</p>
      <p className="mt-1 font-mono text-xs text-text-muted">{t('updated')}</p>

      {/* Return / exchange policy — target of the đổi-trả pre-purchase link (P2-d). */}
      <section id="doi-tra" className="mt-10 scroll-mt-24">
        <h2 className="font-display text-xl font-bold text-text-strong">{t('returns.heading')}</h2>
        <p className="mt-3 max-w-prose text-sm leading-relaxed text-text-body">
          {t('returns.madeToOrder')}
        </p>

        <h3 className="mt-6 font-display text-base font-bold text-text-strong">
          {t('returns.standardHeading')}
        </h3>
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-text-body">
          {t('returns.standard')}
        </p>

        <h3 className="mt-6 font-display text-base font-bold text-text-strong">
          {t('returns.personalizedHeading')}
        </h3>
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-text-body">
          {t('returns.personalized')}
        </p>
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-text-body">
          {t('returns.echo')}
        </p>

        <h3 className="mt-6 font-display text-base font-bold text-text-strong">
          {t('returns.prepayHeading')}
        </h3>
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-text-body">
          {t('returns.prepay')}
        </p>

        <h3 className="mt-6 font-display text-base font-bold text-text-strong">
          {t('returns.howToHeading')}
        </h3>
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-text-body">
          {t('returns.howTo')}
        </p>
      </section>

      {/* PDPL privacy notice — target of the consent link (policy version 2026-01). */}
      <section id="quyen-rieng-tu" className="mt-12 scroll-mt-24">
        <h2 className="font-display text-xl font-bold text-text-strong">{t('privacy.heading')}</h2>
        <p className="mt-3 max-w-prose text-sm leading-relaxed text-text-body">
          {t('privacy.intro')}
        </p>

        <h3 className="mt-6 font-display text-base font-bold text-text-strong">
          {t('privacy.collectHeading')}
        </h3>
        <ul className="mt-2 max-w-prose list-disc space-y-1 pl-5 text-sm leading-relaxed text-text-body">
          {collectItems.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>

        <h3 className="mt-6 font-display text-base font-bold text-text-strong">
          {t('privacy.purposeHeading')}
        </h3>
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-text-body">
          {t('privacy.purpose')}
        </p>

        <h3 className="mt-6 font-display text-base font-bold text-text-strong">
          {t('privacy.marketingHeading')}
        </h3>
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-text-body">
          {t('privacy.marketing')}
        </p>

        <h3 className="mt-6 font-display text-base font-bold text-text-strong">
          {t('privacy.retentionHeading')}
        </h3>
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-text-body">
          {t('privacy.retention')}
        </p>

        <h3 className="mt-6 font-display text-base font-bold text-text-strong">
          {t('privacy.rightsHeading')}
        </h3>
        <ul className="mt-2 max-w-prose list-disc space-y-1 pl-5 text-sm leading-relaxed text-text-body">
          {rightsItems.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>

        <h3 className="mt-6 font-display text-base font-bold text-text-strong">
          {t('privacy.analyticsHeading')}
        </h3>
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-text-body">
          {t('privacy.analytics')}
        </p>

        <h3 className="mt-6 font-display text-base font-bold text-text-strong">
          {t('privacy.contactHeading')}
        </h3>
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-text-body">
          {t('privacy.contact')}
        </p>
      </section>
    </div>
  );
}
