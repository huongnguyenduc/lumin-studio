import type { ReactNode } from 'react';
import { PriceTag, cn } from '@lumin/ui';
import type { CartItem } from '@/lib/cart';
import type { QuoteLine } from '@/lib/quote';

/** Small inline pulse for a money value that is still (re-)quoting. Moved here from checkout-view so the
 *  bottom sticky bar + the two summary placements can all use it. */
export function SummarySkeleton() {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-5 w-20 animate-pulse rounded bg-surface-sunken motion-reduce:animate-none"
    />
  );
}

/** Itemized cart lines. `lines` is the settled quote's per-line pricing (POST /price/quote), positionally
 *  aligned with `items` (cartQuoteItems is a 1:1 map — same order/length, see lib/quote.ts). Renders a
 *  price per line only once the quote for THIS cart shape has settled (lines.length === items.length) —
 *  never a stale or guessed amount, and never client math (ADR-019). */
export function SummaryLines({ items, lines }: { items: CartItem[]; lines: QuoteLine[] | null }) {
  const priced = lines && lines.length === items.length ? lines : null;
  return (
    <ul className="flex flex-col gap-2">
      {items.map((item, i) => (
        <li key={item.key} className="flex items-center gap-2">
          <span className="h-10 w-10 shrink-0 overflow-hidden rounded-sm bg-surface-card">
            {item.imageSrc ? (
              <img src={item.imageSrc} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="lumin-dotgrid h-full w-full" aria-hidden="true" />
            )}
          </span>
          <span className="min-w-0 flex-1 text-sm text-text-body">
            <span className="block truncate">{item.name}</span>
            <span className="font-mono text-xs text-text-muted">×{item.quantity}</span>
          </span>
          {priced ? <PriceTag amount={priced[i].lineTotal} className="text-sm" /> : null}
        </li>
      ))}
    </ul>
  );
}

/** Shared money-lines shape the summary + the sticky bar both read — same fields checkout-view's QuoteState
 *  already tracks, kept here as a narrow prop type instead of re-exporting the whole state union. */
export type SummaryMoneyProps = {
  provinceChosen: boolean;
  okQuote: { subtotal: number; shippingFee?: number; total?: number } | null;
  errQuote: { code: 'unavailable' | 'no_shipping_rule' | 'error' } | null;
  onRetry: () => void;
  t: (key: string) => string;
  /** Sticky bar shows the breakdown WITHOUT repeating the total (that lives outside the <details>). */
  hideTotal?: boolean;
};

/** Tạm tính / phí ship / tổng cộng — the 4-branch money state (province unchosen · settled · error ·
 *  pending) shared by the top summary card, the desktop aside, and the mobile sticky bar's expandable
 *  breakdown. Bit-for-bit the logic that used to live inline in checkout-view.tsx. */
export function SummaryMoney({
  provinceChosen,
  okQuote,
  errQuote,
  onRetry,
  t,
  hideTotal,
}: SummaryMoneyProps) {
  return (
    <>
      <div className="mt-2 flex items-center justify-between gap-3">
        <span className="text-text-body">{t('subtotalLabel')}</span>
        {/* aria-live so assistive tech announces the recomputed total after a quote settles. */}
        <span aria-live="polite">
          {okQuote ? <PriceTag amount={okQuote.subtotal} /> : <SummarySkeleton />}
        </span>
      </div>
      {!provinceChosen ? (
        <p className="mt-2 text-sm text-text-muted">{t('shippingPending')}</p>
      ) : okQuote && okQuote.shippingFee !== undefined && okQuote.total !== undefined ? (
        <>
          <div className="mt-2 flex items-center justify-between gap-3">
            <span className="text-text-body">{t('shippingLabel')}</span>
            <PriceTag amount={okQuote.shippingFee} />
          </div>
          {!hideTotal ? (
            <div className="mt-2 flex items-center justify-between gap-3 border-t border-border-subtle pt-2">
              <span className="font-display font-bold text-text-strong">{t('totalLabel')}</span>
              <PriceTag amount={okQuote.total} className="text-xl" />
            </div>
          ) : null}
        </>
      ) : errQuote ? (
        <div className="mt-3">
          <p role="alert" className="text-sm font-semibold text-accent-flame">
            {errQuote.code === 'no_shipping_rule'
              ? t('noShippingRule')
              : errQuote.code === 'unavailable'
                ? t('unavailableError')
                : t('pricingError')}
          </p>
          {errQuote.code === 'error' ? (
            <button
              type="button"
              onClick={onRetry}
              className="mt-2 inline-flex min-h-11 items-center rounded-pill border-2 border-border-strong bg-surface-card px-5 font-display text-sm font-semibold text-text-strong transition-colors hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky focus-visible:ring-offset-2"
            >
              {t('retry')}
            </button>
          ) : null}
        </div>
      ) : (
        <div className="mt-2 flex items-center justify-between gap-3">
          <span className="text-text-body">{t('shippingLabel')}</span>
          <SummarySkeleton />
        </div>
      )}
    </>
  );
}

/** Mobile sticky total bar (< lg): total + submit always in view, with an expandable breakdown that opens
 *  UPWARD (the <details> sits above the total row, and the bar itself is pinned to the bottom) — no JS,
 *  no flex-col-reverse. Originally copied the PDP sticky-CTA bar's recipe (product-detail.tsx): `sticky`
 *  + translucent blur; the PDP bar has since moved to `fixed` (so it persists through its reviews section)
 *  — this bar stays `sticky` intentionally, since checkout has no content below the summary that a fixed
 *  bar would need to persist through, and `sticky` costs no extra page-level bottom-padding bookkeeping.
 *  Dissolves on lg: (the desktop aside carries the submit button there instead). Unlike the PDP bar this
 *  one only needs to clear the mobile bottom-nav (bottom-nav.tsx is `md:hidden`), so the 76px offset drops
 *  at `md:` instead of `lg:` — it would otherwise float above empty space between md and lg.
 *
 *  The total slot mirrors the SAME 3-branch state SummaryMoney shows in the breakdown (pending · error ·
 *  settled) instead of an unconditional skeleton — a shopper who never opens "Chi tiết thanh toán" still
 *  sees WHY there's no total, and an error auto-opens the details so the retry button + role="alert" are
 *  in the accessibility tree, not hidden inside a closed disclosure. */
export function CheckoutTotalBar({
  total,
  provinceChosen,
  errorLabel,
  toggleLabel,
  totalLabel,
  shippingPendingLabel,
  children,
  money,
}: {
  total: number | undefined;
  provinceChosen: boolean;
  /** Set (to the same message SummaryMoney renders in the breakdown) when errQuote is present — forces
   *  the breakdown open so its role="alert" + retry button are reachable without an extra tap, and shows
   *  a short reason here instead of an endless skeleton. */
  errorLabel: string | undefined;
  toggleLabel: string;
  totalLabel: string;
  shippingPendingLabel: string;
  children: ReactNode;
  money: ReactNode;
}) {
  return (
    <div className="sticky bottom-[76px] z-30 -mx-4 border-t-2 border-border-strong bg-surface-page/95 px-4 py-3 backdrop-blur-sm md:bottom-0 lg:hidden">
      <details className="group mb-2" open={errorLabel !== undefined || undefined}>
        <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1 font-display text-sm font-semibold text-text-strong marker:content-none [&::-webkit-details-marker]:hidden">
          {toggleLabel}
        </summary>
        <div className="mt-1">{money}</div>
      </details>
      <div className="flex items-center justify-between gap-3">
        <span
          className={cn('text-sm', total === undefined && 'text-text-muted')}
          aria-live="polite"
        >
          <span className="block font-display font-bold text-text-strong">{totalLabel}</span>
          {total !== undefined ? (
            <PriceTag amount={total} className="text-lg" />
          ) : !provinceChosen ? (
            <span className="text-xs">{shippingPendingLabel}</span>
          ) : errorLabel !== undefined ? (
            <span className="text-xs font-semibold text-accent-flame">{errorLabel}</span>
          ) : (
            <SummarySkeleton />
          )}
        </span>
        {children}
      </div>
    </div>
  );
}
