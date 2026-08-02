import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { fetchShopContact, hasAnyChannel } from '@/lib/shop-contact';
import { jsonLdScriptContent } from '@/lib/product-jsonld';
import { siteBaseUrl } from '@/lib/site';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('lienHe');
  // Public, indexable trust page (unlike checkout/lookup/cart, which are noindex) — a shop with real
  // contact channels is a trust signal, matching /chinh-sach's posture.
  return {
    title: t('metaTitle'),
    description: t('metaDescription'),
    alternates: { canonical: '/lien-he' },
  };
}

/**
 * /lien-he (PR F) — the page the "Nhắn shop" popup + the footer link + the wait-screen's contact CTA all
 * point to (previously a 404: SHOP_CONTACT_HREF/footer referenced a route that was never built). Reads
 * GET /shop/contact (public, every field optional) and lists whatever channels the shop configured as
 * tappable rows (tel:/mailto:/zalo.me/m.me), plus hours/address. An unconfigured shop still gets a 200
 * page with a warm "đang cập nhật" fallback — never a dead end.
 */
export default async function LienHePage() {
  const t = await getTranslations('lienHe');
  const result = await fetchShopContact();
  const contact = result.ok ? result.contact : {};
  const configured = result.ok && hasAnyChannel(contact);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'Lumin Studio',
    url: siteBaseUrl(),
    ...(contact.phone ? { telephone: contact.phone } : {}),
    ...(contact.email ? { email: contact.email } : {}),
    ...(contact.address ? { address: contact.address } : {}),
  };

  return (
    <div className="mx-auto w-full max-w-[560px] px-4 py-8 md:px-6 md:py-12">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScriptContent(jsonLd) }}
      />
      <h1 className="font-display text-2xl font-bold text-text-strong md:text-3xl">
        {t('heading')}
      </h1>
      <p className="mt-3 max-w-prose text-base leading-relaxed text-text-body">{t('intro')}</p>

      {!configured ? (
        <p className="mt-8 rounded-lg border-2 border-dashed border-border-default bg-surface-sunken p-6 text-center text-sm text-text-muted">
          {t('empty')}
        </p>
      ) : (
        <dl className="mt-8 flex flex-col gap-4">
          {contact.zalo && (
            <ContactRow label={t('zalo')} href={`https://zalo.me/${contact.zalo}`} external />
          )}
          {contact.facebook && (
            <ContactRow label={t('facebook')} href={`https://m.me/${contact.facebook}`} external />
          )}
          {contact.phone && (
            <ContactRow label={t('phone')} href={`tel:${contact.phone}`} value={contact.phone} />
          )}
          {contact.email && (
            <ContactRow label={t('email')} href={`mailto:${contact.email}`} value={contact.email} />
          )}
          {contact.address && <ContactRow label={t('address')} value={contact.address} />}
          {contact.hours && <ContactRow label={t('hours')} value={contact.hours} />}
        </dl>
      )}
    </div>
  );
}

function ContactRow({
  label,
  value,
  href,
  external,
}: {
  label: string;
  value?: string;
  href?: string;
  external?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border-subtle bg-surface-card px-4 py-3">
      <dt className="text-sm font-semibold text-text-strong">{label}</dt>
      {href ? (
        <a
          href={href}
          {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
          className="text-sm font-semibold text-primary underline-offset-2 hover:underline"
        >
          {value ?? href}
        </a>
      ) : (
        <dd className="text-right text-sm text-text-body">{value}</dd>
      )}
    </div>
  );
}
