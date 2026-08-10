'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { formatVnd, formatVnNumber, formatVnRating } from '@lumin/core';
import { Button, IconButton, PriceTag, QuantityStepper, cn } from '@lumin/ui';
import { buildCartItem, MAX_QUANTITY } from '@/lib/cart';
import { useCart } from '@/lib/cart-store';
import { formatDimensions, type ProductDetailView } from '@/lib/product-view';
import { ConfiguratorFields, useConfiguratorState } from './product-configurator';
import { BagIcon, CheckIcon } from './icons';
import { Model3dViewer } from './model-3d-viewer';

/**
 * Product detail (/san-pham/{slug}). Data is fetched server-side (page.tsx → lib/catalog) and passed in;
 * this is a client component for the local selection state only. Scope (P1-h + ADR-037): media + name +
 * price + rating + description + specs + a configurator — either a flat colour picker OR one picker per
 * named part (partColors), plus enumerated choice-options (optionChoices, e.g. size S/M/L — hi-fi PILLS),
 * engraving fields, and boolean toggle add-ons. The "Thêm vào giỏ" CTA is LOCKED until the whole selection
 * is valid (every part coloured, every enumerated option picked, every engraving within its limit) —
 * mirroring the server's pricing 422s so the client never lets a shopper add something POST /price/quote
 * would reject.
 *
 * Layout follows the hi-fi detail screens: breadcrumb (desktop) / mono category eyebrow (mobile), name,
 * price row with the compact "★ 4,9 · 32 đánh giá", the short description directly under it, then the
 * configurator, stepper + pop CTA, and the spec chips.
 *
 * Money: displays basePrice via PriceTag/@lumin/core only — never sums basePrice + colour/option/choice
 * deltas on the client (conventions §Tiền: tổng tính ở server; the live per-selection total is POST
 * /price/quote in the cart). It imports the VIEW TYPE + pure helpers, never lib/catalog, so the
 * server-only client stays out of the bundle.
 */
export function ProductDetail({
  product,
  category,
}: {
  product: ProductDetailView;
  /** Resolved category (for the hi-fi breadcrumb "Trang chủ / {danh mục} / {tên}"); null when the
   *  categories fetch didn't include the product's category (breadcrumb then skips the middle crumb). */
  category?: { name: string; slug: string } | null;
}) {
  const t = useTranslations('productDetail');
  const tp = useTranslations('product');
  const tNav = useTranslations('nav');

  // The main media tile: null = the live 3D viewer (the default when the product has a model — user
  // decision 2026-07-17: 3D first, auto-loaded), a number = that gallery photo shown large.
  const [activeImage, setActiveImage] = useState<number | null>(product.model3dUrl ? null : 0);
  // Line quantity for the add (hi-fi: −/+ stepper beside the CTA); merged into the cart line's qty.
  const [quantity, setQuantity] = useState(1);

  // The ADR-037 configurator state machine (colour/parts/choices/engrave) — shared with the cart edit
  // dialog (PR D) via product-configurator.tsx, so "what counts as a valid selection" lives in ONE place.
  const cfg = useConfiguratorState(product);

  const router = useRouter();
  const { add } = useCart();

  const cover = product.images[activeImage ?? 0];
  const show3d = Boolean(product.model3dUrl) && activeImage === null;
  const anyPriceDelta = cfg.anyPriceDelta;

  // Add the current selection to the cart and stay on the PDP (the cart badge/qty reflects the add —
  // no reason to interrupt a shopper who may want to keep configuring or add more). The Selection is
  // snapshot-shaped by buildCartItem (no price — the cart re-prices via POST /price/quote); the button is
  // disabled unless `canAdd`, so this only fires on a valid selection. A parts product sends colorId=null
  // (its colours ride on partColors — sending both 422s the server). The guard is belt-and-braces against
  // a programmatic click.
  const addCurrentSelectionToCart = () => {
    if (!cfg.canAdd) return false;
    add({
      ...buildCartItem(product, {
        colorId: cfg.hasParts ? null : cfg.selectedColorId,
        choiceIds: cfg.selectedChoiceIds,
        engraveTexts: cfg.engraveTexts,
        partColorByPart: cfg.partColorByPart,
        choiceByOption: cfg.choiceByOption,
      }),
      // The stepper's qty rides the snapshot; the store clamps it into 1..MAX_QUANTITY on merge.
      quantity,
    });
    return true;
  };
  // Brief "Đã thêm ✓" confirmation on the add-to-cart CTAs (the cart badge already reflects the add,
  // but a shopper staring at the same PDP needs its own feedback). Purely a swapped label/icon — no
  // motion beyond the existing hover/focus transitions, so prefers-reduced-motion needs no special case.
  const [justAdded, setJustAdded] = useState(false);
  useEffect(() => {
    if (!justAdded) return;
    const timer = setTimeout(() => setJustAdded(false), 1500);
    return () => clearTimeout(timer);
  }, [justAdded]);
  const handleAddToCart = () => {
    if (addCurrentSelectionToCart()) setJustAdded(true);
  };
  // Buy now: same add, then straight to checkout instead of staying on the PDP.
  const handleBuyNow = () => {
    if (addCurrentSelectionToCart()) router.push('/thanh-toan');
  };

  return (
    <article className="mx-auto w-full max-w-[1200px] px-4 py-6 md:px-6 md:py-10">
      {/* Hi-fi breadcrumb: mono, with the category as the middle crumb linking back into the filtered
          catalog. Desktop-only — the hi-fi mobile detail has no breadcrumb; the mono category eyebrow
          above the name (below) carries the context there. */}
      <nav
        aria-label={t('breadcrumbLabel')}
        className="mb-4 hidden font-mono text-xs text-text-muted md:block"
      >
        <Link href="/" className="hover:underline">
          {tNav('home')}
        </Link>
        <span aria-hidden="true" className="px-2">
          /
        </span>
        {category ? (
          <>
            <Link
              href={`/danh-muc?category=${encodeURIComponent(category.slug)}`}
              className="hover:underline"
            >
              {category.name}
            </Link>
            <span aria-hidden="true" className="px-2">
              /
            </span>
          </>
        ) : null}
        <span aria-current="page" className="text-text-strong">
          {product.name}
        </span>
      </nav>

      <div className="flex flex-col gap-8 md:flex-row md:gap-9">
        {/* Media (revised 2026-07-17): the MAIN tile is the live 3D viewer when the product has a model
            (auto-loaded; interactive; recoloured live by the colour selection). No WebGL → 360° sprite
            (ADR-049), else the static cover. The real photos sit below as thumbnails — clicking one shows
            it large in the main tile; the dashed "360°" thumb returns to the viewer. */}
        {/* md:sticky (PR G) — colouring a part meant scrolling back up to see the model react; the info
            column runs longer than the media column, so pinning media at a fixed offset keeps the model
            in view the whole time the shopper is picking colour/options below. top-24 clears the sticky
            site header. */}
        <div className="md:sticky md:top-24 md:w-[460px] md:shrink-0 md:self-start">
          <div className="relative aspect-square overflow-hidden rounded-lg border-2 border-border-strong bg-surface-sunken">
            {show3d ? (
              <>
                <Model3dViewer
                  src={product.model3dStructuredUrl || product.model3dUrl!}
                  productName={product.name}
                  spriteSheetUrl={product.spriteSheetUrl}
                  partColors={cfg.viewerPartColors}
                  flatColorHex={cfg.flatColorHex}
                  engravings={cfg.viewerEngravings}
                  model3dView={product.model3dView}
                  fallback={
                    cover ? (
                      <img src={cover} alt={product.name} className="h-full w-full object-cover" />
                    ) : (
                      <div className="lumin-dotgrid h-full w-full" aria-hidden="true" />
                    )
                  }
                />
                {/* Hi-fi: coral "Realtime 3D" pill on the media tile while the viewer is up. */}
                <span className="pointer-events-none absolute right-3 top-3 rounded-pill bg-primary px-3 py-1 font-mono text-[10px] font-bold text-on-primary">
                  {t('realtime3dBadge')}
                </span>
              </>
            ) : cover ? (
              // Arbitrary shop-photo hosts → a plain <img> (no next/image remotePatterns to maintain),
              // matching @lumin/ui ProductCard. Alt = product name (jsx-a11y).
              <img src={cover} alt={product.name} className="h-full w-full object-cover" />
            ) : (
              <div className="lumin-dotgrid h-full w-full" aria-hidden="true" />
            )}
          </div>

          {(product.model3dUrl && product.images.length > 0) || product.images.length > 1 ? (
            <ul className="mt-3 flex flex-wrap gap-2">
              {product.model3dUrl ? (
                <li>
                  {/* Back-to-3D thumb — the hi-fi dashed mono "360°" square, now a gallery peer. */}
                  <button
                    type="button"
                    aria-label={t('view3dLabel')}
                    aria-current={activeImage === null}
                    onClick={() => setActiveImage(null)}
                    className={cn(
                      'grid h-[72px] w-[72px] place-items-center rounded-sm border-2 border-dashed font-mono text-[11px] font-bold',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky focus-visible:ring-offset-2',
                      activeImage === null
                        ? 'border-border-strong text-text-strong'
                        : 'border-border-default text-text-muted hover:border-border-strong hover:text-text-strong',
                    )}
                  >
                    {t('view3dTile')}
                  </button>
                </li>
              ) : null}
              {product.images.map((src, i) => (
                <li key={src}>
                  <button
                    type="button"
                    aria-label={t('galleryThumbLabel', { index: i + 1 })}
                    aria-current={i === activeImage}
                    onClick={() => setActiveImage(i)}
                    className={cn(
                      'h-[72px] w-[72px] overflow-hidden rounded-sm border-2',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky focus-visible:ring-offset-2',
                      i === activeImage ? 'border-border-strong' : 'border-border-subtle',
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
          <div>
            {/* Hi-fi mobile eyebrow: mono category above the name (the breadcrumb is desktop-only). */}
            {category ? (
              <p className="mb-1 font-mono text-[11px] uppercase tracking-wider text-text-muted md:hidden">
                {category.name}
              </p>
            ) : null}
            <h1 className="font-display text-2xl font-bold leading-tight text-text-strong md:text-3xl">
              {product.name}
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <PriceTag amount={product.basePrice} className="text-lg" />
            {product.rating != null ? (
              // Hi-fi price row: compact "★ 4,9 · 32 đánh giá" (the 5-star blocks live in the reviews
              // section below). Both numbers format through @lumin/core only.
              <span
                role="img"
                aria-label={tp('ratingLabel', { value: formatVnRating(product.rating) })}
                className="text-xs font-bold text-text-muted"
              >
                {t('ratingSummary', {
                  value: formatVnRating(product.rating),
                  count: formatVnNumber(product.reviewCount),
                })}
              </span>
            ) : (
              <span className="text-sm text-text-muted">{t('noReviews')}</span>
            )}
          </div>

          {anyPriceDelta ? <p className="text-sm text-text-muted">{t('priceNote')}</p> : null}

          {/* Colour/parts/choices/engrave/toggle configurator (ADR-037) — shared markup with the cart
              edit dialog via ConfiguratorFields (PR D), so a swatch, a pill or an engrave field looks and
              behaves identically wherever it's rendered. Hi-fi order: configurator sits right under the
              price row (shortest tap-to-buy on mobile); the description reads after the CTA. */}
          <ConfiguratorFields product={product} state={cfg} idPrefix="detail" />

          {/* Add-to-cart: qty stepper + the pop CTA (hi-fi: "Thêm vào giỏ · 290.000₫"). Locked until the
              whole selection is valid (colour/parts + enumerated choices + every engraving in-limit). On
              click it snapshots the selection into the cart and stays on the PDP ("Mua ngay" adds then
              goes straight to /thanh-toan). The hint names the
              first unmet axis (engrave errors surface on the field itself). `fixed` (not `sticky`) above
              the mobile tab bar (storefront rule: add-to-cart dính đáy trên mobile) — this component
              renders above ProductReviews too (page.tsx), and `position:sticky`'s stuck region is bounded
              by its own parent box, so it would unstick once the info column ends, well before the
              reviews section below it; `fixed` keeps buy-intent reachable while reading reviews, matching
              the hi-fi's persistent bottom bar. Corresponding bottom clearance for content is reserved at
              the page level (page.tsx) so nothing renders underneath it. Solid footer flush against
              BottomNav (bottom-nav.tsx — 56px min-height row + border ≈ 60px). The CTA shows the UNIT
              base price only while qty = 1 — the client never multiplies money (conventions §Tiền); the
              real total lands with the cart's server quote. */}
          <div className="fixed inset-x-0 bottom-[60px] z-30 border-t-2 border-border-default bg-surface-card px-4 pb-3.5 pt-[11px] md:static md:inset-auto md:border-0 md:bg-transparent md:p-0">
            <div className="flex items-center gap-2 sm:gap-3">
              {/* Hi-fi "Tổng / giá" block, mobile only — desktop CTA already carries its own price. Base
                  price only (never client-multiplied); "từ" prefix when the pick can still change the
                  total (an option delta, or qty > 1). */}
              <div className="mr-1 flex flex-col sm:hidden">
                <span className="font-mono text-[10px] uppercase tracking-wide text-text-muted">
                  {t('stickyTotalLabel')}
                </span>
                <span className="flex items-baseline gap-1">
                  {anyPriceDelta || quantity > 1 ? (
                    <span className="text-xs text-text-muted">{t('stickyFromPrice')}</span>
                  ) : null}
                  <PriceTag amount={product.basePrice} className="text-base" />
                </span>
              </div>
              <QuantityStepper
                value={quantity}
                onChange={setQuantity}
                min={1}
                max={MAX_QUANTITY}
                decrementLabel={t('qtyDecrement')}
                incrementLabel={t('qtyIncrement')}
                className="shrink-0"
              />
              {/* Mobile: icon-only add-to-cart (BagIcon) so it never competes for width against "Mua ngay" —
                  the full label + price returns from sm: up where there's room. */}
              <IconButton
                variant="soft"
                size="lg"
                label={justAdded ? tp('added') : tp('add')}
                disabled={!cfg.canAdd}
                onClick={handleAddToCart}
                className="shrink-0 sm:hidden"
              >
                {justAdded ? <CheckIcon aria-hidden="true" /> : <BagIcon aria-hidden="true" />}
              </IconButton>
              <Button
                variant="outline"
                size="lg"
                disabled={!cfg.canAdd}
                onClick={handleAddToCart}
                className="hidden min-w-0 sm:flex sm:flex-none"
              >
                {justAdded ? (
                  <>
                    <CheckIcon aria-hidden="true" className="h-4 w-4" />
                    {tp('added')}
                  </>
                ) : quantity === 1 ? (
                  <>
                    {tp('add')}
                    <span aria-hidden="true"> · </span>
                    <span className="font-mono">{formatVnd(product.basePrice)}</span>
                  </>
                ) : (
                  tp('add')
                )}
              </Button>
              <Button
                variant="pop"
                size="lg"
                disabled={!cfg.canAdd}
                onClick={handleBuyNow}
                className="min-w-0 flex-1 sm:flex-none"
              >
                {tp('buyNow')}
              </Button>
            </div>
            {!cfg.canAdd && !cfg.colorOk && (cfg.hasColors || cfg.hasParts) ? (
              <p className="mt-2 text-sm text-text-muted">{t('pickColorHint')}</p>
            ) : !cfg.canAdd && cfg.colorOk && !cfg.choicesOk ? (
              <p className="mt-2 text-sm text-text-muted">{t('pickChoiceHint')}</p>
            ) : null}
          </div>

          {/* Hi-fi: the short description reads after the CTA, above specs. */}
          <p className="max-w-[440px] whitespace-pre-line text-sm leading-relaxed text-text-muted">
            {product.description}
          </p>

          {/* Hi-fi "Thông số": key/value list with dividers (replaces the old spec-chip tiles — same
              data, closer to the hi-fi's dl presentation). Lead-time + shipping rows carry the teal
              made-to-order trust signal. */}
          <section aria-label={t('specsHeading')}>
            <dl className="divide-y divide-border-subtle border-y border-border-subtle">
              <div className="flex items-center justify-between py-2.5">
                <dt className="font-mono text-[11px] uppercase tracking-wide text-text-muted">
                  {t('specMaterial')}
                </dt>
                <dd className="text-sm font-semibold text-text-strong">{product.material}</dd>
              </div>
              <div className="flex items-center justify-between py-2.5">
                <dt className="font-mono text-[11px] uppercase tracking-wide text-text-muted">
                  {t('specDimensions')}
                </dt>
                <dd className="font-mono text-sm font-semibold text-text-strong">
                  {formatDimensions(product.dimensions)}
                </dd>
              </div>
              <div className="flex items-center justify-between py-2.5">
                <dt className="font-mono text-[11px] uppercase tracking-wide text-text-muted">
                  {t('leadTimeLabel')}
                </dt>
                <dd className="text-sm font-semibold text-accent-teal">{t('leadTimeValue')}</dd>
              </div>
              <div className="flex items-center justify-between py-2.5">
                <dt className="font-mono text-[11px] uppercase tracking-wide text-text-muted">
                  {t('shippingLabel')}
                </dt>
                <dd className="text-sm font-semibold text-text-strong">{t('shippingValue')}</dd>
              </div>
            </dl>
          </section>
        </div>
      </div>
    </article>
  );
}
