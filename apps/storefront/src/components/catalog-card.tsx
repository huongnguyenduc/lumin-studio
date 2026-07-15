import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Card, PriceTag, Rating } from '@lumin/ui';
import type { ProductCardView } from '@/lib/product-view';
import { CardCover } from './card-cover';

/**
 * Compact catalog-grid card (/danh-muc). Matches the hi-fi browse grid: image tile + name + price
 * (+ rating when present) — DELIBERATELY without the fav/add controls of the home merch card
 * (@lumin/ui ProductCard). On browse, a card is a navigation target; add-to-cart happens on the detail
 * page after a colour is picked (the add-to-cart lock, P1-h), so an add button here would be a dead
 * control. Still a server component — the whole card navigates via a stretched link (::after overlay),
 * and money/rating format through the leaf primitives (@lumin/core), never here. The ONLY client JS is
 * the cover's hover 360° turntable (the CardCover island, ADR-049), mounted only when a product has a
 * sprite sheet. The card name uses the body font (design: grid names are Hanken, not the display face).
 */
export function CatalogCard({ product }: { product: ProductCardView }) {
  const t = useTranslations('product');

  return (
    <Card
      elevation="md"
      className="group relative flex flex-col gap-2 p-2.5 transition-transform duration-150 ease-out hover:-translate-x-px hover:-translate-y-px motion-reduce:transform-none"
    >
      <CardCover
        imageSrc={product.imageSrc}
        spriteSheetUrl={product.spriteSheetUrl}
        name={product.name}
        spriteAlt={t('sprite360Alt', { name: product.name })}
      />

      <h3 className="line-clamp-2 text-sm font-semibold leading-tight text-text-strong">
        {/* Stretched link: the ::after overlay makes the whole card navigate to the detail page. The
            card has no other interactive elements, so there is no z-index/nesting conflict. */}
        <Link
          href={`/san-pham/${product.slug}`}
          className="rounded-sm after:absolute after:inset-0 after:content-[''] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky focus-visible:ring-offset-2"
        >
          {product.name}
        </Link>
      </h3>

      {product.rating != null ? (
        <Rating
          value={product.rating}
          count={product.reviewCount}
          label={t('ratingLabel', { value: product.rating })}
          size="sm"
        />
      ) : null}

      <PriceTag amount={product.basePrice} className="text-sm" />
    </Card>
  );
}
