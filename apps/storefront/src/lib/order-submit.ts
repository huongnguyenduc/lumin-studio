'use server';

import { createApiClient } from '@lumin/api-client';
import type { components } from '@lumin/api-client';
import { coreApiBaseUrl } from './core-api';
import type { CreateWebOrderInput } from './checkout-form';

// The two server-side bridges the payment step (P2-f) needs. Like lib/quote.ts, these run as Server
// Actions because CORE_API_URL is server-only (lib/core-api.ts) — the browser never reaches core-api
// directly. Between them the browser uploads the receipt bytes STRAIGHT to Garage (the presigned POST's
// uploadUrl), so core-api never proxies the file. Both actions map any failure to a small, safe `code`
// the view translates itself — the raw Vietnamese messageKey / error envelope never leaks through
// (always-must #3; ADR-032). They persist nothing.

export type ProofUploadContentType =
  components['schemas']['PaymentProofUploadInput']['contentType'];
export type PaymentProofUpload = components['schemas']['PaymentProofUpload'];
export type CreateOrderResult = components['schemas']['CreateOrderResult'];

/** Ask core-api for a short-lived presigned POST form for ONE receipt image of the given MIME type
 *  (P2-c). On success the browser POSTs the file to `upload.uploadUrl` and sends `upload.finalUrl` as
 *  paymentProofUrl. Any failure collapses to a generic retryable `error`. */
export async function createPaymentProofUpload(
  contentType: ProofUploadContentType,
): Promise<{ ok: true; upload: PaymentProofUpload } | { ok: false; code: 'error' }> {
  try {
    const client = createApiClient({ baseUrl: coreApiBaseUrl() });
    const { data } = await client.POST('/checkout/payment-proof-upload', {
      body: { contentType },
    });
    if (data) return { ok: true, upload: data };
    return { ok: false, code: 'error' };
  } catch {
    return { ok: false, code: 'error' };
  }
}

/**
 * Create the web order (POST /orders → PENDING_CONFIRM with the CK proof). Returns the created order plus
 * its phone-less trackingToken (P2-i) on 201. Two 422s get their own friendly code because they are
 * recoverable shopper-facing states — `no_stk` (shop has no STK configured, P2-a) and `no_shipping_rule`
 * (the chosen province became unshippable between the quote and submit). Everything else (a would-be
 * client-money mismatch, an unavailable line, ack/proof gaps the UI already prevents, network / 5xx) maps
 * to a single loud `error` — the client sends no prices, so a rejection means retry, never silently
 * proceed.
 */
export async function placeOrder(
  input: CreateWebOrderInput,
): Promise<
  | { ok: true; result: CreateOrderResult }
  | { ok: false; code: 'no_stk' | 'no_shipping_rule' | 'error' }
> {
  try {
    const client = createApiClient({ baseUrl: coreApiBaseUrl() });
    const { data, error, response } = await client.POST('/orders', { body: input });
    if (data) return { ok: true, result: data };
    if (response.status === 422) {
      if (error?.code === 'NO_STK_CONFIGURED') return { ok: false, code: 'no_stk' };
      if (error?.code === 'NO_SHIPPING_RULE') return { ok: false, code: 'no_shipping_rule' };
    }
    return { ok: false, code: 'error' };
  } catch {
    return { ok: false, code: 'error' };
  }
}
