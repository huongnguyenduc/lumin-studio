import 'server-only';

import { cookies } from 'next/headers';
import { createApiClient } from '@lumin/api-client';
import { coreApiBaseUrl } from './core-api';
import {
  CUSTOMER_COOKIE,
  CUSTOMER_PROFILE_COOKIE,
  parseProfile,
  type CustomerProfile,
} from './customer-session-cookie';
import type { TimelineData } from './order-lookup-view';

// Server-only reads for the account pages (/tai-khoan). Importing next/headers + CORE_API_URL keeps this
// off the client bundle (a client import is a build error). The account order history reuses the guest
// P1-o timeline model: GET /customer/orders returns the SAME PublicOrderTimeline projection as the guest
// lookup, just scoped to the signed-in customer (no money/PII/address — ADR-032). The cookie forward
// mirrors admin dashboard-fetch.ts; the raw envelope/messageKey is never surfaced (always-must #3).

export type OrdersResult =
  | { status: 'ok'; orders: TimelineData[] }
  // no session cookie, OR core-api rejected it (expired/invalid JWT → 401). The hub renders a login prompt.
  | { status: 'unauthenticated' }
  | { status: 'error' }; // network / 5xx — retryable

export async function fetchCustomerOrders(): Promise<OrdersResult> {
  const jwt = (await cookies()).get(CUSTOMER_COOKIE)?.value;
  if (!jwt) return { status: 'unauthenticated' }; // no session → skip the round-trip

  try {
    const client = createApiClient({
      baseUrl: coreApiBaseUrl(),
      // core-api reads exactly this cookie name (middleware_auth.go) — forward it verbatim.
      headers: { cookie: `${CUSTOMER_COOKIE}=${jwt}` },
    });
    // History is a one-shot live read (never a cached poll — the account's status can change).
    const { data, response } = await client.GET('/customer/orders', { cache: 'no-store' });
    if (data) {
      // Map the wire PublicOrderTimeline[] into the storefront-owned TimelineData[] (same shape the guest
      // Server Action produces, order-lookup.ts) so the client never depends on the generated API types.
      const orders: TimelineData[] = data.map((o) => ({
        code: o.code,
        status: o.status,
        milestones: o.milestones.map((m) => ({ status: m.status, at: m.at })),
        ...(o.trackingCode ? { trackingCode: o.trackingCode } : {}),
        createdAt: o.createdAt,
      }));
      return { status: 'ok', orders };
    }
    if (response.status === 401) return { status: 'unauthenticated' };
    return { status: 'error' };
  } catch {
    return { status: 'error' };
  }
}

/** The cached identity for the account greeting. Display-only — auth is the JWT, so a missing/corrupt
 *  profile cookie just drops the "Chào {name}" greeting, never the session. */
export async function getCustomerProfile(): Promise<CustomerProfile | null> {
  return parseProfile((await cookies()).get(CUSTOMER_PROFILE_COOKIE)?.value);
}
