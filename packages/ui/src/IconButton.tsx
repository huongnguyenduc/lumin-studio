import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from './lib/cn';

// HOUSE-STYLE REFERENCE: see Button.tsx. cva variants + explicit defaults, forwardRef to the real
// <button>, `className` through cn() last, semantic token utilities only (no raw hex), focus-visible
// ring + disabled + motion-reduce. Icon-only → the ONLY accessible name is the required `label` prop
// (aria-label); the glyph child is decorative, so visible copy still lives at the call site.
const iconButton = cva(
  'inline-flex items-center justify-center select-none shrink-0 rounded-full ' +
    'transition-[transform,box-shadow,background-color,opacity] duration-150 ease-out ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky focus-visible:ring-offset-2 ' +
    'disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none',
  {
    variants: {
      variant: {
        soft: 'bg-surface-sunken text-text-strong hover:bg-surface-cream',
        solid: 'bg-primary text-on-primary hover:bg-primary-press',
        ghost: 'bg-transparent text-text-strong hover:bg-surface-sunken',
      },
      size: {
        sm: 'h-9 w-9',
        md: 'h-11 w-11',
        lg: 'h-12 w-12',
      },
    },
    defaultVariants: { variant: 'soft', size: 'md' },
  },
);

export interface IconButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof iconButton> {
  /** Required accessible name — icon-only buttons have no text, so this becomes the `aria-label`. */
  label: string;
  /** The icon node (e.g. a Lucide line icon). Purely decorative; `label` names the control. */
  children?: ReactNode;
}

/**
 * Circular, icon-only button. `soft`=sunken cream chip, `solid`=coral primary, `ghost`=transparent
 * (design-system.md §Component). Always carries an `aria-label` via the required `label` prop.
 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { className, variant, size, label, type = 'button', children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      className={cn(iconButton({ variant, size }), className)}
      {...props}
    >
      {children}
    </button>
  );
});
