import { forwardRef, type HTMLAttributes, type MouseEvent, type Ref } from 'react';
import { cva } from 'class-variance-authority';
import { cn } from './lib/cn';

// HOUSE-STYLE REFERENCE for @lumin/ui primitives:
//  - cva() for variants, default variants set explicitly.
//  - forwardRef to the real DOM node; `className` passes through cn() last so callers can override.
//  - semantic token utilities only (bg-primary, border-border-default …) — never raw hex.
//  - a11y: focus-visible ring on interactive elements, motion respects prefers-reduced-motion.
//  - NO hard-coded UI copy: the label comes from children, the remove aria-label from `removeLabel`.
const tag = cva(
  'inline-flex items-center gap-1 select-none whitespace-nowrap rounded-pill px-3 h-8 text-sm ' +
    'font-body leading-none',
  {
    variants: {
      selected: {
        true: 'bg-primary text-on-primary',
        false: 'bg-surface-sunken text-text-body border border-border-default',
      },
      interactive: {
        true:
          'transition-colors duration-150 ease-out motion-reduce:transition-none ' +
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky ' +
          'focus-visible:ring-offset-2',
        false: '',
      },
    },
    defaultVariants: { selected: false, interactive: false },
  },
);

interface TagBaseProps extends Omit<HTMLAttributes<HTMLElement>, 'onClick'> {
  /** When true, render a toggle `<button>` with `aria-pressed`; otherwise a static `<span>`. */
  selectable?: boolean;
  /** Pressed/active visual state — only meaningful when `selectable`. */
  selected?: boolean;
  /** Toggle handler for a selectable chip. */
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
}

/**
 * `removeLabel` is REQUIRED whenever `onRemove` is set — the × button must carry an accessible name
 * (no hard-coded copy). The discriminated union turns "onRemove without removeLabel" into a type error.
 */
export type TagProps = TagBaseProps &
  (
    | { onRemove: () => void; removeLabel: string }
    | { onRemove?: undefined; removeLabel?: undefined }
  );

/**
 * Filter / material chip. `selectable` makes it a toggle button (`aria-pressed={selected}`);
 * otherwise it is a static label span. `onRemove` adds an inner × button reachable by `removeLabel`
 * that stops propagation so it never toggles the chip (design-system.md §Component → Tag).
 */
export const Tag = forwardRef<HTMLElement, TagProps>(function Tag(
  {
    className,
    children,
    selectable = false,
    selected = false,
    onRemove,
    removeLabel,
    onClick,
    ...props
  },
  ref,
) {
  // The × is its own button. When the chip itself is a <button>, nesting a button inside it is
  // invalid HTML, so a selectable+removable chip wraps a toggle <button> and the remove <button> as
  // SIBLINGS in a span container; the static chip just appends the × inline.
  const remove = onRemove ? (
    <button
      type="button"
      aria-label={removeLabel}
      onClick={(event) => {
        event.stopPropagation();
        onRemove();
      }}
      className={cn(
        'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-pill leading-none ' +
          'transition-colors duration-150 ease-out motion-reduce:transition-none ' +
          'hover:bg-black/10 focus-visible:outline-none focus-visible:ring-2 ' +
          'focus-visible:ring-accent-sky focus-visible:ring-offset-1',
      )}
    >
      ×
    </button>
  ) : null;

  if (selectable) {
    const toggle = (
      <button
        ref={onRemove ? undefined : (ref as Ref<HTMLButtonElement>)}
        type="button"
        aria-pressed={selected}
        onClick={onClick}
        className={cn(
          tag({ selected, interactive: true }),
          // The wrapper owns layout/className when removable; the toggle keeps only its own ring.
          onRemove ? 'pr-2' : className,
        )}
        {...(onRemove ? {} : props)}
      >
        {children}
      </button>
    );

    if (!remove) return toggle;

    return (
      <span
        ref={ref as Ref<HTMLSpanElement>}
        className={cn('inline-flex items-center gap-1', className)}
        {...props}
      >
        {toggle}
        {remove}
      </span>
    );
  }

  return (
    <span
      ref={ref as Ref<HTMLSpanElement>}
      className={cn(tag({ selected, interactive: Boolean(onRemove) }), className)}
      {...props}
    >
      {children}
      {remove}
    </span>
  );
});
