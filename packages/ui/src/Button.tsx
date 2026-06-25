import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from './lib/cn';

// HOUSE-STYLE REFERENCE for @lumin/ui primitives:
//  - cva() for variants, default variants set explicitly.
//  - forwardRef to the real DOM node; `className` passes through cn() last so callers can override.
//  - semantic token utilities only (bg-primary, border-border-strong, shadow-pop …) — never raw hex.
//  - a11y: focus-visible ring, disabled cursor/opacity; motion respects prefers-reduced-motion via
//    `motion-reduce:` (the global reduced-motion CSS in tokens.css is the backstop).
//  - NO hard-coded UI copy: visible text comes from children/props (i18n at the call site).
const button = cva(
  'inline-flex items-center justify-center gap-2 select-none whitespace-nowrap rounded-pill ' +
    'font-display font-semibold leading-none ' +
    'transition-[transform,box-shadow,background-color,opacity] duration-150 ease-out ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky focus-visible:ring-offset-2 ' +
    'disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-on-primary hover:bg-primary-press',
        secondary: 'bg-surface-brand text-on-dark hover:opacity-90',
        outline:
          'bg-transparent text-text-strong border-2 border-border-strong hover:bg-surface-sunken',
        pop:
          'bg-accent-sun text-text-strong border-2 border-border-strong shadow-pop ' +
          'hover:-translate-x-px hover:-translate-y-px active:translate-x-0.5 active:translate-y-0.5 ' +
          'active:shadow-none motion-reduce:transform-none',
      },
      size: {
        sm: 'h-9 px-4 text-sm',
        md: 'h-11 px-5 text-base',
        lg: 'h-13 px-7 text-lg',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof button> {}

/**
 * Primary action control. `primary`=coral, `secondary`=cocoa, `outline`=ink hairline,
 * `pop`=gold hero CTA with the signature offset cocoa shadow (design-system.md §Component).
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, type = 'button', ...props },
  ref,
) {
  return (
    <button ref={ref} type={type} className={cn(button({ variant, size }), className)} {...props} />
  );
});
