import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { PriceTag, Rating } from '@lumin/ui';
import type { ProductCardView } from '@/lib/product-view';
import { CardCover } from './card-cover';

/**
 * Catalog-grid tile (/danh-muc + home "Mới về"). Matches the hi-fi tile exactly: bare image tile on
 * the page surface (NO white card chrome), then a name↔price row (price = mono coral via PriceTag)
 * and the rating underneath. DELIBERATELY without fav/add controls — on browse, a card is a
 * navigation target; add-to-cart happens on the detail page after a colour is picked (the
 * add-to-cart lock, P1-h). Still a server component — the whole tile navigates via a stretched link
 * (::after overlay), and money/rating format through the leaf primitives (@lumin/core), never here.
 * The ONLY client JS is the cover's hover 360° turntable (the CardCover island, ADR-049), mounted
 * only when a product has a sprite sheet; the hi-fi "↔360" pill renders on those same tiles.
 */
export function CatalogCard({ product }: { product: ProductCardView }) {
  const t = useTranslations('product');

  return (
    <div className="group relative flex flex-col transition-transform duration-150 ease-out hover:-translate-x-px hover:-translate-y-px motion-reduce:transform-none">
      <div className="relative">
        <CardCover
          imageSrc={product.imageSrc}
          spriteSheetUrl={product.spriteSheetUrl}
          name={product.name}
          spriteAlt={t('sprite360Alt', { name: product.name })}
        />
        {product.spriteSheetUrl ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute bottom-2 right-2 rounded-pill border border-border-strong bg-surface-card px-2 py-0.5 font-mono text-[10px] font-bold text-text-strong"
          >
            {t('badge360')}
          </span>
        ) : null}
      </div>

      <div className="mt-2 flex items-baseline justify-between gap-2">
        <h3 className="line-clamp-2 text-[15px] font-semibold leading-tight text-text-strong">
          {/* Stretched link: the ::after overlay makes the whole tile navigate to the detail page. The
              tile has no other interactive elements, so there is no z-index/nesting conflict. */}
          <Link
            href={`/san-pham/${product.slug}`}
            className="rounded-sm after:absolute after:inset-0 after:content-[''] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky focus-visible:ring-offset-2"
          >
            {product.name}
          </Link>
        </h3>
        <PriceTag amount={product.basePrice} className="shrink-0 text-xs" />
      </div>

      {product.rating != null ? (
        <Rating
          value={product.rating}
          count={product.reviewCount}
          label={t('ratingLabel', { value: product.rating })}
          size="sm"
          className="mt-1"
        />
      ) : null}
    </div>
  );
}
