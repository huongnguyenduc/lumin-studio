import { cookies } from 'next/headers';
import { createApiClient, type components } from '@lumin/api-client';
import { SESSION_COOKIE, coreApiBaseUrl } from './session';

// Server-side reads for the customers surface (P3-p, Khách hàng), forwarding the httpOnly admin session
// cookie. Importing `next/headers` makes this module server-only, so the session JWT never reaches client
// JS (ADR-030); the RSC reads it and forwards it to core-api. PDPL: customer PII is admin-gated (owner AND
// staff), never public. Mirrors ./settings-fetch. The unauthenticated path is handled earlier by
// `middleware` (redirect to /dang-nhap); a present-but-invalid cookie → core-api 401 → route error
// boundary ((app)/error.tsx).

async function adminClient() {
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  return createApiClient({
    baseUrl: coreApiBaseUrl(),
    headers: session ? { cookie: `${SESSION_COOKIE}=${session}` } : {},
  });
}

/** Fetch every customer with their order roll-up (GET /admin/customers, P3-p), most-recently-active
 *  first. `no-store` so the roster is always live. The list is unpaginated (a made-to-order shop's base
 *  is small); the client searches it in memory. Throws on a non-2xx → route error boundary. */
export async function fetchAdminCustomers(): Promise<components['schemas']['AdminCustomer'][]> {
  const client = await adminClient();
  const { data, error, response } = await client.GET('/admin/customers', { cache: 'no-store' });
  if (error || !data) {
    throw new Error(`admin customers fetch failed (${response.status})`);
  }
  return data;
}

/** Fetch ONE customer's full profile (GET /admin/customers/{id}, P3-p), forwarding the session cookie.
 *  Returns `null` on 404 so the detail page can render its "không tìm thấy" state; any other non-2xx
 *  throws to the route error boundary. */
export async function fetchAdminCustomer(
  id: string,
): Promise<components['schemas']['AdminCustomerDetail'] | null> {
  const client = await adminClient();
  const { data, error, response } = await client.GET('/admin/customers/{id}', {
    params: { path: { id } },
    cache: 'no-store',
  });
  if (response.status === 404) return null;
  if (error || !data) {
    throw new Error(`admin customer detail fetch failed (${response.status})`);
  }
  return data;
}
