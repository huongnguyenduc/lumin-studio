import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { CtaLink } from './cta-link';
import { CatalogCard } from './catalog-card';
import type { ProductCardView } from '@/lib/product-view';

/**
 * "Mới về" merchandising grid. Data is fetched server-side (page.tsx → lib/catalog) and passed in.
 * Hi-fi desktop home: heading + a mono-coral "Xem tất cả →" on ONE row, then a 5-column row of the
 * SAME bare tiles the catalog grid uses (CatalogCard) — no white card chrome, no fav/add controls.
 * Server component (the only client JS is CatalogCard's hover-360 island). Renders an empty state
 * when the catalog is bare (conventions §State: empty · loading · error; loading + error are the
 * route-level loading.tsx / error.tsx). It imports the VIEW TYPE only, so the server-only catalog
 * client never enters the client bundle.
 */
export function FeaturedProducts({ products }: { products: ProductCardView[] }) {
  const t = useTranslations('featured');

  return (
    <section className="mx-auto w-full max-w-[1200px] px-4 py-8 md:px-6">
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <h2 className="text-2xl md:text-3xl">{t('heading')}</h2>
        <Link
          href="/danh-muc"
          className="shrink-0 rounded-sm font-mono text-xs font-bold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky focus-visible:ring-offset-2"
        >
          {t('viewAll')} <span aria-hidden="true">→</span>
        </Link>
      </div>

      {products.length === 0 ? (
        <div className="rounded-lg border-2 border-dashed border-border-default bg-surface-sunken p-10 text-center">
          <p className="text-text-muted">{t('empty')}</p>
          {/* Recover toward the browse surface, not back to this same home page — matches the
              `viewAll` link's /danh-muc target (conventions §State: empty needs a USEFUL CTA). */}
          <CtaLink href="/danh-muc" className="mt-4">
            {t('emptyCta')}
          </CtaLink>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
          {products.map((product) => (
            <CatalogCard key={product.id} product={product} />
          ))}
        </div>
      )}
    </section>
  );
}
