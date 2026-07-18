'use client';

import { forwardRef, type HTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from './lib/cn';

// HOUSE-STYLE: cva variants with explicit defaults, forwardRef to the real DOM node, `className`
// through cn() last so callers can override, semantic token utilities only (no raw hex), a11y via
// focus-visible ring + ≥44px hit target. NO hard-coded UI copy — the two aria-labels arrive as props.
const stepperBtn = cva(
  'inline-flex shrink-0 items-center justify-center rounded-full ' +
    'bg-surface-sunken text-text-strong hover:bg-surface-cream ' +
    'transition-colors duration-150 ease-out motion-reduce:transition-none ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky focus-visible:ring-offset-2 ' +
    'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-surface-sunken',
  {
    variants: {
      size: {
        // md is the default: h-11 w-11 = 44px round button, meeting the ≥44px touch target
        // (frontend-a11y-i18n §Bàn phím & focus). gap-2 only spaces the buttons — it does NOT enlarge
        // each button's own hit area, so the circle itself must be 44px.
        md: 'h-11 w-11',
      },
    },
    defaultVariants: { size: 'md' },
  },
);

export interface QuantityStepperProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange'>, VariantProps<typeof stepperBtn> {
  /** Current (controlled) quantity. The displayed value is always derived from this prop. */
  value: number;
  /** Called with the next clamped value when the shopper presses − or +. */
  onChange: (value: number) => void;
  /** Lowest allowed quantity; − is disabled at this floor. */
  min?: number;
  /** Highest allowed quantity; + is disabled at this ceiling. */
  max?: number;
  /** Disables both buttons (e.g. while the line item is saving). */
  disabled?: boolean;
  /** Required aria-label for the − button (i18n at the call site, never hard-coded). */
  decrementLabel: string;
  /** Required aria-label for the + button (i18n at the call site, never hard-coded). */
  incrementLabel: string;
}

/**
 * −/+ quantity stepper with clamping (design-system.md §Component). Controlled: the middle value is a
 * live region (`aria-live="polite"`) rendered straight from `value`. − calls `onChange(max(min, value-1))`,
 * + calls `onChange(min(max, value+1))`; each button disables at its bound or when `disabled`.
 */
export const QuantityStepper = forwardRef<HTMLDivElement, QuantityStepperProps>(
  function QuantityStepper(
    {
      className,
      value,
      onChange,
      min = 1,
      max = 99,
      disabled = false,
      decrementLabel,
      incrementLabel,
      size,
      ...props
    },
    ref,
  ) {
    const atMin = value <= min;
    const atMax = value >= max;

    return (
      <div ref={ref} className={cn('inline-flex items-center gap-2', className)} {...props}>
        <button
          type="button"
          aria-label={decrementLabel}
          disabled={disabled || atMin}
          onClick={() => onChange(Math.max(min, value - 1))}
          className={stepperBtn({ size })}
        >
          <span aria-hidden="true">−</span>
        </button>
        <span
          aria-live="polite"
          className="min-w-8 text-center font-mono tabular-nums text-text-strong"
        >
          {value}
        </span>
        <button
          type="button"
          aria-label={incrementLabel}
          disabled={disabled || atMax}
          onClick={() => onChange(Math.min(max, value + 1))}
          className={stepperBtn({ size })}
        >
          <span aria-hidden="true">+</span>
        </button>
      </div>
    );
  },
);
