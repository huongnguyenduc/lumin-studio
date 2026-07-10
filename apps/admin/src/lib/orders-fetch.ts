import { cookies } from 'next/headers';
import { createApiClient, type components } from '@lumin/api-client';
import type { OrderStatus } from '@lumin/core';
import { SESSION_COOKIE, coreApiBaseUrl } from './session';

// Server-side fetch of a page of admin orders (GET /admin/orders, P3-b), forwarding the admin
// session cookie. Importing `next/headers` makes this module server-only, which is what we want:
// the session JWT is an httpOnly + SameSite=Strict cookie (ADR-030), so it never reaches client JS
// — the page reads it on the server and forwards it to core-api. Mirrors ./dashboard-fetch.

export interface AdminOrdersQuery {
  /** Omit for all statuses ("Tất cả"). */
  status?: OrderStatus;
  page: number;
  pageSize: number;
}

/**
 * Fetch one page of admin orders, forwarding the session cookie. `no-store` so the list is always
 * live (spec §03). Throws on a missing session or a non-2xx response so the route error boundary
 * ((app)/error.tsx) renders the retry state. As with the dashboard, the unauthenticated path is
 * handled earlier by `middleware` (redirect to /dang-nhap); what can still land here is a
 * present-but-invalid cookie → core-api 401 → retry boundary (see ./dashboard-fetch for why we do
 * not redirect from here).
 */
export async function fetchAdminOrders(
  query: AdminOrdersQuery,
): Promise<components['schemas']['AdminOrderList']> {
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  const client = createApiClient({
    baseUrl: coreApiBaseUrl(),
    headers: session ? { cookie: `${SESSION_COOKIE}=${session}` } : {},
  });

  const { data, error, response } = await client.GET('/admin/orders', {
    params: { query: { status: query.status, page: query.page, pageSize: query.pageSize } },
    cache: 'no-store',
  });
  if (error || !data) {
    throw new Error(`admin orders fetch failed (${response.status})`);
  }
  return data;
}
