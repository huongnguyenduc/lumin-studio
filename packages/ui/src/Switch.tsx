import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cva } from 'class-variance-authority';
import { cn } from './lib/cn';

// HOUSE-STYLE: cva variants with explicit defaults, forwardRef to the real DOM node, `className`
// through cn() last, semantic token utilities only, focus-visible ring, motion-reduce on transitions.
// Controlled component — visual state derives from `checked`, never internal state.
const track = cva(
  'relative inline-flex h-6 w-11 shrink-0 items-center rounded-pill p-0.5 ' +
    'transition-colors duration-150 ease-out motion-reduce:transition-none ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky focus-visible:ring-offset-2 ' +
    'disabled:cursor-not-allowed disabled:opacity-60',
  {
    variants: {
      on: {
        true: 'bg-accent-teal',
        false: 'bg-surface-sunken border border-border-default',
      },
    },
    defaultVariants: { on: false },
  },
);

const knob = cva(
  'pointer-events-none inline-block h-5 w-5 rounded-full bg-surface-card shadow-sm ' +
    'transition-transform duration-150 ease-out motion-reduce:transition-none',
  {
    variants: {
      on: {
        true: 'translate-x-5',
        false: 'translate-x-0.5',
      },
    },
    defaultVariants: { on: false },
  },
);

export interface SwitchProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'onChange' | 'type'
> {
  /** Controlled on/off state — the component renders from this, it keeps no internal state. */
  checked: boolean;
  /** Called with the negated value when the user toggles (omitted while disabled). */
  onCheckedChange?: (checked: boolean) => void;
  /** Accessible name (required) — a role="switch" has no text of its own, so this is its aria-label. */
  label: string;
}

/**
 * Pill toggle. Track turns teal when on, knob springs across (design-system.md §Component).
 * Controlled: pass `checked` + `onCheckedChange`. Provide `label` for the accessible name.
 */
export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(function Switch(
  { className, checked, onCheckedChange, disabled, label, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => {
        if (!disabled) onCheckedChange?.(!checked);
      }}
      className={cn(track({ on: checked }), className)}
      {...props}
    >
      <span className={cn(knob({ on: checked }))} />
    </button>
  );
});
