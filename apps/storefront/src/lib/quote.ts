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
// small, safe `code` the cart translates itself (always-must #3: the Vietnamese messageKey/domain
// message never leaks through a generic proxy). It persists nothing.

/** One priced line, positionally aligned with the request items. Mirrors PriceQuoteLine (raw int-VND). */
export type QuoteLine = { unitPrice: number; quantity: number; lineTotal: number };

export type QuoteResult =
  | { ok: true; lines: QuoteLine[]; subtotal: number }
  /** `unavailable` = a line's product/colour/option is no longer valid (422); `error` = network / 5xx /
   *  a shape the cart shouldn't have produced. Both are retryable from the cart. */
  | { ok: false; code: 'unavailable' | 'error' };

export async function quoteCart(items: QuoteItem[]): Promise<QuoteResult> {
  // An empty cart has a zero subtotal without a round-trip (the endpoint rejects an empty items[]).
  if (items.length === 0) return { ok: true, lines: [], subtotal: 0 };
  // Defence in depth: the store caps the cart at MAX_LINES, but never send a payload the endpoint would
  // 400 on (maxItems:50) — bound the fan-out before the call.
  if (items.length > MAX_LINES) return { ok: false, code: 'error' };

  try {
    const client = createApiClient({ baseUrl: coreApiBaseUrl() });
    const { data, response } = await client.POST('/price/quote', { body: { items } });
    if (data) {
      return { ok: true, lines: data.lines, subtotal: data.subtotal };
    }
    // 422 = a selection is no longer priceable (product/colour/option unavailable or removed). Any other
    // non-2xx (400 shape error, 5xx) is a generic retryable error — never a per-field leak.
    return { ok: false, code: response.status === 422 ? 'unavailable' : 'error' };
  } catch {
    // Origin down / network reject → generic retryable error.
    return { ok: false, code: 'error' };
  }
}
