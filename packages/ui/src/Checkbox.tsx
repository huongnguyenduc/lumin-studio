import { forwardRef, type InputHTMLAttributes } from 'react';
import { cva } from 'class-variance-authority';
import { cn } from './lib/cn';

// HOUSE-STYLE REFERENCE: see Button.tsx. Checkbox wraps a REAL native <input type="checkbox"> (it
// drives a11y + checked/onChange); the visible box is a styled sibling that reacts to the input via
// Tailwind `peer-*` selectors. Semantic token utilities only; visible label comes from a prop (i18n
// at the call site). The ✓ is a non-text glyph, fine to hard-code.
const box = cva(
  'inline-flex shrink-0 items-center justify-center h-5 w-5 rounded-xs border-2 border-border-strong ' +
    'bg-surface-card text-on-primary ' +
    'transition-[background-color,border-color,opacity] duration-150 ease-out motion-reduce:transition-none ' +
    'peer-checked:bg-primary peer-checked:border-primary peer-checked:[&_svg]:opacity-100 ' +
    'peer-focus-visible:ring-2 peer-focus-visible:ring-accent-sky peer-focus-visible:ring-offset-2 ' +
    'peer-disabled:opacity-60',
);

export interface CheckboxProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Optional label rendered next to the box (i18n string supplied by the caller). */
  label?: string;
}

/**
 * Square rounded checkbox for multi-select / consent (design-system.md §Component). A real native
 * checkbox drives accessibility and state; the gold-ink styled box mirrors `checked` via `peer-*`.
 * The whole control sits in a <label>, so `label` text — or an external `<label htmlFor>` — associates
 * the accessible name. forwardRef targets the underlying input.
 */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { className, label, disabled, ...props },
  ref,
) {
  return (
    <label
      className={cn(
        'inline-flex min-h-11 items-center gap-2 select-none text-text-body',
        disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
        className,
      )}
    >
      <input ref={ref} type="checkbox" disabled={disabled} className="peer sr-only" {...props} />
      <span aria-hidden className={box()}>
        <svg
          viewBox="0 0 16 16"
          className="h-3.5 w-3.5 opacity-0 transition-opacity duration-150 ease-out motion-reduce:transition-none"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
        </svg>
      </span>
      {label ? <span>{label}</span> : null}
    </label>
  );
});
