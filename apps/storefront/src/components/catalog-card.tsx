import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { formatVnRating } from '@lumin/core';
import { PriceTag } from '@lumin/ui';
import type { ProductCardView } from '@/lib/product-view';
import { CardCover } from './card-cover';

/** Hi-fi 02 draws at most four dots, the rest collapse into a mono "+N". */
const MAX_DOTS = 4;

/**
 * Catalog-grid tile (/danh-muc + home "Mới về"). Matches the hi-fi grid tile exactly: bare image tile
 * on the page surface (NO white card chrome), the name on its own line, the price (mono coral,
 * PriceTag) on the line BELOW — hi-fi 01/03/desktop stack them, never side by side — then the dots
 * row with a compact "★ 4,8" on the right (hi-fi 02 "Card lớn"; the first dot carries the strong
 * cocoa ring, the rest the soft border). DELIBERATELY without fav/add controls — on browse, a card is
 * a navigation target; add-to-cart happens on the detail page after a colour is picked (the
 * add-to-cart lock, P1-h). Still a server component — the whole tile navigates via a stretched link
 * (::after overlay), and money/rating format through @lumin/core only, never here. The ONLY client JS
 * is the cover's 360° turntable island (hover on PC, dwell-2s on touch — ADR-049 / hi-fi 02); the
 * hi-fi "↔360" pill renders on those same tiles.
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

      <h3 className="mt-2 line-clamp-2 text-[15px] font-semibold leading-tight text-text-strong">
        {/* Stretched link: the ::after overlay makes the whole tile navigate to the detail page. The
            tile has no other interactive elements, so there is no z-index/nesting conflict. */}
        <Link
          href={`/san-pham/${product.slug}`}
          className="rounded-sm after:absolute after:inset-0 after:content-[''] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky focus-visible:ring-offset-2"
        >
          {product.name}
        </Link>
      </h3>
      <PriceTag amount={product.basePrice} className="mt-0.5 self-start text-xs" />

      {/* Hi-fi 02: hàng dots màu (≤4 dot + "+N" mono) bên trái, "★ 4,8" gọn bên phải. Dots trang trí —
          tên/màu chọn ở trang chi tiết — nên aria-hidden; "+N" là số màu còn lại chưa vẽ. Dot đầu viền
          cocoa đậm (màu preset đang chụp), các dot sau viền kem nhạt — đúng hi-fi. */}
      {product.colorSwatches.length > 0 || product.rating != null ? (
        <div className="mt-1.5 flex items-center justify-between gap-2">
          {product.colorSwatches.length > 0 ? (
            <span aria-hidden="true" className="flex items-center gap-1.5">
              {product.colorSwatches.slice(0, MAX_DOTS).map((hex, i) => (
                <span
                  key={`${hex}-${i}`}
                  className={`h-[15px] w-[15px] rounded-full border ${
                    i === 0 ? 'border-border-strong' : 'border-border-default'
                  }`}
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
            <span
              role="img"
              aria-label={t('ratingLabel', { value: formatVnRating(product.rating) })}
              className="text-[11px] font-bold text-text-muted"
            >
              {t('ratingCompact', { value: formatVnRating(product.rating) })}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
