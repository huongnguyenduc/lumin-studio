import type { components } from '@lumin/api-client';
import { api } from './client';

type OrderItemInput = components['schemas']['OrderItemInput'];
type Customer = components['schemas']['Customer'];
type Address = components['schemas']['Address'];
type Order = components['schemas']['Order'];

export type QuoteResult =
  | { ok: true; subtotal: number; shippingFee?: number; total?: number }
  | { ok: false; code: 'unavailable' | 'no_shipping_rule' | 'error' };

// POST /price/quote — server-authoritative price (ZERO client math). `province` (optional) folds in the
// shipping fee + total via the SAME authority as order creation. Mirrors the storefront quoteCart.
export async function quoteOrder(items: OrderItemInput[], province?: string): Promise<QuoteResult> {
  if (items.length === 0) return { ok: true, subtotal: 0 };
  const trimmed = province?.trim();
  try {
    const { data, error, response } = await api.POST('/price/quote', {
      body: { items, ...(trimmed ? { province: trimmed } : {}) },
    });
    if (data) {
      return {
        ok: true,
        subtotal: data.subtotal,
        ...(data.shippingFee !== undefined ? { shippingFee: data.shippingFee } : {}),
        ...(data.total !== undefined ? { total: data.total } : {}),
      };
    }
    if (response.status === 422) {
      return {
        ok: false,
        code: error?.code === 'NO_SHIPPING_RULE' ? 'no_shipping_rule' : 'unavailable',
      };
    }
    return { ok: false, code: 'error' };
  } catch {
    return { ok: false, code: 'error' };
  }
}

export type CreateResult =
  | { ok: true; order: Order }
  | { ok: false; code: 'unavailable' | 'no_shipping_rule' | 'forbidden' | 'error' };

// POST /orders channel=inbox — born PAID, no payment proof (staff already verified the money landed,
// conventions §17). Requires the Bearer actor (staff/owner) → 403 otherwise; the server computes every
// total. The trackingToken in the response is for guest links (P2-i) — the extension ignores it.
export async function createInboxOrder(input: {
  customer: Customer;
  shippingAddress: Address;
  items: OrderItemInput[];
  note?: string;
}): Promise<CreateResult> {
  try {
    const { data, error, response } = await api.POST('/orders', {
      body: { channel: 'inbox', ...input },
    });
    if (data) return { ok: true, order: data.order };
    if (response.status === 403) return { ok: false, code: 'forbidden' };
    if (response.status === 422) {
      return {
        ok: false,
        code: error?.code === 'NO_SHIPPING_RULE' ? 'no_shipping_rule' : 'unavailable',
      };
    }
    return { ok: false, code: 'error' };
  } catch {
    return { ok: false, code: 'error' };
  }
}
