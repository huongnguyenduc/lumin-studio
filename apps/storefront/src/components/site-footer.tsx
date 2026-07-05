import Link from 'next/link';
import { useTranslations } from 'next-intl';

/** Storefront footer: brand + tagline and three link columns. Static → server component. */
export function SiteFooter() {
  const t = useTranslations('footer');
  const tn = useTranslations('nav');

  const columns = [
    {
      heading: t('shopHeading'),
      links: [
        { href: '/danh-muc', label: t('shopCategories') },
        { href: '/moi-ve', label: t('shopNew') },
        { href: '/ban-chay', label: t('shopBestsellers') },
      ],
    },
    {
      heading: t('supportHeading'),
      links: [
        { href: '/tra-cuu-don', label: t('supportOrderLookup') },
        { href: '/chinh-sach#doi-tra', label: t('supportReturns') },
        { href: '/lien-he', label: t('supportContact') },
      ],
    },
    {
      heading: t('aboutHeading'),
      links: [
        { href: '/cau-chuyen', label: t('aboutStory') },
        { href: '/danh-gia', label: t('aboutReviews') },
      ],
    },
  ];

  return (
    <footer className="border-t border-border-subtle bg-surface-sunken">
      <div className="mx-auto grid w-full max-w-[1200px] gap-8 px-4 py-12 md:grid-cols-4 md:px-6">
        <div className="flex flex-col gap-3">
          <span className="flex items-baseline gap-1 font-display text-xl font-extrabold text-text-strong">
            {tn('brand')}
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-accent-flame" />
          </span>
          <p className="max-w-xs text-sm text-text-muted">{t('tagline')}</p>
        </div>

        {columns.map((column) => (
          <div key={column.heading} className="flex flex-col gap-2">
            <h2 className="font-display text-sm font-bold tracking-wide text-text-strong">
              {column.heading}
            </h2>
            {column.links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-sm text-text-muted transition-colors hover:text-text-strong"
              >
                {link.label}
              </Link>
            ))}
          </div>
        ))}
      </div>

      <div className="border-t border-border-subtle">
        <div className="mx-auto w-full max-w-[1200px] px-4 py-4 md:px-6">
          <p className="font-mono text-xs text-text-muted">{t('copyright')}</p>
        </div>
      </div>
    </footer>
  );
}
