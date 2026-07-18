'use client';

import { forwardRef, type HTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { formatVnNumber } from '@lumin/core';
import { cn } from './lib/cn';

// HOUSE-STYLE REFERENCE (see Button.tsx): cva variants with explicit defaultVariants, forwardRef to the
// real DOM node, `className` through cn() LAST so callers can override, semantic token utilities only
// (text-accent-sun = filled sun-gold, text-border-default = empty hairline), a11y + motion-reduce, and
// NO hard-coded copy — every aria-label comes from a prop. Counts are formatted ONLY via @lumin/core
// (formatVnNumber) — never Intl/toLocaleString here (ADR-019, ESLint-enforced).
const STARS = [1, 2, 3, 4, 5] as const;

const star = cva('relative inline-flex leading-none select-none', {
  variants: {
    size: {
      sm: 'text-base',
      md: 'text-xl',
      lg: 'text-2xl',
    },
  },
  defaultVariants: { size: 'md' },
});

export interface RatingProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange'>, VariantProps<typeof star> {
  /** Rating from 0–5; may be fractional (e.g. 3.5 renders a half star). */
  value: number;
  /** Optional review count, rendered after the stars as `(1.234)` via @lumin/core grouping. */
  count?: number;
  /** When true, each star is a focusable button that fires `onRate(n)`. Default false. */
  interactive?: boolean;
  /** Called with the 1-based index of the clicked star when `interactive`. */
  onRate?: (value: number) => void;
  /** aria-label for the whole rating group (i18n string passed in, e.g. "đánh giá"). */
  label?: string;
  /** Per-star aria-label factory for interactive mode (i18n at the call site); omit to rely on group. */
  starLabel?: (n: number) => string;
}

/**
 * Five sun-gold stars with an optional half-star and review count (design-system.md §Component).
 * Filled = `text-accent-sun`, empty = `text-border-default`; fractions render via a width-clipped
 * filled star overlaid on an empty one. `interactive` turns each star into a button that calls
 * `onRate(n)`; otherwise the group is a static `role="img"` carrying `label`.
 */
export const Rating = forwardRef<HTMLDivElement, RatingProps>(function Rating(
  { className, value, count, interactive = false, onRate, label, size, starLabel, ...props },
  ref,
) {
  const clamped = Math.max(0, Math.min(5, value));

  return (
    <div
      ref={ref}
      className={cn('inline-flex items-center gap-2', className)}
      // Interactive ratings expose their own buttons; a static rating reads as one image with `label`.
      role={interactive ? 'group' : 'img'}
      aria-label={label}
      {...props}
    >
      <span className="inline-flex items-center gap-0.5">
        {STARS.map((n) => {
          // Filled width of THIS star: full (100%) up to floor, partial for the fractional one, else 0.
          const fill = Math.max(0, Math.min(1, clamped - (n - 1)));
          const overlay = (
            <span className={star({ size })} aria-hidden={!interactive || undefined}>
              <span className="text-border-default">★</span>
              <span
                className="absolute inset-0 overflow-hidden text-accent-sun"
                style={{ width: `${fill * 100}%` }}
              >
                ★
              </span>
            </span>
          );

          if (interactive) {
            return (
              <button
                key={n}
                type="button"
                aria-label={starLabel?.(n)}
                onClick={() => onRate?.(n)}
                className={cn(
                  'inline-flex rounded-sm transition-transform duration-150 ease-out',
                  'hover:-translate-y-px motion-reduce:transform-none motion-reduce:transition-none',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky focus-visible:ring-offset-2',
                  'min-h-[44px] min-w-[44px] items-center justify-center',
                )}
              >
                {overlay}
              </button>
            );
          }

          return (
            <span key={n} className="inline-flex">
              {overlay}
            </span>
          );
        })}
      </span>
      {count != null && (
        <span className="font-body text-sm text-text-muted tabular-nums">
          ({formatVnNumber(count)})
        </span>
      )}
    </div>
  );
});
