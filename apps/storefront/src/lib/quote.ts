'use server';

import { createApiClient } from '@lumin/api-client';
import { coreApiBaseUrl } from './core-api';
import { MAX_LINES, type QuoteItem } from './cart';

// The client bridge to POST /price/quote. The cart runs in the browser, but CORE_API_URL is server-only
// (lib/core-api.ts) — so the client calls THIS Server Action, which reaches core-api server-side and
// returns just the priced result. Keeping the quote here (not a NEXT_PUBLIC_ direct call) preserves the
// "no CORE_API_URL in client bundle" guarantee and the server-authoritative money boundary: the client
// sends only a SELECTION (no price), the server re-derives every price (ADR-019 / always-must #2).
//
// The action never forwards the raw error envelope/messageKey to the client — it maps failures to a
// small, safe `code` the caller translates itself (always-must #3: the Vietnamese messageKey/domain
// message never leaks through a generic proxy). It reads only the machine `code` token (ADR-032) to
// tell an unshippable province apart from an unpriceable line. It persists nothing.

/** One priced line, positionally aligned with the request items. Mirrors PriceQuoteLine (raw int-VND). */
export type QuoteLine = { unitPrice: number; quantity: number; lineTotal: number };

export type QuoteResult =
  /** `shippingFee`/`total` are present ONLY when a province was sent (P2-b) — the checkout summary
   *  reads them; the cart page (no province) sees the same subtotal-only shape as before. */
  | { ok: true; lines: QuoteLine[]; subtotal: number; shippingFee?: number; total?: number }
  /** `unavailable` = a line's product/colour/option is no longer valid (422); `no_shipping_rule` = the
   *  chosen province has no shipping rule (422 NO_SHIPPING_RULE — a per-field-friendly case at checkout);
   *  `error` = network / 5xx / a shape the caller shouldn't have produced. All retryable. */
  | { ok: false; code: 'unavailable' | 'no_shipping_rule' | 'error' };

/**
 * Price a cart server-side. `province`/`ward` (optional, checkout only) fold in the shipping fee +
 * total via the SAME authority as order creation (POST /orders) — never client math. `ward` lets the
 * resolver match an owner-configured ward-narrowed shipping rule (e.g. inner-city fee) before falling
 * back to the province-only rule. Omitted/blank → subtotal only (byte-identical to the cart page's quote).
 */
export async function quoteCart(
  items: QuoteItem[],
  province?: string,
  ward?: string,
): Promise<QuoteResult> {
  // An empty cart has a zero subtotal without a round-trip (the endpoint rejects an empty items[]).
  if (items.length === 0) return { ok: true, lines: [], subtotal: 0 };
  // Defence in depth: the store caps the cart at MAX_LINES, but never send a payload the endpoint would
  // 400 on (maxItems:50) — bound the fan-out before the call.
  if (items.length > MAX_LINES) return { ok: false, code: 'error' };

  const trimmedProvince = province?.trim();
  const trimmedWard = ward?.trim();
  try {
    const client = createApiClient({ baseUrl: coreApiBaseUrl() });
    const { data, error, response } = await client.POST('/price/quote', {
      body: {
        items,
        ...(trimmedProvince ? { province: trimmedProvince } : {}),
        ...(trimmedWard ? { ward: trimmedWard } : {}),
      },
    });
    if (data) {
      return {
        ok: true,
        lines: data.lines,
        subtotal: data.subtotal,
        ...(data.shippingFee !== undefined ? { shippingFee: data.shippingFee } : {}),
        ...(data.total !== undefined ? { total: data.total } : {}),
      };
    }
    // 422 NO_SHIPPING_RULE → the province isn't shippable (surface a friendly per-field prompt to pick
    // another); any other 422 → a line is no longer priceable. 400/5xx/network → generic retryable.
    if (response.status === 422) {
      return {
        ok: false,
        code: error?.code === 'NO_SHIPPING_RULE' ? 'no_shipping_rule' : 'unavailable',
      };
    }
    return { ok: false, code: 'error' };
  } catch {
    // Origin down / network reject → generic retryable error.
    return { ok: false, code: 'error' };
  }
}
