'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { PriceTag, QuantityStepper } from '@lumin/ui';
import { MAX_QUANTITY, type CartItem } from '@/lib/cart';

/** Pricing status for the line total: mirrors the cart page's quote state so a line shows the priced
 *  total, a skeleton while re-quoting, or a neutral dash if the quote failed (the error copy + retry
 *  live once, on the summary). */
export type LinePriceStatus = 'ok' | 'loading' | 'error';

type CartLineProps = {
  item: CartItem;
  /** Server-derived line total (raw int-VND), positionally supplied by the cart page; null until the
   *  first successful quote for this cart shape. */
  lineTotal: number | null;
  priceStatus: LinePriceStatus;
  /** The stepper reports the next quantity; 0 (decrement at 1) means remove — the page maps it. */
  onQuantityChange: (qty: number) => void;
};

/**
 * One cart line (design 05): thumbnail + name/summary, a −/+ quantity stepper, and the server-priced
 * line total. Money is rendered ONLY via PriceTag/@lumin/core (never summed here). The stepper floors
 * at 0 so decrementing the last unit removes the line ("GIẢM =1 → XOÁ"); at quantity 1 the − button's
 * accessible label becomes "remove {name}" so assistive tech announces the real effect.
 */
export function CartLine({ item, lineTotal, priceStatus, onQuantityChange }: CartLineProps) {
  const t = useTranslations('cart');

  // Summary line: colour · choice add-ons · engraving — only the parts that apply.
  const specParts = [
    item.colorName,
    ...item.optionLabels,
    item.engrave ? t('engraveSummary', { text: item.engrave.text }) : null,
  ].filter((p): p is string => Boolean(p));

  return (
    <li className="flex items-center gap-3 border-b border-border-subtle py-4 last:border-b-0">
      <Link
        href={`/san-pham/${item.slug}`}
        // The thumbnail wraps only the (decorative, alt="") image, so the link needs its OWN accessible
        // name — without it the anchor is an empty link (WCAG 2.4.4 / 4.1.2). The product name is that
        // name (mirrors product-detail.tsx's gallery-thumb pattern); the sibling name link stays too.
        aria-label={item.name}
        className="h-16 w-16 shrink-0 overflow-hidden rounded-md bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky focus-visible:ring-offset-2"
      >
        {item.imageSrc ? (
          // Arbitrary shop-photo hosts → a plain <img> (matches product-detail / ProductCard).
          <img src={item.imageSrc} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="lumin-dotgrid h-full w-full" aria-hidden="true" />
        )}
      </Link>

      <div className="min-w-0 flex-1">
        <Link
          href={`/san-pham/${item.slug}`}
          className="font-display font-semibold text-text-strong hover:underline"
        >
          {item.name}
        </Link>
        {specParts.length > 0 ? (
          <p className="mt-0.5 font-mono text-xs text-text-muted">{specParts.join(' · ')}</p>
        ) : null}

        <div className="mt-2 flex items-center justify-between gap-3">
          <QuantityStepper
            value={item.quantity}
            min={0}
            max={MAX_QUANTITY}
            onChange={onQuantityChange}
            decrementLabel={
              item.quantity <= 1 ? t('removeLabel', { name: item.name }) : t('decrementLabel')
            }
            incrementLabel={t('incrementLabel')}
          />

          {priceStatus === 'ok' && lineTotal !== null ? (
            <PriceTag amount={lineTotal} className="text-base" />
          ) : priceStatus === 'error' ? (
            <span className="text-sm text-text-muted">—</span>
          ) : (
            <span
              aria-hidden="true"
              className="inline-block h-5 w-20 animate-pulse rounded bg-surface-sunken motion-reduce:animate-none"
            />
          )}
        </div>
      </div>
    </li>
  );
}
