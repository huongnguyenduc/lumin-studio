'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Checkbox, PriceTag } from '@lumin/ui';
import { cartCount, cartQuoteItems, cartSignature, selectedItems } from '@/lib/cart';
import { useCart } from '@/lib/cart-store';
import { quoteCart, type QuoteLine } from '@/lib/quote';
import { CartLine, type LinePriceStatus } from './cart-line';
import { CtaLink } from './cta-link';
import { BagIcon } from './icons';

/** Debounce before (re-)quoting: coalesces a burst of stepper taps into one server round-trip. Short
 *  enough that a settled cart prices almost immediately. */
const QUOTE_DEBOUNCE_MS = 350;

type QuoteState =
  | { status: 'idle' }
  | { status: 'loading' }
  // A resolved quote carries the cart `signature` it priced. A quote is only applied to the render when
  // that signature still matches the current cart — this closes the one-frame window after an
  // index-shifting removal where `items` has already updated (synchronous store re-render) but `quote`
  // still holds the pre-edit result, which would otherwise paint a neighbouring line's total / a stale
  // subtotal (positional misalignment). A mismatched (superseded) quote falls through to the skeleton.
  | { status: 'ok'; signature: string; lines: QuoteLine[]; subtotal: number }
  // `no_shipping_rule` is unreachable here (the cart sends no province) but is part of quoteCart's union
  // now (P2-b/P2-d); it degrades into the generic pricing-error copy below.
  | { status: 'error'; signature: string; code: 'unavailable' | 'no_shipping_rule' | 'error' };

/**
 * The cart page (/gio-hang), on the hi-fi 05 layout: the line list (each with its "chọn món" checkbox
 * + a "Chọn tất cả" header control) and, on desktop, the cream "Tóm tắt" summary card on the right.
 * ONLY the selected lines are priced — server-side via the quoteCart Server Action (POST /price/quote);
 * the subtotal and every line total stay server-authoritative, never summed on the client (conventions
 * §Tiền). Quantity edits are instant (local store) while the price re-quotes; a removed last unit drops
 * the line; deselected lines stay in the cart but out of the quote and out of checkout. Renders the
 * full state set: a mount skeleton (localStorage isn't readable during SSR), empty, priced, and a
 * retryable error.
 */
export function CartView() {
  const t = useTranslations('cart');
  const tCore = useTranslations('core.cart');
  const { items, setQuantity, setSelected, selectAll } = useCart();

  // localStorage is unreadable during SSR/first paint → gate on mount so we show a skeleton instead of
  // flashing the empty state before the persisted cart loads.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [quote, setQuote] = useState<QuoteState>({ status: 'idle' });
  const [retryNonce, setRetryNonce] = useState(0);
  // The priced shape is the SELECTED lines only (hi-fi 05 chọn món) — the signature spans selection
  // state, so a checkbox toggle re-quotes.
  const selected = selectedItems(items);
  const signature = cartSignature(items);
  const allSelected = items.length > 0 && selected.length === items.length;

  useEffect(() => {
    if (selected.length === 0) {
      setQuote({ status: 'idle' });
      return;
    }
    let cancelled = false;
    setQuote({ status: 'loading' });
    const timer = setTimeout(async () => {
      const result = await quoteCart(cartQuoteItems(selected));
      // A newer cart shape (or unmount) supersedes this in-flight quote — the cleanup flips `cancelled`.
      if (cancelled) return;
      setQuote(
        result.ok
          ? { status: 'ok', signature, lines: result.lines, subtotal: result.subtotal }
          : { status: 'error', signature, code: result.code },
      );
    }, QUOTE_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // Keyed on `signature` (a stable string of the priced shape — configuration + qty + SELECTION —
    // derived from `items`) rather than the `items`/`selected` arrays, whose identity changes every
    // render; retryNonce re-runs the same quote after a failure. The selected-items closure is always
    // current because a signature change follows a re-render.
  }, [signature, retryNonce]);

  // A resolved quote counts only while it still describes the CURRENT cart (signature match) — a
  // superseded quote (from before the latest edit) is treated as loading, so line totals stay
  // positionally aligned with the SELECTED lines and no stale subtotal/line paints during the re-quote
  // window. (Narrowed to the variant-or-null so TS keeps `okQuote.lines`/`errQuote.code` typed below.)
  const okQuote = quote.status === 'ok' && quote.signature === signature ? quote : null;
  const errQuote = quote.status === 'error' && quote.signature === signature ? quote : null;
  const priceStatus: LinePriceStatus = okQuote ? 'ok' : errQuote ? 'error' : 'loading';
  // Quote lines align positionally with `selected`; map each selected key to its priced total.
  const totalByKey = new Map<string, number>();
  if (okQuote) {
    selected.forEach((item, i) => {
      const line = okQuote.lines[i];
      if (line) totalByKey.set(item.key, line.lineTotal);
    });
  }

  if (!mounted) {
    return <CartSkeleton label={t('heading')} />;
  }

  return (
    <section className="mx-auto w-full max-w-[1100px] px-4 py-6 md:px-6 md:py-10">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="font-display text-2xl font-bold text-text-strong md:text-3xl">
          {t('heading')}
        </h1>
        {items.length > 0 ? (
          <Checkbox
            label={t('selectAll')}
            checked={allSelected}
            onChange={(event) => selectAll(event.target.checked)}
          />
        ) : null}
      </div>

      {items.length === 0 ? (
        <div className="mx-auto mt-8 flex max-w-md flex-col items-center gap-3 rounded-lg border-2 border-border-strong bg-surface-card p-10 text-center shadow-pop-sm">
          <span
            aria-hidden="true"
            className="flex h-20 w-20 items-center justify-center rounded-full border-2 border-dashed border-border-default bg-surface-sunken text-text-subtle"
          >
            <BagIcon className="h-9 w-9" />
          </span>
          <p className="font-display text-lg font-bold text-text-strong">{tCore('empty')}</p>
          <CtaLink href="/" className="mt-2">
            {tCore('exploreCta')}
          </CtaLink>
        </div>
      ) : (
        <div className="mt-4 gap-8 lg:grid lg:grid-cols-[1fr_320px] lg:items-start">
          <div>
            <p className="text-sm text-text-muted">
              {t('itemCount', { count: cartCount(selected) })}
            </p>

            <ul className="mt-2">
              {items.map((item) => (
                <CartLine
                  key={item.key}
                  item={item}
                  lineTotal={totalByKey.get(item.key) ?? null}
                  priceStatus={item.selected ? priceStatus : 'ok'}
                  onQuantityChange={(qty) => setQuantity(item.key, qty)}
                  onSelectedChange={(on) => setSelected(item.key, on)}
                />
              ))}
            </ul>
          </div>

          {/* Hi-fi "Tóm tắt": cream card, cocoa border, pop shadow; the CTA lives inside the card. */}
          <div className="mt-6 rounded-md border-2 border-border-strong bg-surface-sunken p-5 shadow-pop-sm lg:sticky lg:top-24 lg:mt-0">
            <h2 className="font-display text-lg font-bold text-text-strong">
              {t('summaryHeading')}
            </h2>

            <div className="mt-3 flex items-center justify-between gap-3">
              <span className="text-sm text-text-body">
                {t('subtotalLabel')}{' '}
                <span className="font-mono text-xs text-text-muted">({selected.length})</span>
              </span>
              {/* aria-live so assistive tech announces the recomputed subtotal after a quote settles. */}
              <span aria-live="polite">
                {selected.length === 0 ? (
                  <span className="text-sm text-text-muted">—</span>
                ) : okQuote ? (
                  <PriceTag amount={okQuote.subtotal} className="text-lg" />
                ) : errQuote ? (
                  <span className="text-sm font-semibold text-danger">
                    {errQuote.code === 'unavailable' ? t('unavailableError') : t('pricingError')}
                  </span>
                ) : (
                  <span
                    aria-hidden="true"
                    className="inline-block h-6 w-24 animate-pulse rounded bg-surface-card motion-reduce:animate-none"
                  />
                )}
              </span>
            </div>

            {/* A transient failure (`error`) can be retried; an `unavailable` line (422) would just
                re-fail the identical request, so there we lean on the copy ("thử xoá rồi thêm lại") —
                editing a line changes the signature and auto-re-quotes. */}
            {errQuote?.code === 'error' ? (
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => setRetryNonce((n) => n + 1)}
                  className="inline-flex min-h-11 items-center rounded-pill border-2 border-border-strong bg-surface-card px-5 font-display text-sm font-semibold text-text-strong transition-colors hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky focus-visible:ring-offset-2"
                >
                  {t('retry')}
                </button>
              </div>
            ) : errQuote ? null : (
              <p className="mt-2 border-t border-dashed border-border-default pt-2 font-mono text-xs text-text-muted">
                {t('shippingNote')}
              </p>
            )}

            {/* Primary entry into checkout. Available whenever ≥1 line is selected — the cart's own
                debounced quote is display-only; /thanh-toan re-prices + validates server-side and owns
                every error/empty state, so navigation is never gated on a transient cart-quote hiccup. */}
            {selected.length > 0 ? (
              <CtaLink href="/thanh-toan" className="mt-4 w-full">
                {t('checkoutCta')} <span aria-hidden="true">→</span>
              </CtaLink>
            ) : (
              <p className="mt-4 text-sm text-text-muted">{t('noneSelected')}</p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

/** Mount-time placeholder while the persisted cart loads (localStorage is client-only). */
function CartSkeleton({ label }: { label: string }) {
  return (
    <section className="mx-auto w-full max-w-[1100px] px-4 py-6 md:px-6 md:py-10">
      <h1 className="font-display text-2xl font-bold text-text-strong md:text-3xl">{label}</h1>
      <ul className="mt-6" aria-hidden="true">
        {[0, 1].map((i) => (
          <li key={i} className="flex items-center gap-3 border-b border-border-subtle py-4">
            <span className="h-16 w-16 shrink-0 animate-pulse rounded-md bg-surface-sunken motion-reduce:animate-none" />
            <span className="h-4 flex-1 animate-pulse rounded bg-surface-sunken motion-reduce:animate-none" />
          </li>
        ))}
      </ul>
    </section>
  );
}
