'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Button, PriceTag, Rating, cn } from '@lumin/ui';
import {
  canAddToCart,
  formatDimensions,
  isColorSelectable,
  type ProductDetailView,
} from '@/lib/product-view';

/**
 * Product detail (/san-pham/{slug}). Data is fetched server-side (page.tsx → lib/catalog) and passed in;
 * this is a client component for the local color/gallery selection state only. Scope (P1-h): media +
 * name + price + rating + description + specs + colour swatches, with the "Thêm vào giỏ" CTA LOCKED
 * until an in-stock colour is chosen (spec §03 / plan §3). The cart action, quantity, engrave/option
 * pickers, 360° viewer and the reviews section are later PRs (P1-k / P1-j / P1-i / P1-m) — the CTA's
 * click is intentionally unwired here; P1-k adds `onClick` + the cart Selection.
 *
 * Money: displays basePrice via PriceTag/@lumin/core only — never sums basePrice + colour/option deltas
 * on the client (conventions §Tiền: tổng tính ở server; the live per-selection total is POST
 * /price/quote in P1-k). It imports the VIEW TYPE + pure helpers, never lib/catalog, so the server-only
 * client stays out of the bundle.
 */
export function ProductDetail({ product }: { product: ProductDetailView }) {
  const t = useTranslations('productDetail');
  const tp = useTranslations('product');
  const tNav = useTranslations('nav');
  const tErr = useTranslations('core.errors');

  const [activeImage, setActiveImage] = useState(0);
  const [selectedColorId, setSelectedColorId] = useState<string | null>(null);

  const cover = product.images[activeImage];
  const canAdd = canAddToCart(selectedColorId, product.colors);
  const hasColors = product.colors.length > 0;
  const anyUnavailable = product.colors.some((c) => !c.available);
  const anyPriceDelta = product.colors.some((c) => c.priceDelta > 0);

  return (
    <article className="mx-auto w-full max-w-[1200px] px-4 py-6 md:px-6 md:py-10">
      <nav aria-label={t('breadcrumbLabel')} className="mb-4 text-sm text-text-muted">
        <Link href="/" className="hover:underline">
          {tNav('home')}
        </Link>
        <span aria-hidden="true" className="px-2">
          /
        </span>
        <span aria-current="page" className="text-text-strong">
          {product.name}
        </span>
      </nav>

      <div className="flex flex-col gap-8 md:flex-row md:gap-9">
        {/* Media — static cover + thumbnail gallery. 360°/sprite + model-viewer are P1-i. */}
        <div className="md:w-[460px] md:shrink-0">
          <div className="aspect-square overflow-hidden rounded-lg bg-surface-sunken">
            {cover ? (
              // Arbitrary shop-photo hosts → a plain <img> (no next/image remotePatterns to maintain),
              // matching @lumin/ui ProductCard. Alt = product name (jsx-a11y).
              <img src={cover} alt={product.name} className="h-full w-full object-cover" />
            ) : (
              <div className="lumin-dotgrid h-full w-full" aria-hidden="true" />
            )}
          </div>

          {product.images.length > 1 ? (
            <ul className="mt-3 flex flex-wrap gap-2">
              {product.images.map((src, i) => (
                <li key={src}>
                  <button
                    type="button"
                    aria-label={t('galleryThumbLabel', { index: i + 1 })}
                    aria-current={i === activeImage}
                    onClick={() => setActiveImage(i)}
                    className={cn(
                      'h-16 w-16 overflow-hidden rounded-md border-2',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky focus-visible:ring-offset-2',
                      i === activeImage ? 'border-border-strong' : 'border-border-default',
                    )}
                  >
                    <img src={src} alt="" className="h-full w-full object-cover" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        {/* Info column */}
        <div className="flex flex-1 flex-col gap-5">
          <h1 className="font-display text-2xl font-bold leading-tight text-text-strong md:text-3xl">
            {product.name}
          </h1>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <PriceTag amount={product.basePrice} className="text-2xl" />
            {product.rating != null ? (
              <Rating
                value={product.rating}
                count={product.reviewCount}
                label={tp('ratingLabel', { value: product.rating })}
                size="sm"
              />
            ) : (
              <span className="text-sm text-text-muted">{t('noReviews')}</span>
            )}
          </div>

          {anyPriceDelta ? <p className="text-sm text-text-muted">{t('priceNote')}</p> : null}
          <p className="text-sm text-text-muted">{t('madeToOrder')}</p>

          {/* Colour swatches. Out-of-stock (available:false) → disabled swatch; the CTA can never
              unlock on an unavailable colour (canAddToCart). */}
          {hasColors ? (
            // role=group + aria-labelledby names the swatch set by its heading; the swatches stay
            // aria-pressed toggle buttons (per the locked a11y invariant), now announced as a group.
            <div role="group" aria-labelledby="detail-colors-heading">
              <h2
                id="detail-colors-heading"
                className="mb-2 font-display text-sm font-semibold text-text-strong"
              >
                {t('colorsLabel')}
              </h2>
              <ul className="flex flex-wrap gap-3">
                {product.colors.map((c) => {
                  const selectable = isColorSelectable(c);
                  const selected = c.id === selectedColorId;
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        disabled={!selectable}
                        aria-pressed={selectable ? selected : undefined}
                        aria-label={
                          selectable
                            ? t('selectColorLabel', { name: c.name })
                            : t('colorUnavailableLabel', { name: c.name })
                        }
                        onClick={() => setSelectedColorId(c.id)}
                        className={cn(
                          'relative h-11 w-11 rounded-full border-2 transition-transform duration-150 ease-out',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky focus-visible:ring-offset-2',
                          'motion-reduce:transition-none',
                          selected
                            ? 'border-border-strong ring-2 ring-border-strong ring-offset-2'
                            : 'border-border-default',
                          selectable
                            ? 'hover:-translate-y-px motion-reduce:transform-none'
                            : 'cursor-not-allowed opacity-40',
                        )}
                        style={{ backgroundColor: c.hex }}
                      >
                        {!selectable ? (
                          // Diagonal strike (CSS, no glyph) marks the out-of-stock swatch; the disabled
                          // state + aria-label carry the meaning for AT.
                          <span
                            aria-hidden="true"
                            className="absolute left-1/2 top-1/2 h-0.5 w-[130%] -translate-x-1/2 -translate-y-1/2 -rotate-45 rounded-full bg-border-strong"
                          />
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
              {/* Spec §05-mandated copy (SF-04). Out-of-stock swatches are disabled → un-selectable, so
                  this is a standing note explaining the dimmed swatches rather than a per-selection error. */}
              {anyUnavailable ? (
                <p role="note" className="mt-2 text-sm text-text-muted">
                  {tErr('colorOutOfStock')}
                </p>
              ) : null}
            </div>
          ) : null}

          {/* Add-to-cart: locked until an in-stock colour is chosen. Click is unwired in P1-h — the
              cart Selection + onClick land in P1-k. */}
          <div>
            <Button variant="pop" size="lg" disabled={!canAdd} className="w-full md:w-auto">
              {tp('add')}
            </Button>
            {hasColors && !canAdd ? (
              <p className="mt-2 text-sm text-text-muted">{t('pickColorHint')}</p>
            ) : null}
          </div>

          <section>
            <h2 className="mb-1 font-display text-lg font-semibold text-text-strong">
              {t('descriptionHeading')}
            </h2>
            <p className="whitespace-pre-line text-text-body">{product.description}</p>
          </section>

          <section>
            <h2 className="mb-1 font-display text-lg font-semibold text-text-strong">
              {t('specsHeading')}
            </h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
              <dt className="text-text-muted">{t('specDimensions')}</dt>
              <dd className="font-mono text-text-strong">{formatDimensions(product.dimensions)}</dd>
              <dt className="text-text-muted">{t('specMaterial')}</dt>
              <dd className="text-text-strong">{product.material}</dd>
            </dl>
          </section>
        </div>
      </div>
    </article>
  );
}
