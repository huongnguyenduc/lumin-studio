import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { PriceTag, Rating } from '@lumin/ui';
import type { ProductCardView } from '@/lib/product-view';
import { CardCover } from './card-cover';

/** Hi-fi 02 draws at most four dots, the rest collapse into a mono "+N". */
const MAX_DOTS = 4;

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

      {/* Hi-fi 02: hàng dots màu (≤4 dot + "+N" mono) bên trái, ★rating bên phải. Dots trang trí —
          tên/màu chọn ở trang chi tiết — nên aria-hidden; "+N" là số màu còn lại chưa vẽ. */}
      {product.colorSwatches.length > 0 || product.rating != null ? (
        <div className="mt-1.5 flex items-center justify-between gap-2">
          {product.colorSwatches.length > 0 ? (
            <span aria-hidden="true" className="flex items-center gap-1.5">
              {product.colorSwatches.slice(0, MAX_DOTS).map((hex, i) => (
                <span
                  key={`${hex}-${i}`}
                  className="h-[15px] w-[15px] rounded-full border border-border-strong"
                  style={{ backgroundColor: hex }}
                />
              ))}
              {product.colorSwatches.length > MAX_DOTS ? (
                <span className="font-mono text-[10px] text-text-muted">
                  +{product.colorSwatches.length - MAX_DOTS}
                </span>
              ) : null}
            </span>
          ) : (
            <span />
          )}
          {product.rating != null ? (
            <Rating
              value={product.rating}
              count={product.reviewCount}
              label={t('ratingLabel', { value: product.rating })}
              size="sm"
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
