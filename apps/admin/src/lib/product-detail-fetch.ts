import { cookies } from 'next/headers';
import { createApiClient, type components } from '@lumin/api-client';
import { SESSION_COOKIE, coreApiBaseUrl } from './session';

// Server-only single-product read for the editor (P3-l l-1): GET /admin/products/{id} forwarding the
// session cookie. A 404 (unknown id) returns null so the page renders its friendly not-found; any other
// failure throws to (app)/error.tsx. Mirrors orders-fetch.fetchAdminOrderDetail.
export async function fetchAdminProductDetail(
  id: string,
): Promise<components['schemas']['Product'] | null> {
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  const client = createApiClient({
    baseUrl: coreApiBaseUrl(),
    headers: session ? { cookie: `${SESSION_COOKIE}=${session}` } : {},
  });

  const { data, error, response } = await client.GET('/admin/products/{id}', {
    params: { path: { id } },
    cache: 'no-store',
  });
  if (response.status === 404) return null;
  if (error || !data) {
    throw new Error(`admin product detail fetch failed (${response.status})`);
  }
  return data;
}
