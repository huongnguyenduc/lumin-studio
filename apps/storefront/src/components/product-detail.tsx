'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button, PriceTag, Rating, cn } from '@lumin/ui';
import { buildCartItem } from '@/lib/cart';
import { useCart } from '@/lib/cart-store';
import {
  allChoicesSelected,
  allPartsSelected,
  canAddConfiguredToCart,
  canAddToCart,
  colorsForPart,
  partColorsForViewer,
  formatDimensions,
  isColorSelectable,
  type ColorView,
  type ProductDetailView,
} from '@/lib/product-view';
import { EngraveField } from './engrave-field';
import { Model3dViewer } from './model-3d-viewer';

/**
 * One labelled group of colour swatches. Reused (ADR-037) for BOTH the flat product colour picker and
 * each named part's own colour set — a parts product renders one of these per part. Out-of-stock swatches
 * (available:false) render disabled + struck-through and can never be selected, so the add-to-cart gate
 * never unlocks on one. `labelFor` is built by the parent (where next-intl's `t` is precisely typed), so
 * this component stays translator-agnostic. Pure presentation — the parent owns the selection state.
 */
function ColorSwatches({
  heading,
  headingId,
  colors,
  selectedId,
  onSelect,
  labelFor,
  outOfStockNote,
}: {
  heading: string;
  headingId: string;
  colors: ColorView[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  labelFor: (color: ColorView) => string;
  outOfStockNote: string;
}) {
  const anyUnavailable = colors.some((c) => !c.available);
  return (
    <div role="group" aria-labelledby={headingId}>
      <h2 id={headingId} className="mb-2 font-display text-sm font-semibold text-text-strong">
        {heading}
      </h2>
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
 * named part (partColors), plus enumerated choice-options (optionChoices, e.g. size S/M/L), engraving
 * fields, and boolean toggle add-ons. The "Thêm vào giỏ" CTA is LOCKED until the whole selection is valid
 * (every part coloured, every enumerated option picked, every engraving within its limit) — mirroring the
 * server's pricing 422s so the client never lets a shopper add something POST /price/quote would reject.
 *
 * Money: displays basePrice via PriceTag/@lumin/core only — never sums basePrice + colour/option/choice
 * deltas on the client (conventions §Tiền: tổng tính ở server; the live per-selection total is POST
 * /price/quote in the cart). It imports the VIEW TYPE + pure helpers, never lib/catalog, so the
 * server-only client stays out of the bundle.
 */
export function ProductDetail({ product }: { product: ProductDetailView }) {
  const t = useTranslations('productDetail');
  const tp = useTranslations('product');
  const tNav = useTranslations('nav');
  const tErr = useTranslations('core.errors');

  const [activeImage, setActiveImage] = useState(0);
  // Flat colour (single-piece product). A parts product leaves this null and uses partColorByPart.
  const [selectedColorId, setSelectedColorId] = useState<string | null>(null);
  // ADR-037: one colour per named part ({partId → colorId}); one choice per enumerated choice-option
  // ({optionId → choiceId}). Engraving text per text-option id; toggle add-on ids that are switched on.
  const [partColorByPart, setPartColorByPart] = useState<Record<string, string>>({});
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

  const cover = product.images[activeImage];
  const hasParts = product.parts.length > 0;
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

  const toggleChoice = (id: string) =>
    setSelectedChoiceIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  // Add the current selection to the cart, then send the shopper to /gio-hang. The Selection is
  // snapshot-shaped by buildCartItem (no price — the cart re-prices via POST /price/quote); the button is
  // disabled unless `canAdd`, so this only fires on a valid selection. A parts product sends colorId=null
  // (its colours ride on partColors — sending both 422s the server). The guard is belt-and-braces against
  // a programmatic click.
  const handleAddToCart = () => {
    if (!canAdd) return;
    add(
      buildCartItem(product, {
        colorId: hasParts ? null : selectedColorId,
        choiceIds: selectedChoiceIds,
        engraveTexts,
        partColorByPart,
        choiceByOption,
      }),
    );
    router.push('/gio-hang');
  };

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
        {/* Media — static cover + thumbnail gallery, then the on-demand 3D viewer (P1-i) when present.
            The viewer's no-WebGL fallback is the 360° sprite sheet (ADR-049) when the product has one; the
            card-hover turntable lives on the grid card (CatalogCard), not here. */}
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

          {/* On-demand 3D viewer (P1-i). Only rendered when the product has a .glb; the component itself
              loads model-viewer on click and hides itself when WebGL is unavailable. */}
          {product.model3dUrl ? (
            <Model3dViewer
              src={product.model3dStructuredUrl || product.model3dUrl}
              productName={product.name}
              spriteSheetUrl={product.spriteSheetUrl}
              partColors={viewerPartColors}
            />
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

          {/* Colour picker (ADR-037). A parts product renders one swatch group per named part (the
              customer picks one colour per part → partColors); a single-piece product renders the flat
              picker. Out-of-stock swatches are disabled → the CTA can never unlock on one. */}
          {hasParts ? (
            product.parts.map((part) => (
              <ColorSwatches
                key={part.id}
                heading={part.name}
                headingId={`detail-part-${part.id}-heading`}
                colors={colorsForPart(product.colors, part.id)}
                selectedId={partColorByPart[part.id] ?? null}
                onSelect={(id) => setPartColorByPart((prev) => ({ ...prev, [part.id]: id }))}
                labelFor={colorLabel}
                outOfStockNote={tErr('colorOutOfStock')}
              />
            ))
          ) : hasColors ? (
            <ColorSwatches
              heading={t('colorsLabel')}
              headingId="detail-colors-heading"
              colors={product.colors}
              selectedId={selectedColorId}
              onSelect={setSelectedColorId}
              labelFor={colorLabel}
              outOfStockNote={tErr('colorOutOfStock')}
            />
          ) : null}

          {/* Enumerated choice-options (ADR-037), e.g. size S/M/L — a native radio group per option (one
              pick required). Native radios give arrow-key selection + one-per-group semantics for free;
              the visual swatch is a struck-in custom control over the sr-only input (same pattern as the
              toggle checkbox below). Priced server-side by the picked choice's delta (option base ignored). */}
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
                <ul className="flex flex-col gap-1">
                  {o.choices.map((ch) => {
                    const checked = choiceByOption[o.id] === ch.id;
                    const descId = `${groupName}-${ch.id}-desc`;
                    return (
                      <li key={ch.id}>
                        <label className="flex min-h-11 cursor-pointer items-center gap-3">
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
                            aria-hidden="true"
                            className={cn(
                              'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-border-strong bg-surface-card',
                              'transition-[border-color] duration-150 ease-out motion-reduce:transition-none',
                              'peer-checked:border-primary peer-checked:[&>span]:opacity-100',
                              'peer-focus-visible:ring-2 peer-focus-visible:ring-accent-sky peer-focus-visible:ring-offset-2',
                            )}
                          >
                            <span className="h-2.5 w-2.5 rounded-full bg-primary opacity-0 transition-opacity duration-150 ease-out motion-reduce:transition-none" />
                          </span>
                          <span className="flex-1 text-text-body">{ch.label}</span>
                          {ch.priceDelta > 0 ? (
                            <span className="text-sm text-text-muted">
                              +<PriceTag amount={ch.priceDelta} className="text-sm font-medium" />
                            </span>
                          ) : (
                            <span className="text-sm text-accent-teal">{t('optionFree')}</span>
                          )}
                        </label>
                        {ch.description ? (
                          <p id={descId} className="ml-8 text-sm text-text-muted">
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

          {/* Add-to-cart: locked until the whole selection is valid (colour/parts + enumerated choices +
              every engraving in-limit). On click it snapshots the selection into the cart and navigates to
              /gio-hang. The hint names the first unmet axis (engrave errors surface on the field itself). */}
          <div>
            <Button
              variant="pop"
              size="lg"
              disabled={!canAdd}
              onClick={handleAddToCart}
              className="w-full md:w-auto"
            >
              {tp('add')}
            </Button>
            {!canAdd && !colorOk && (hasColors || hasParts) ? (
              <p className="mt-2 text-sm text-text-muted">{t('pickColorHint')}</p>
            ) : !canAdd && colorOk && !choicesOk ? (
              <p className="mt-2 text-sm text-text-muted">{t('pickChoiceHint')}</p>
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
