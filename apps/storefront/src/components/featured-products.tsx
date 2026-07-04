'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ProductCard } from '@lumin/ui';
import { CtaLink } from './cta-link';
import type { ProductCardView } from '@/lib/product-view';

/**
 * "Mới về" merchandising grid. Data is fetched server-side (page.tsx → lib/catalog) and passed in;
 * this stays a client component only for local fav toggling (real cart/wishlist is a later Phase-1
 * PR). Renders an empty state when the catalog is bare (conventions §State: empty · loading · error;
 * loading + error are the route-level loading.tsx / error.tsx). It imports the VIEW TYPE only, so the
 * server-only catalog client never enters the client bundle.
 */
export function FeaturedProducts({ products }: { products: ProductCardView[] }) {
  const t = useTranslations('featured');
  const tp = useTranslations('product');
  const [faved, setFaved] = useState<Record<string, boolean>>({});

  return (
    <section className="mx-auto w-full max-w-[1200px] px-4 py-8 md:px-6">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl md:text-3xl">{t('heading')}</h2>
          <p className="mt-1 text-sm text-text-muted">{t('subheading')}</p>
        </div>
        <Link
          href="/danh-muc"
          className="shrink-0 font-display text-sm font-semibold text-text-link hover:underline"
        >
          {t('viewAll')}
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
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {products.map((product) => (
            <ProductCard
              key={product.id}
              href={`/san-pham/${product.slug}`}
              title={product.name}
              price={product.basePrice}
              imageSrc={product.imageSrc}
              imageAlt={product.name}
              rating={product.rating ?? undefined}
              reviewCount={product.reviewCount}
              ratingLabel={
                product.rating != null ? tp('ratingLabel', { value: product.rating }) : undefined
              }
              faved={Boolean(faved[product.id])}
              onToggleFav={() =>
                setFaved((state) => ({ ...state, [product.id]: !state[product.id] }))
              }
              favLabel={tp('favLabel', { name: product.name })}
              addLabel={tp('add')}
            />
          ))}
        </div>
      )}
    </section>
  );
}
