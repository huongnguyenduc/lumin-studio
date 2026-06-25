import { forwardRef, type HTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from './lib/cn';

// HOUSE-STYLE REFERENCE for @lumin/ui primitives:
//  - cva() for variants, default variants set explicitly.
//  - forwardRef to the real DOM node; `className` passes through cn() last so callers can override.
//  - semantic token utilities only (bg-surface-sunken, ring-surface-cream …) — never raw hex.
//  - NO hard-coded UI copy: the visible label / image alt comes from `name` (i18n at the call site).
const avatar = cva(
  'relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full ' +
    'ring-2 ring-surface-cream bg-surface-sunken text-text-strong font-semibold select-none',
  {
    variants: {
      size: {
        sm: 'h-8 w-8 text-xs',
        md: 'h-11 w-11 text-base',
        lg: 'h-14 w-14 text-lg',
      },
    },
    defaultVariants: { size: 'md' },
  },
);

export interface AvatarProps extends HTMLAttributes<HTMLDivElement>, VariantProps<typeof avatar> {
  /** Person's name — drives the fallback initials AND the image alt text. Required. */
  name: string;
  /** Optional photo URL; when present the image is shown in place of initials. */
  src?: string;
}

/** First letter of up to the first two whitespace-separated words, uppercased (e.g. "Bích Ngọc" → "BN"). */
function initialsFrom(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('');
}

/**
 * Round avatar with the signature cream halo. Shows the photo when `src` is set, otherwise the
 * person's initials on a sunken surface (design-system.md §Component — `name` · `src` · `size`).
 */
export const Avatar = forwardRef<HTMLDivElement, AvatarProps>(function Avatar(
  { className, size, name, src, ...props },
  ref,
) {
  return (
    <div ref={ref} className={cn(avatar({ size }), className)} {...props}>
      {src ? (
        <img src={src} alt={name} className="h-full w-full object-cover" />
      ) : (
        initialsFrom(name)
      )}
    </div>
  );
});
