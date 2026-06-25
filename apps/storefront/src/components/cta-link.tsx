import Link from 'next/link';
import type { ComponentProps } from 'react';
import { cn } from '@lumin/ui';

// Pill CTAs that NAVIGATE → must be <Link> (the @lumin/ui Button primitive renders a <button>, so it
// can't carry an href). These mirror the Button `pop`/`outline` variants so the look stays in sync,
// and bake in min-h-[44px] so the hit target is guaranteed (conventions §A11y) regardless of padding.
const base =
  'inline-flex min-h-[44px] items-center justify-center gap-2 rounded-pill border-2 border-border-strong ' +
  'font-display font-bold transition-[transform,box-shadow,background-color] duration-150 ease-out ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky focus-visible:ring-offset-2 ' +
  'motion-reduce:transform-none';

const ctaVariants = {
  pop:
    'bg-accent-sun text-text-strong px-7 py-3 shadow-pop hover:-translate-x-px hover:-translate-y-px ' +
    'active:translate-x-0.5 active:translate-y-0.5 active:shadow-none',
  outline: 'bg-transparent text-text-strong px-6 py-3 font-semibold hover:bg-surface-sunken',
} as const;

export interface CtaLinkProps extends ComponentProps<typeof Link> {
  variant?: keyof typeof ctaVariants;
}

/** Navigation CTA styled like the design-system `pop`/`outline` buttons (see note above). */
export function CtaLink({ variant = 'pop', className, ...props }: CtaLinkProps) {
  return <Link className={cn(base, ctaVariants[variant], className)} {...props} />;
}
