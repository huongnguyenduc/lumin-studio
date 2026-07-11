import { cookies } from 'next/headers';
import { createApiClient, type components } from '@lumin/api-client';
import { SESSION_COOKIE, coreApiBaseUrl } from './session';

// Server-side fetch of the WHOLE admin catalog (GET /admin/products, P3-j), forwarding the admin
// session cookie. The endpoint is not paginated (a made-to-order catalog is small) and we omit the
// ?status filter so the client view can switch tabs + search over the full set without a re-fetch.
// Importing `next/headers` makes this module server-only — the httpOnly session JWT (ADR-030) never
// reaches client JS. Mirrors ./orders-fetch / ./dashboard-fetch (see the latter for why we throw to
// the retry boundary instead of redirecting on a present-but-invalid cookie).

export async function fetchAdminProducts(): Promise<
  components['schemas']['AdminProductSummary'][]
> {
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  const client = createApiClient({
    baseUrl: coreApiBaseUrl(),
    headers: session ? { cookie: `${SESSION_COOKIE}=${session}` } : {},
  });

  const { data, error, response } = await client.GET('/admin/products', { cache: 'no-store' });
  if (error || !data) {
    throw new Error(`admin products fetch failed (${response.status})`);
  }
  return data;
}
