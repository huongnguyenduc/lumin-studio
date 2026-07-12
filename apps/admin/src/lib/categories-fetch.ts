import { cookies } from 'next/headers';
import { createApiClient, type components } from '@lumin/api-client';
import { SESSION_COOKIE, coreApiBaseUrl } from './session';

// Server-only category read for the editor's category picker (P3-l l-1). Reuses the PUBLIC GET /categories
// (there is no admin category endpoint until P3-o), forwarding the session cookie harmlessly. Known limit
// (plan §6): only categories with >= 1 ACTIVE product appear, so the editor merges the product's own
// categoryId as a fallback option. Throws to (app)/error.tsx on failure.
export async function fetchCategories(): Promise<components['schemas']['Category'][]> {
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  const client = createApiClient({
    baseUrl: coreApiBaseUrl(),
    headers: session ? { cookie: `${SESSION_COOKIE}=${session}` } : {},
  });

  const { data, error, response } = await client.GET('/categories', { params: {} });
  // /categories declares no error response (200/304), so `error` narrows to never — capture status first.
  const status = response.status;
  if (error || !data) {
    throw new Error(`categories fetch failed (${status})`);
  }
  return data;
}
