import { forwardRef, type HTMLAttributes } from 'react';
import { formatVnd } from '@lumin/core';
import { cn } from './lib/cn';

export interface PriceTagProps extends HTMLAttributes<HTMLSpanElement> {
  /** Current price in int VND (or the unit the supplied `formatValue` expects). */
  amount: number;
  /** Original/struck price in int VND; only rendered when greater than `amount`. */
  compareAt?: number;
  /**
   * Formatter for both prices. Defaults to @lumin/core's `formatVnd` (VND, e.g. `390.000₫`).
   * Pass a caller-supplied formatter for other currencies — never call Intl here (ADR-019).
   */
  formatValue?: (amount: number) => string;
}

/**
 * Price in the mono face + dark-coral ink with an optional struck compare-at — the storefront hi-fi
 * renders every price as Space Mono `#C93A1A` (flame-700 = `text-primary`, the AA-safe coral).
 * Money is formatted ONLY via @lumin/core's `formatVnd` by default — the `formatValue` prop is the
 * single escape hatch for other currencies; this component never touches Intl/toLocaleString.
 */
export const PriceTag = forwardRef<HTMLSpanElement, PriceTagProps>(function PriceTag(
  { className, amount, compareAt, formatValue = formatVnd, ...props },
  ref,
) {
  const showCompareAt = compareAt !== undefined && compareAt > amount;
  return (
    <span ref={ref} className={cn('font-mono font-bold text-primary', className)} {...props}>
      {formatValue(amount)}
      {showCompareAt ? (
        <span className="line-through text-text-muted font-normal text-sm ml-2">
          {formatValue(compareAt)}
        </span>
      ) : null}
    </span>
  );
});
