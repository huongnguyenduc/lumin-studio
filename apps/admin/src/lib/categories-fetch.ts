import { cookies } from 'next/headers';
import { createApiClient, type components } from '@lumin/api-client';
import { SESSION_COOKIE, coreApiBaseUrl } from './session';

// Server-only category read for the editor's category picker (P3-l l-1). Uses the ADMIN GET /admin/categories
// (owner+staff) so EVERY category is selectable — the create form must offer a category even before any of
// them has an active product. It formerly reused the PUBLIC /categories, which only lists categories with
// >= 1 ACTIVE product (plan §6): on a fresh/cleaned catalog that left the picker EMPTY even though categories
// existed (the P3-o admin endpoint didn't exist yet when this was first written). Projects the AdminCategory
// list down to the plain {id, slug, name} the picker needs. Throws to (app)/error.tsx on failure.
export async function fetchCategories(): Promise<components['schemas']['Category'][]> {
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  const client = createApiClient({
    baseUrl: coreApiBaseUrl(),
    headers: session ? { cookie: `${SESSION_COOKIE}=${session}` } : {},
  });

  const { data, error, response } = await client.GET('/admin/categories', { cache: 'no-store' });
  if (error || !data) {
    throw new Error(`categories fetch failed (${response.status})`);
  }
  return data.map((c) => ({ id: c.id, slug: c.slug, name: c.name }));
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
