import 'server-only';

import { createApiClient } from '@lumin/api-client';
import type { components } from '@lumin/api-client';
import { coreApiBaseUrl } from './core-api';

// Server-side reader for GET /checkout/config (P2-a): the public checkout bootstrap. C1 (the info step,
// P2-d) uses `shippableProvinces` (the dropdown source) + `refundPolicy` (the pre-purchase đổi-trả
// disclosure, compliance §3); C2 (payment, P2-f) uses `bankAccount` + the server-built `vietqrUrl`.
// Fetched once in the /thanh-toan RSC shell and passed down through the steps — never a client call
// (there is no reason to expose an RPC endpoint for it). Any failure collapses to one opaque `error`
// so the view owns its retryable copy (always-must #3: no backend prose leaks through).

export type CheckoutConfig = components['schemas']['CheckoutConfig'];

export type CheckoutConfigResult =
  | { ok: true; config: CheckoutConfig }
  | { ok: false; code: 'error' };

export async function fetchCheckoutConfig(): Promise<CheckoutConfigResult> {
  try {
    const client = createApiClient({ baseUrl: coreApiBaseUrl() });
    const { data } = await client.GET('/checkout/config', {});
    if (data) return { ok: true, config: data };
    return { ok: false, code: 'error' };
  } catch {
    return { ok: false, code: 'error' };
  }
}
