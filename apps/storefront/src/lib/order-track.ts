'use server';

import { createApiClient } from '@lumin/api-client';
import { coreApiBaseUrl } from './core-api';
import type { LookupResult, TimelineData } from './order-lookup-view';

// The client bridge to GET /orders/track — the phone-less sibling of lib/order-lookup.ts. The wait-screen
// (P2-g) polls from the browser, but CORE_API_URL is server-only (lib/core-api.ts), so the client calls
// THIS Server Action. The `token` is the HMAC capability from the order-create 201 (P2-i); it IS the
// authorization — no phone, no account. The endpoint returns the SAME safe PublicOrderTimeline as
// /orders/lookup, so the DTO→view mapping mirrors lib/order-lookup.ts. Failures map to a small closed
// `code` the screen translates itself — the raw error envelope / messageKey never leaks (always-must #3,
// ADR-032). An unknown code OR a wrong/malformed token both return a uniform 404 (no enumeration).
// Persists nothing.

export async function trackOrder(code: string, token: string): Promise<LookupResult> {
  // A blank code or token can't match — skip the round-trip (and the per-code rate budget) rather than
  // send an empty query the endpoint would 400/404 on anyway.
  if (!code.trim() || !token.trim()) return { ok: false, code: 'not_found' };

  try {
    const client = createApiClient({ baseUrl: coreApiBaseUrl() });
    const { data, response } = await client.GET('/orders/track', {
      params: { query: { code, token } },
      // The wait-screen must always read the LIVE status — never serve a cached poll.
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
    // 404 = unknown code OR wrong/absent/malformed token (uniform, no enumeration). 429 = rate-limited →
    // the client backs off. Anything else (400 shape, 5xx) is a generic retryable error.
    if (response.status === 404) return { ok: false, code: 'not_found' };
    if (response.status === 429) return { ok: false, code: 'rate_limited' };
    return { ok: false, code: 'error' };
  } catch {
    // Origin down / network reject → generic retryable error.
    return { ok: false, code: 'error' };
  }
}
