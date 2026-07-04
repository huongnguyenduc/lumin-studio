'use server';

import { createApiClient } from '@lumin/api-client';
import { coreApiBaseUrl } from './core-api';
import type { LookupResult, TimelineData } from './order-lookup-view';

// The client bridge to GET /orders/lookup. The tracker polls from the browser, but CORE_API_URL is
// server-only (lib/core-api.ts) — so the client calls THIS Server Action, which reaches core-api
// server-side and returns just the safe timeline. Mirrors lib/quote.ts: the raw error envelope /
// messageKey is NEVER forwarded to the client (always-must #3) — failures map to a small closed `code`
// the screen translates itself. A uniform 404 (unknown code OR phone mismatch) stays uniform; a 429
// becomes a back-off signal. Persists nothing; sends no PII beyond the two fields the guest typed.

export async function lookupOrder(code: string, phone: string): Promise<LookupResult> {
  // Both fields are required and a blank one can't match — skip the round-trip (and don't spend the
  // per-code rate budget) rather than send an empty query the endpoint would 400/404 on anyway.
  if (!code.trim() || !phone.trim()) return { ok: false, code: 'not_found' };

  try {
    const client = createApiClient({ baseUrl: coreApiBaseUrl() });
    const { data, response } = await client.GET('/orders/lookup', {
      params: { query: { code, phone } },
      // The tracker must always read the LIVE status — never serve a cached poll.
      cache: 'no-store',
    });
    if (data) {
      const order: TimelineData = {
        code: data.code,
        status: data.status,
        milestones: data.milestones.map((m) => ({ status: m.status, at: m.at })),
        ...(data.trackingCode ? { trackingCode: data.trackingCode } : {}),
        createdAt: data.createdAt,
      };
      return { ok: true, order };
    }
    // 404 = unknown code OR phone mismatch (uniform, no enumeration). 429 = rate-limited → the client
    // backs off. Anything else (400 shape, 5xx) is a generic retryable error — never a per-field leak.
    if (response.status === 404) return { ok: false, code: 'not_found' };
    if (response.status === 429) return { ok: false, code: 'rate_limited' };
    return { ok: false, code: 'error' };
  } catch {
    // Origin down / network reject → generic retryable error.
    return { ok: false, code: 'error' };
  }
}
