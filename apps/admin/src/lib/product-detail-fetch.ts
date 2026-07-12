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

// The filament palette for the editor's colour dialog (P3-l l-3): a colour may link to a shop filament
// (ADR-039) so deduct-on-print knows its spool. Auxiliary to the editor — a miss returns [] (the link
// dropdown just shows "unlinked"), never blocking the page the product itself loaded.
export async function fetchFilaments(): Promise<components['schemas']['FilamentMaterial'][]> {
  try {
    const session = (await cookies()).get(SESSION_COOKIE)?.value;
    const client = createApiClient({
      baseUrl: coreApiBaseUrl(),
      headers: session ? { cookie: `${SESSION_COOKIE}=${session}` } : {},
    });
    const { data } = await client.GET('/admin/filament-materials', { cache: 'no-store' });
    return data ?? [];
  } catch {
    return [];
  }
}
