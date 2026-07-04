'use client';

import { useId } from 'react';
import { useTranslations } from 'next-intl';
import { Input, PriceTag, cn } from '@lumin/ui';
import { engraveLength, isEngraveWithinLimit, type OptionView } from '@/lib/product-view';

/**
 * Engraving field for one `text`-type option (P1-j). Controlled — the parent ProductDetail owns the
 * value so the add-to-cart lock (canAddToCartWithOptions) can see every engraving. Renders:
 *  - a labelled text input (reuses the vetted @lumin/ui Input for focus ring + error/alert wiring),
 *  - a live "nameplate" PREVIEW of the typed text (the design overlays it on a draggable 3D orb — that
 *    orb + the VỊ TRÍ zone picker are P1-i; here a static preview keeps it robust across shop photos),
 *  - a live rune COUNTER that mirrors the server (engraveLength = code points, plan §3),
 *  - an over-limit ERROR that mirrors POST /price/quote's 422 (isEngraveWithinLimit).
 * No money is summed here — a surcharge (priceDelta > 0) is shown via PriceTag/@lumin/core; the live
 * per-selection total is server-authoritative and lands with the cart (P1-k). No zoneId UI (§5 DROP:
 * the server accepts zoneId free-form and validates only the text + rune limit).
 */
export function EngraveField({
  option,
  value,
  onChange,
}: {
  option: OptionView;
  value: string;
  onChange: (next: string) => void;
}) {
  const t = useTranslations('productDetail');
  const inputId = useId();

  const max = option.maxChars; // null → this text option sets no limit (counter + over-limit both off)
  const count = engraveLength(value);
  const overLimit = !isEngraveWithinLimit(value, max);
  // Empty → show the default placeholder text in the preview (muted), never an empty nameplate.
  const previewText = value.trim() === '' ? t('engravePreviewDefault') : value;

  return (
    <div>
      {/* Label row: the option's own label (catalog data) + free/surcharge marker. The <label htmlFor>
          names the input; the input carries no `label` prop of its own to avoid a duplicate. */}
      <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        <label htmlFor={inputId} className="font-display text-sm font-semibold text-text-strong">
          {option.label}
        </label>
        {option.priceDelta > 0 ? (
          <span className="text-sm text-text-muted">
            +<PriceTag amount={option.priceDelta} className="text-sm font-medium" />
          </span>
        ) : (
          <span className="text-sm text-accent-teal">{t('engraveFree')}</span>
        )}
        {/* Visual counter (turns danger over-limit). aria-hidden: the count is a sighted affordance —
            an aria-label here would be ARIA-prohibited on a generic span AND would mask the number; AT
            instead gets the limit via the Input `hint` and the over-limit via the Input `error` alert
            (both natively associated by the primitive). Only shown when the option sets a limit. */}
        {max != null ? (
          <span
            aria-hidden="true"
            className={cn(
              'ml-auto font-mono text-xs',
              overLimit ? 'font-semibold text-danger' : 'text-text-muted',
            )}
          >
            {t('engraveCounter', { count, max })}
          </span>
        ) : null}
      </div>

      {/* Live nameplate preview (decorative — duplicates the input, so aria-hidden to avoid a double
          announcement). Subtle transition disabled under prefers-reduced-motion. */}
      <div
        aria-hidden="true"
        className="mb-2 flex min-h-[52px] items-center justify-center rounded-md border border-border-default bg-surface-sunken px-4"
      >
        <span
          className={
            'font-display text-lg font-bold tracking-wide transition-colors duration-150 ease-out motion-reduce:transition-none ' +
            (value.trim() === '' ? 'text-text-muted' : 'text-text-strong')
          }
        >
          {previewText}
        </span>
      </div>

      <Input
        id={inputId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t('engravePlaceholder')}
        // The limit (hint) and the over-limit alert (error) are wired to the field by the Input
        // primitive itself (its own aria-describedby → the message <p>); passing our own
        // aria-describedby here would clobber that. error replaces hint when over-limit.
        hint={max != null ? t('engraveHint', { max }) : undefined}
        error={overLimit ? t('engraveTooLong', { max: max ?? 0 }) : undefined}
      />
    </div>
  );
}
