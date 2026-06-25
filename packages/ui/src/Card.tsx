import { forwardRef, type HTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from './lib/cn';

// HOUSE-STYLE REFERENCE (mirrors Button.tsx): cva() variants with explicit defaults, forwardRef to the
// real DOM node, `className` through cn() last so callers override, semantic token utilities only
// (bg-surface-card, border-border-strong, shadow-pop …) — never raw hex. Reduced-motion respected via
// `motion-reduce:`. No hard-coded UI copy: content comes from `children`.
const card = cva('rounded-lg bg-surface-card', {
  variants: {
    elevation: {
      md: 'border border-border-subtle shadow-md',
      pop: 'border-2 border-border-strong shadow-pop',
    },
    interactive: {
      // The signature offset lift; focus-visible ring matches the Button so the whole DS feels one.
      true:
        'cursor-pointer transition-[transform,box-shadow] duration-150 ease-out ' +
        'hover:-translate-x-px hover:-translate-y-px motion-reduce:transform-none motion-reduce:transition-none ' +
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky focus-visible:ring-offset-2',
      false: '',
    },
  },
  defaultVariants: { elevation: 'md', interactive: false },
});

export interface CardProps extends HTMLAttributes<HTMLDivElement>, VariantProps<typeof card> {}

/**
 * Rounded surface container. `elevation` md = quiet hairline card; `pop` = chunky cocoa outline with the
 * signature offset shadow (design-system.md §Component). `interactive` makes the whole card a focusable
 * button (role + tabIndex + hover lift) for tap-anywhere tiles.
 */
export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { className, elevation, interactive = false, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      className={cn(card({ elevation, interactive }), className)}
      {...props}
    />
  );
});
