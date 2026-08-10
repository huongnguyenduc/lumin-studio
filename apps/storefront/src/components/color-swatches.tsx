'use client';

import { cn } from '@lumin/ui';
import { isColorSelectable, type ColorView } from '@/lib/product-view';

/**
 * One labelled group of colour swatches. Reused (ADR-037) for BOTH the flat product colour picker and
 * each named part's own colour set — a parts product renders one of these per part; also reused by the
 * cart edit dialog (D — same control, same visual language, no second implementation to drift). Out-of-
 * stock swatches (available:false) render disabled + struck-through and can never be selected, so the
 * add-to-cart gate never unlocks on one. `labelFor` is built by the parent (where next-intl's `t` is
 * precisely typed), so this component stays translator-agnostic. `selectedNote` is the hi-fi mono caption
 * beside the dots ("Cam Mochi · +5 màu") — pre-built by the parent for the same reason. Pure presentation
 * — the parent owns the selection state.
 */
export function ColorSwatches({
  heading,
  headingId,
  colors,
  selectedId,
  onSelect,
  labelFor,
  outOfStockNote,
  selectedNote,
}: {
  heading: string;
  headingId: string;
  colors: ColorView[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  labelFor: (color: ColorView) => string;
  outOfStockNote: string;
  selectedNote: string | null;
}) {
  const anyUnavailable = colors.some((c) => !c.available);
  return (
    <div role="group" aria-labelledby={headingId}>
      <h2 id={headingId} className="mb-2 font-display text-sm font-semibold text-text-strong">
        {heading}
      </h2>
      <div className="flex flex-wrap items-center gap-3">
        <ul className="flex flex-wrap gap-3">
          {colors.map((c) => {
            const selectable = isColorSelectable(c);
            const selected = c.id === selectedId;
            return (
              <li key={c.id}>
                <button
                  type="button"
                  disabled={!selectable}
                  aria-pressed={selectable ? selected : undefined}
                  aria-label={labelFor(c)}
                  onClick={() => onSelect(c.id)}
                  className={cn(
                    'relative h-11 w-11 rounded-full border-2 transition-transform duration-150 ease-out',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky focus-visible:ring-offset-2',
                    'motion-safe:transition-transform motion-reduce:transition-none',
                    selected
                      ? // Hi-fi: the selected swatch reads larger with a double halo (ring + offset).
                        'scale-110 border-border-strong ring-2 ring-border-strong ring-offset-2'
                      : 'border-border-default',
                    selectable
                      ? 'hover:-translate-y-px motion-reduce:transform-none'
                      : 'cursor-not-allowed opacity-40',
                  )}
                  style={{ backgroundColor: c.hex }}
                >
                  {!selectable ? (
                    // Diagonal strike (CSS, no glyph) marks the out-of-stock swatch; the disabled state +
                    // aria-label carry the meaning for AT.
                    <span
                      aria-hidden="true"
                      className="absolute left-1/2 top-1/2 h-0.5 w-[130%] -translate-x-1/2 -translate-y-1/2 -rotate-45 rounded-full bg-border-strong"
                    />
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
        {/* Hi-fi: mono caption naming the picked colour, inline with the dots. aria-hidden — the
            selected swatch already announces itself via aria-pressed + aria-label. */}
        {selectedNote ? (
          <span aria-hidden="true" className="font-mono text-xs text-text-muted">
            {selectedNote}
          </span>
        ) : null}
      </div>
      {/* Spec §05-mandated copy (SF-04). Out-of-stock swatches are disabled → un-selectable, so this is a
          standing note explaining the dimmed swatches rather than a per-selection error. */}
      {anyUnavailable ? (
        <p role="note" className="mt-2 text-sm text-text-muted">
          {outOfStockNote}
        </p>
      ) : null}
    </div>
  );
}
