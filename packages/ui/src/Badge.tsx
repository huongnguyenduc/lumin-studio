import { forwardRef, type HTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from './lib/cn';

/** Status/merch tones — soft tint by default, saturated when `solid` (design-system.md §Component). */
export type BadgeTone = 'neutral' | 'primary' | 'teal' | 'sky' | 'sun' | 'danger';

// HOUSE-STYLE REFERENCE (see Button.tsx): cva variants with explicit defaultVariants, semantic token
// utilities only (never raw hex), `className` through cn() last so callers can override. The visible
// label is children/props (i18n at the call site) — a Badge is a non-interactive <span>.
//
// Two variant axes: `tone` (hue) × `solid` (boolean→string). SOFT = cocoa text on a light tint
// (always clears AA). SOLID = saturated fill, and every fg/bg pair is chosen to clear AA 4.5:1 for
// the text-xs label (frontend-a11y-i18n §Contrast KHOÁ; the pairs are locked by tokens.contrast.test):
// teal/sun take cocoa text; sky uses the darker accent-sky-strong + white; danger uses danger-600.
const badge = cva(
  'inline-flex items-center rounded-pill px-3 h-6 text-xs font-semibold font-body ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky focus-visible:ring-offset-2',
  {
    variants: {
      tone: {
        neutral: '',
        primary: '',
        teal: '',
        sky: '',
        sun: '',
        danger: '',
      },
      solid: {
        false: '',
        true: '',
      },
    },
    compoundVariants: [
      // SOFT (default): cocoa-on-tint.
      { tone: 'neutral', solid: false, class: 'bg-surface-sunken text-text-body' },
      { tone: 'primary', solid: false, class: 'bg-accent-flame-soft text-text-strong' },
      { tone: 'teal', solid: false, class: 'bg-accent-teal-soft text-text-strong' },
      { tone: 'sky', solid: false, class: 'bg-accent-sky-soft text-text-strong' },
      { tone: 'sun', solid: false, class: 'bg-accent-sun-soft text-text-strong' },
      { tone: 'danger', solid: false, class: 'bg-danger-soft text-text-strong' },
      // SOLID: saturated fill.
      { tone: 'neutral', solid: true, class: 'bg-surface-brand text-on-dark' },
      { tone: 'primary', solid: true, class: 'bg-primary text-on-primary' },
      { tone: 'teal', solid: true, class: 'bg-accent-teal text-text-strong' },
      { tone: 'sky', solid: true, class: 'bg-accent-sky-strong text-on-primary' },
      { tone: 'sun', solid: true, class: 'bg-accent-sun text-text-strong' },
      { tone: 'danger', solid: true, class: 'bg-danger text-on-danger' },
    ],
    defaultVariants: { tone: 'neutral', solid: false },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>, Omit<VariantProps<typeof badge>, 'solid'> {
  /** Hue of the pill. @default 'neutral' */
  tone?: BadgeTone;
  /** Saturated fill instead of the default soft tint. @default false */
  solid?: boolean;
}

/**
 * Small non-interactive status/merch pill (e.g. "Mới", "Còn hàng"). Soft cocoa-on-tint by default;
 * `solid` for a saturated fill. The label is supplied via children (i18n at the call site).
 */
export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { className, tone, solid = false, ...props },
  ref,
) {
  return <span ref={ref} className={cn(badge({ tone, solid }), className)} {...props} />;
});
