'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ProductCard } from '@lumin/ui';
import { demoProducts } from '@/lib/demo-products';

/**
 * "Mới về" merchandising grid — mounts the ProductCard primitive against the placeholder catalog.
 * Fav toggling is local state (real cart/wishlist lands in Phase 1). Renders an empty state when the
 * catalog is bare (conventions §State: empty · loading · error).
 */
export function FeaturedProducts() {
  const t = useTranslations('featured');
  const tp = useTranslations('product');
  const tb = useTranslations('badge');
  const [faved, setFaved] = useState<Record<string, boolean>>({});

  const products = demoProducts;

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
          <Link
            href="/"
            className="mt-4 inline-flex items-center rounded-pill border-2 border-border-strong bg-accent-sun px-6 py-3 font-display font-bold text-text-strong shadow-pop hover:-translate-x-px hover:-translate-y-px motion-reduce:transform-none"
          >
            {t('emptyCta')}
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {products.map((product) => (
            <ProductCard
              key={product.id}
              href={`/san-pham/${product.id}`}
              title={product.name}
              price={product.price}
              compareAt={product.compareAt}
              rating={product.rating}
              reviewCount={product.reviewCount}
              ratingLabel={tp('ratingLabel', { value: product.rating })}
              badge={
                product.badge
                  ? { label: tb(product.badge.key), tone: product.badge.tone }
                  : undefined
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
