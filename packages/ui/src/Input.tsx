import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from './lib/cn';

// HOUSE-STYLE REFERENCE for @lumin/ui primitives — see Button.tsx. Highlights for this field:
//  - forwardRef to the real <input>; `className` passes through cn() last so callers override.
//  - semantic token utilities only (border-border-default, bg-surface-card, text-danger …) — no hex.
//  - a11y: label wired via htmlFor/id (useId fallback), error → aria-invalid + aria-describedby +
//    role=alert; hint also wired via aria-describedby; focus-visible ring on the control.
//  - NO hard-coded UI copy: label/hint/error all come from props (i18n at the call site).

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Visible field label (sentence case, from i18n at the call site). */
  label?: string;
  /** Helper text shown below when there is no error. */
  hint?: string;
  /** Error message; sets aria-invalid and is announced via role=alert. */
  error?: string;
  /** Decorative/affordance glyph rendered before the input (pointer-events-none). */
  leadingIcon?: ReactNode;
}

/**
 * Labelled text field. Rounded card surface with a focus-within primary border; surfaces a `hint`
 * or, when `error` is set, a danger border + alert message (design-system.md §Component "Input").
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, label, hint, error, leadingIcon, id, disabled, ...props },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const describedById = `${inputId}-desc`;
  const hasError = Boolean(error);

  return (
    <div className="flex flex-col gap-1.5">
      {label ? (
        <label htmlFor={inputId} className="font-display text-sm font-medium text-text-strong">
          {label}
        </label>
      ) : null}

      <div
        className={cn(
          'flex h-11 items-center gap-2 rounded-md border bg-surface-card px-3',
          'transition-colors duration-150 ease-out motion-reduce:transition-none',
          'focus-within:border-primary',
          hasError ? 'border-danger' : 'border-border-default',
          disabled ? 'cursor-not-allowed opacity-60' : '',
        )}
      >
        {leadingIcon ? (
          <span className="pointer-events-none flex shrink-0 items-center text-text-muted">
            {leadingIcon}
          </span>
        ) : null}

        <input
          ref={ref}
          id={inputId}
          disabled={disabled}
          aria-invalid={hasError || undefined}
          aria-describedby={error || hint ? describedById : undefined}
          className={cn(
            'h-full w-full bg-transparent text-base text-text-body outline-none',
            'placeholder:text-text-subtle disabled:cursor-not-allowed',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky focus-visible:ring-offset-2',
            className,
          )}
          {...props}
        />
      </div>

      {error ? (
        <p id={describedById} role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={describedById} className="text-sm text-text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
});
