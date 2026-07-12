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

// Server-only read for the admin categories MANAGEMENT page (/danh-muc, P3-o). Unlike fetchCategories above
// (the editor picker, which reuses the public active-only /categories), this hits GET /admin/categories: the
// internal projection of EVERY category with its productCount across all statuses. `no-store` so the list is
// live after a create/rename/delete. Unauthenticated is handled by middleware; a present-but-invalid cookie
// → core-api 401 → thrown → (app)/error.tsx.
export async function fetchAdminCategories(): Promise<components['schemas']['AdminCategory'][]> {
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  const client = createApiClient({
    baseUrl: coreApiBaseUrl(),
    headers: session ? { cookie: `${SESSION_COOKIE}=${session}` } : {},
  });

  const { data, error, response } = await client.GET('/admin/categories', { cache: 'no-store' });
  if (error || !data) {
    throw new Error(`admin categories fetch failed (${response.status})`);
  }
  return data;
}
