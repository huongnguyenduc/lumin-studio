'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { formatVnd, formatVnNumber, formatVnRating } from '@lumin/core';
import { Button, IconButton, PriceTag, QuantityStepper, cn } from '@lumin/ui';
import { buildCartItem, MAX_QUANTITY } from '@/lib/cart';
import { useCart } from '@/lib/cart-store';
import {
  allChoicesSelected,
  allPartsSelected,
  canAddConfiguredToCart,
  canAddToCart,
  colorsForPart,
  defaultFlatColorId,
  defaultPartColors,
  partColorsForViewer,
  formatDimensions,
  isColorSelectable,
  type ColorView,
  type ProductDetailView,
} from '@/lib/product-view';
import { EngraveField } from './engrave-field';
import { BagIcon, CheckIcon } from './icons';
import { Model3dViewer } from './model-3d-viewer';

/**
 * One labelled group of colour swatches. Reused (ADR-037) for BOTH the flat product colour picker and
 * each named part's own colour set — a parts product renders one of these per part. Out-of-stock swatches
 * (available:false) render disabled + struck-through and can never be selected, so the add-to-cart gate
 * never unlocks on one. `labelFor` is built by the parent (where next-intl's `t` is precisely typed), so
 * this component stays translator-agnostic. `selectedNote` is the hi-fi mono caption beside the dots
 * ("Cam Mochi · +5 màu") — pre-built by the parent for the same reason. Pure presentation — the parent
 * owns the selection state.
 */
function ColorSwatches({
  heading,
  headingId,
  colors,
  selectedId,
  onSelect,
  labelFor,
  outOfStockNote,
  selectedNote,
}: {
  heading: string;
  headingId: string;
  colors: ColorView[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  labelFor: (color: ColorView) => string;
  outOfStockNote: string;
  selectedNote: string | null;
}) {
  const anyUnavailable = colors.some((c) => !c.available);
  return (
    <div role="group" aria-labelledby={headingId}>
      <h2 id={headingId} className="mb-2 font-display text-sm font-semibold text-text-strong">
        {heading}
      </h2>
      <div className="flex flex-wrap items-center gap-3">
        <ul className="flex flex-wrap gap-3">
          {colors.map((c) => {
            const selectable = isColorSelectable(c);
            const selected = c.id === selectedId;
            return (
              <li key={c.id}>
                <button
                  type="button"
                  disabled={!selectable}
                  aria-pressed={selectable ? selected : undefined}
                  aria-label={labelFor(c)}
                  onClick={() => onSelect(c.id)}
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
                    // Diagonal strike (CSS, no glyph) marks the out-of-stock swatch; the disabled state +
                    // aria-label carry the meaning for AT.
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
        {/* Hi-fi: mono caption naming the picked colour, inline with the dots. aria-hidden — the
            selected swatch already announces itself via aria-pressed + aria-label. */}
        {selectedNote ? (
          <span aria-hidden="true" className="font-mono text-xs text-text-muted">
            {selectedNote}
          </span>
        ) : null}
      </div>
      {/* Spec §05-mandated copy (SF-04). Out-of-stock swatches are disabled → un-selectable, so this is a
          standing note explaining the dimmed swatches rather than a per-selection error. */}
      {anyUnavailable ? (
        <p role="note" className="mt-2 text-sm text-text-muted">
          {outOfStockNote}
        </p>
      ) : null}
    </div>
  );
}

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
  const tErr = useTranslations('core.errors');

  // The main media tile: null = the live 3D viewer (the default when the product has a model — user
  // decision 2026-07-17: 3D first, auto-loaded), a number = that gallery photo shown large.
  const [activeImage, setActiveImage] = useState<number | null>(product.model3dUrl ? null : 0);
  // Line quantity for the add (hi-fi: −/+ stepper beside the CTA); merged into the cart line's qty.
  const [quantity, setQuantity] = useState(1);
  // Flat colour (single-piece product) — pre-selected to the first available colour (2026-07-17) so the
  // viewer opens coloured. A parts product leaves this null and uses partColorByPart.
  const [selectedColorId, setSelectedColorId] = useState<string | null>(() =>
    product.parts.length > 0 ? null : defaultFlatColorId(product.colors),
  );
  // ADR-037: one colour per named part ({partId → colorId}) — each part pre-selected to its first
  // available colour (2026-07-17); one choice per enumerated choice-option ({optionId → choiceId}).
  // Engraving text per text-option id; toggle add-on ids that are switched on.
  const [partColorByPart, setPartColorByPart] = useState<Record<string, string>>(() =>
    defaultPartColors(product.parts, product.colors),
  );
  const [choiceByOption, setChoiceByOption] = useState<Record<string, string>>({});
  const [engraveTexts, setEngraveTexts] = useState<Record<string, string>>({});
  const [selectedChoiceIds, setSelectedChoiceIds] = useState<string[]>([]);

  // f-3 (ADR-052): the {objectName → hex} map the live 3D viewer applies. Memoised so the viewer's recolor
  // effect only re-runs when the per-part selection changes, not on every unrelated re-render (e.g. activeImage).
  const viewerPartColors = useMemo(
    () => partColorsForViewer(product.parts, product.colors, partColorByPart),
    [product.parts, product.colors, partColorByPart],
  );

  const router = useRouter();
  const { add } = useCart();

  const cover = product.images[activeImage ?? 0];
  const show3d = Boolean(product.model3dUrl) && activeImage === null;
  const hasParts = product.parts.length > 0;
  // Flat product live recolor (2026-07-17): the picked colour's hex tints the WHOLE model (no part→object
  // mapping exists for a single-piece product). A parts product uses viewerPartColors instead.
  const flatColorHex = hasParts
    ? undefined
    : product.colors.find((c) => c.id === selectedColorId)?.hex;
  const hasColors = product.colors.length > 0;
  const anyPriceDelta = product.colors.some((c) => c.priceDelta > 0);

  // Options split by kind (ADR-037): `text` → engrave fields; `choice` with no enumerated choices → a
  // boolean toggle (optionIds); `choice` with choices → an enumerated picker (optionChoices, pick one).
  const textOptions = product.options.filter((o) => o.type === 'text');
  const toggleOptions = product.options.filter(
    (o) => o.type === 'choice' && o.choices.length === 0,
  );
  const enumOptions = product.options.filter((o) => o.type === 'choice' && o.choices.length > 0);
  const engraveEntries = textOptions.map((o) => ({
    text: engraveTexts[o.id] ?? '',
    maxChars: o.maxChars,
  }));

  // The colour axis (flat lock OR every part coloured) and the enumerated-choice axis each drive a hint;
  // the composite lock (colour AND choices AND every engraving within its limit) drives the button. An
  // engrave error is surfaced by EngraveField itself.
  const colorOk = hasParts
    ? allPartsSelected(product.parts, product.colors, partColorByPart)
    : canAddToCart(selectedColorId, product.colors);
  const choicesOk = allChoicesSelected(product.options, choiceByOption);
  const canAdd = canAddConfiguredToCart({
    parts: product.parts,
    colors: product.colors,
    options: product.options,
    selectedColorId,
    partColorByPart,
    choiceByOption,
    engraveEntries,
  });

  const colorLabel = (c: ColorView) =>
    isColorSelectable(c)
      ? t('selectColorLabel', { name: c.name })
      : t('colorUnavailableLabel', { name: c.name });

  // The hi-fi "Cam Mochi · +5 màu" caption for one swatch group: the picked colour's name plus how many
  // other colours the group offers. Null until a colour is picked (the group renders no caption).
  const selectedNoteFor = (colors: ColorView[], selectedId: string | null) => {
    const selected = selectedId ? colors.find((c) => c.id === selectedId) : undefined;
    return selected
      ? t('colorSelectedNote', { name: selected.name, count: colors.length - 1 })
      : null;
  };

  const toggleChoice = (id: string) =>
    setSelectedChoiceIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  // Add the current selection to the cart and stay on the PDP (the cart badge/qty reflects the add —
  // no reason to interrupt a shopper who may want to keep configuring or add more). The Selection is
  // snapshot-shaped by buildCartItem (no price — the cart re-prices via POST /price/quote); the button is
  // disabled unless `canAdd`, so this only fires on a valid selection. A parts product sends colorId=null
  // (its colours ride on partColors — sending both 422s the server). The guard is belt-and-braces against
  // a programmatic click.
  const addCurrentSelectionToCart = () => {
    if (!canAdd) return false;
    add({
      ...buildCartItem(product, {
        colorId: hasParts ? null : selectedColorId,
        choiceIds: selectedChoiceIds,
        engraveTexts,
        partColorByPart,
        choiceByOption,
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
        <div className="md:w-[460px] md:shrink-0">
          <div className="relative aspect-square overflow-hidden rounded-lg border-2 border-border-strong bg-surface-sunken">
            {show3d ? (
              <>
                <Model3dViewer
                  src={product.model3dStructuredUrl || product.model3dUrl!}
                  productName={product.name}
                  spriteSheetUrl={product.spriteSheetUrl}
                  partColors={viewerPartColors}
                  flatColorHex={flatColorHex}
                  engraveText={textOptions[0] ? engraveTexts[textOptions[0].id] : undefined}
                  engraveAnchor={product.engraveAnchor}
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

          {/* Hi-fi: the short description sits directly under the price row (not below the fold). */}
          <p className="max-w-[440px] whitespace-pre-line text-sm leading-relaxed text-text-muted">
            {product.description}
          </p>

          {/* Colour picker (ADR-037). A parts product renders one swatch group per named part (the
              customer picks one colour per part → partColors); a single-piece product renders the flat
              picker. Out-of-stock swatches are disabled → the CTA can never unlock on one. */}
          {hasParts ? (
            product.parts.map((part) => {
              const partColors = colorsForPart(product.colors, part.id);
              return (
                <ColorSwatches
                  key={part.id}
                  heading={part.name}
                  headingId={`detail-part-${part.id}-heading`}
                  colors={partColors}
                  selectedId={partColorByPart[part.id] ?? null}
                  onSelect={(id) => setPartColorByPart((prev) => ({ ...prev, [part.id]: id }))}
                  labelFor={colorLabel}
                  outOfStockNote={tErr('colorOutOfStock')}
                  selectedNote={selectedNoteFor(partColors, partColorByPart[part.id] ?? null)}
                />
              );
            })
          ) : hasColors ? (
            <ColorSwatches
              heading={t('colorsLabel')}
              headingId="detail-colors-heading"
              colors={product.colors}
              selectedId={selectedColorId}
              onSelect={setSelectedColorId}
              labelFor={colorLabel}
              outOfStockNote={tErr('colorOutOfStock')}
              selectedNote={selectedNoteFor(product.colors, selectedColorId)}
            />
          ) : null}

          {/* Enumerated choice-options (ADR-037), e.g. size S/M/L — a native radio group per option (one
              pick required), rendered as the hi-fi PILL row (selected = cocoa fill, cream text). Native
              radios give arrow-key selection + one-per-group semantics for free; the pill is a styled
              custom control over the sr-only input. Priced server-side by the picked choice's delta
              (option base ignored) — a surcharge shows inside the pill via formatVnd (@lumin/core). */}
          {enumOptions.map((o) => {
            const groupName = `detail-choice-${o.id}`;
            return (
              <fieldset key={o.id}>
                <legend className="mb-2 font-display text-sm font-semibold text-text-strong">
                  {o.label}
                </legend>
                {o.description ? (
                  <p className="mb-2 text-sm text-text-muted">{o.description}</p>
                ) : null}
                <ul className="flex flex-wrap gap-2.5">
                  {o.choices.map((ch) => {
                    const checked = choiceByOption[o.id] === ch.id;
                    const descId = `${groupName}-${ch.id}-desc`;
                    return (
                      <li key={ch.id}>
                        <label className="cursor-pointer">
                          <input
                            type="radio"
                            name={groupName}
                            checked={checked}
                            onChange={() =>
                              setChoiceByOption((prev) => ({ ...prev, [o.id]: ch.id }))
                            }
                            aria-describedby={ch.description ? descId : undefined}
                            className="peer sr-only"
                          />
                          <span
                            className={cn(
                              'inline-flex min-h-11 items-center gap-1.5 rounded-sm border-2 border-border-default bg-surface-card px-5 py-2 text-[15px] font-semibold text-text-strong',
                              'transition-colors duration-150 ease-out motion-reduce:transition-none',
                              'peer-checked:border-border-strong peer-checked:bg-surface-brand peer-checked:text-on-dark',
                              'peer-focus-visible:ring-2 peer-focus-visible:ring-accent-sky peer-focus-visible:ring-offset-2',
                            )}
                          >
                            {ch.label}
                            {ch.priceDelta > 0 ? (
                              <span className="font-mono text-[11px] font-normal">
                                +{formatVnd(ch.priceDelta)}
                              </span>
                            ) : null}
                          </span>
                        </label>
                        {ch.description ? (
                          <p id={descId} className="mt-1 max-w-[220px] text-sm text-text-muted">
                            {ch.description}
                          </p>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </fieldset>
            );
          })}

          {/* Engraving (text options). Live preview + rune counter + over-limit block (P1-j). Each text
              option is independently counted against its own maxChars — realistically one per product. */}
          {textOptions.map((o) => (
            <EngraveField
              key={o.id}
              option={o}
              value={engraveTexts[o.id] ?? ''}
              onChange={(next) => setEngraveTexts((prev) => ({ ...prev, [o.id]: next }))}
            />
          ))}

          {/* Toggle add-on options (ADR-037: a `choice` option with NO enumerated choices). A boolean
              add-on (label + priceDelta); the live total lands with the cart quote. */}
          {toggleOptions.length > 0 ? (
            <div role="group" aria-labelledby="detail-options-heading">
              <h2
                id="detail-options-heading"
                className="mb-2 font-display text-sm font-semibold text-text-strong"
              >
                {t('optionsHeading')}
              </h2>
              <ul className="flex flex-col gap-1">
                {toggleOptions.map((o) => {
                  const checked = selectedChoiceIds.includes(o.id);
                  const descId = `detail-option-${o.id}-desc`;
                  return (
                    <li key={o.id}>
                      <label className="flex min-h-11 cursor-pointer items-center gap-3">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleChoice(o.id)}
                          aria-describedby={o.description ? descId : undefined}
                          className="peer sr-only"
                        />
                        <span
                          aria-hidden="true"
                          className={cn(
                            'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-xs border-2 border-border-strong bg-surface-card text-on-primary',
                            'transition-[background-color,border-color] duration-150 ease-out motion-reduce:transition-none',
                            'peer-checked:border-primary peer-checked:bg-primary peer-checked:[&_svg]:opacity-100',
                            'peer-focus-visible:ring-2 peer-focus-visible:ring-accent-sky peer-focus-visible:ring-offset-2',
                          )}
                        >
                          <svg
                            viewBox="0 0 16 16"
                            className="h-3.5 w-3.5 opacity-0"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={2.5}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M3 8.5l3.5 3.5L13 4.5" />
                          </svg>
                        </span>
                        <span className="flex-1 text-text-body">{o.label}</span>
                        {o.priceDelta > 0 ? (
                          <span className="text-sm text-text-muted">
                            +<PriceTag amount={o.priceDelta} className="text-sm font-medium" />
                          </span>
                        ) : (
                          <span className="text-sm text-accent-teal">{t('optionFree')}</span>
                        )}
                      </label>
                      {o.description ? (
                        <p id={descId} className="ml-8 text-sm text-text-muted">
                          {o.description}
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          {/* Add-to-cart: qty stepper + the pop CTA (hi-fi: "Thêm vào giỏ · 290.000₫"). Locked until the
              whole selection is valid (colour/parts + enumerated choices + every engraving in-limit). On
              click it snapshots the selection into the cart and stays on the PDP ("Mua ngay" adds then
              goes straight to /thanh-toan). The hint names the
              first unmet axis (engrave errors surface on the field itself). Sticky above the mobile tab
              bar (storefront rule: add-to-cart dính đáy trên mobile). The CTA shows the UNIT base price
              only while qty = 1 — the client never multiplies money (conventions §Tiền); the real total
              lands with the cart's server quote. */}
          <div className="sticky bottom-[76px] z-30 -mx-4 bg-surface-page/95 px-4 py-3 backdrop-blur-sm md:static md:z-auto md:m-0 md:bg-transparent md:p-0 md:backdrop-blur-none">
            <div className="flex items-center gap-2 sm:gap-3">
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
                disabled={!canAdd}
                onClick={handleAddToCart}
                className="shrink-0 sm:hidden"
              >
                {justAdded ? <CheckIcon aria-hidden="true" /> : <BagIcon aria-hidden="true" />}
              </IconButton>
              <Button
                variant="outline"
                size="lg"
                disabled={!canAdd}
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
                disabled={!canAdd}
                onClick={handleBuyNow}
                className="min-w-0 flex-1 sm:flex-none"
              >
                {tp('buyNow')}
              </Button>
            </div>
            {!canAdd && !colorOk && (hasColors || hasParts) ? (
              <p className="mt-2 text-sm text-text-muted">{t('pickColorHint')}</p>
            ) : !canAdd && colorOk && !choicesOk ? (
              <p className="mt-2 text-sm text-text-muted">{t('pickChoiceHint')}</p>
            ) : null}
          </div>

          {/* Hi-fi spec chips: VẬT LIỆU / SIZE / IN TRONG as small bordered tiles (replaces the old
              two-row "Thông số" dl — same data, the hi-fi presentation). */}
          <section aria-label={t('specsHeading')}>
            <ul className="flex flex-wrap gap-2">
              <li className="rounded-sm border border-border-default bg-surface-card px-3 py-2">
                <p className="font-mono text-[10px] uppercase tracking-wide text-text-muted">
                  {t('specMaterial')}
                </p>
                <p className="text-sm font-semibold text-text-strong">{product.material}</p>
              </li>
              <li className="rounded-sm border border-border-default bg-surface-card px-3 py-2">
                <p className="font-mono text-[10px] uppercase tracking-wide text-text-muted">
                  {t('specDimensions')}
                </p>
                <p className="font-mono text-sm font-semibold text-text-strong">
                  {formatDimensions(product.dimensions)}
                </p>
              </li>
              <li className="rounded-sm border border-accent-teal bg-accent-teal-soft px-3 py-2">
                <p className="font-mono text-[10px] uppercase tracking-wide text-text-muted">
                  {t('leadTimeLabel')}
                </p>
                <p className="text-sm font-semibold text-text-strong">{t('leadTimeValue')}</p>
              </li>
            </ul>
          </section>
        </div>
      </div>
    </article>
  );
}
