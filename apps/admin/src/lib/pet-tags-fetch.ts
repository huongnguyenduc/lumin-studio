import { cookies } from 'next/headers';
import { createApiClient, type components } from '@lumin/api-client';
import { SESSION_COOKIE, coreApiBaseUrl } from './session';

// Server-side read for the Pet Tag roster (P3-t t-5), forwarding the httpOnly admin session cookie.
// Importing `next/headers` makes this module server-only, so the session JWT never reaches client JS
// (ADR-030). Admin-gated (owner AND staff via the default classify — fulfillment work, mirrors the print
// board + customers). Mirrors ./customers-fetch; the unauthenticated path is handled earlier by
// `middleware` (redirect to /dang-nhap); a present-but-invalid cookie → core-api 401 → route error boundary.

async function adminClient() {
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  return createApiClient({
    baseUrl: coreApiBaseUrl(),
    headers: session ? { cookie: `${SESSION_COOKIE}=${session}` } : {},
  });
}

/** Fetch the whole Pet Tag roster (GET /admin/pet-tags, P3-t t-5), newest tag first. `no-store` keeps it
 *  live; the client filters by status in memory (mirrors the customers list). Throws on a non-2xx → route
 *  error boundary ((app)/error.tsx). */
export async function fetchAdminPetTags(): Promise<components['schemas']['AdminPetTag'][]> {
  const client = await adminClient();
  const { data, error, response } = await client.GET('/admin/pet-tags', { cache: 'no-store' });
  if (error || !data) {
    throw new Error(`admin pet tags fetch failed (${response.status})`);
  }
  return data;
}
