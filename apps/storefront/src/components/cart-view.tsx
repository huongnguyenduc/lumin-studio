'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { PriceTag } from '@lumin/ui';
import { cartCount, cartQuoteItems, cartSignature } from '@/lib/cart';
import { useCart } from '@/lib/cart-store';
import { quoteCart, type QuoteLine } from '@/lib/quote';
import { CartLine, type LinePriceStatus } from './cart-line';
import { CtaLink } from './cta-link';

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
  | { status: 'error'; signature: string; code: 'unavailable' | 'error' };

/**
 * The cart page (/gio-hang). Reads the persisted cart (useCart), then prices it server-side via the
 * quoteCart Server Action — the subtotal and every line total are ALWAYS server-authoritative (POST
 * /price/quote), never summed on the client (conventions §Tiền). Quantity edits are instant (local
 * store) while the price re-quotes; a removed last unit drops the line. Renders the full state set:
 * a mount skeleton (localStorage isn't readable during SSR), empty, priced, and a retryable error.
 *
 * BOUNDARY (plan §0, Phase-1/2 cứng): there is NO checkout here — the footer shows the subtotal and a
 * "shipping is calculated later" note, and nothing creates an order or takes an address/payment.
 */
export function CartView() {
  const t = useTranslations('cart');
  const tCore = useTranslations('core.cart');
  const { items, setQuantity } = useCart();

  // localStorage is unreadable during SSR/first paint → gate on mount so we show a skeleton instead of
  // flashing the empty state before the persisted cart loads.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [quote, setQuote] = useState<QuoteState>({ status: 'idle' });
  const [retryNonce, setRetryNonce] = useState(0);
  const signature = cartSignature(items);

  useEffect(() => {
    if (items.length === 0) {
      setQuote({ status: 'idle' });
      return;
    }
    let cancelled = false;
    setQuote({ status: 'loading' });
    const timer = setTimeout(async () => {
      const result = await quoteCart(cartQuoteItems(items));
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
    // Keyed on `signature` (a stable string of the priced shape derived from `items`) rather than the
    // `items` array, whose identity changes every render; retryNonce re-runs the same quote after a
    // failure. The new-items closure is always current because a signature change follows a re-render.
  }, [signature, retryNonce]);

  // A resolved quote counts only while it still describes the CURRENT cart (signature match) — a
  // superseded quote (from before the latest edit) is treated as loading, so line totals stay
  // positionally aligned with `items` and no stale subtotal/line paints during the re-quote window.
  // (Narrowed to the variant-or-null so TS keeps `okQuote.lines`/`errQuote.code` typed below.)
  const okQuote = quote.status === 'ok' && quote.signature === signature ? quote : null;
  const errQuote = quote.status === 'error' && quote.signature === signature ? quote : null;
  const priceStatus: LinePriceStatus = okQuote ? 'ok' : errQuote ? 'error' : 'loading';

  if (!mounted) {
    return <CartSkeleton label={t('heading')} />;
  }

  return (
    <section className="mx-auto w-full max-w-[720px] px-4 py-6 md:px-6 md:py-10">
      <h1 className="font-display text-2xl font-bold text-text-strong md:text-3xl">
        {t('heading')}
      </h1>

      {items.length === 0 ? (
        <div className="mt-6 rounded-lg border-2 border-dashed border-border-default bg-surface-sunken p-10 text-center">
          <p className="text-text-muted">{tCore('empty')}</p>
          <CtaLink href="/" className="mt-4">
            {tCore('exploreCta')}
          </CtaLink>
        </div>
      ) : (
        <>
          <p className="mt-1 text-sm text-text-muted">
            {t('itemCount', { count: cartCount(items) })}
          </p>

          <ul className="mt-4">
            {items.map((item, i) => (
              <CartLine
                key={item.key}
                item={item}
                lineTotal={okQuote ? (okQuote.lines[i]?.lineTotal ?? null) : null}
                priceStatus={priceStatus}
                onQuantityChange={(qty) => setQuantity(item.key, qty)}
              />
            ))}
          </ul>

          <div className="mt-6 rounded-lg border-2 border-border-strong bg-surface-card p-4">
            <div className="flex items-center justify-between gap-3">
              <span className="font-display text-base font-semibold text-text-strong">
                {t('subtotalLabel')}
              </span>
              {/* aria-live so assistive tech announces the recomputed subtotal after a quote settles. */}
              <span aria-live="polite">
                {okQuote ? (
                  <PriceTag amount={okQuote.subtotal} className="text-xl" />
                ) : errQuote ? (
                  <span className="text-sm font-semibold text-accent-flame">
                    {errQuote.code === 'unavailable' ? t('unavailableError') : t('pricingError')}
                  </span>
                ) : (
                  <span
                    aria-hidden="true"
                    className="inline-block h-6 w-24 animate-pulse rounded bg-surface-sunken motion-reduce:animate-none"
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
              <p className="mt-2 text-sm text-text-muted">{t('shippingNote')}</p>
            )}
          </div>
        </>
      )}
    </section>
  );
}

/** Mount-time placeholder while the persisted cart loads (localStorage is client-only). */
function CartSkeleton({ label }: { label: string }) {
  return (
    <section className="mx-auto w-full max-w-[720px] px-4 py-6 md:px-6 md:py-10">
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
