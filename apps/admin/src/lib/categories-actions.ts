'use server';

import { cookies } from 'next/headers';
import { createApiClient, type components } from '@lumin/api-client';
import { SESSION_COOKIE, coreApiBaseUrl } from './session';

// Server Actions for the categories writes (P3-o). CORE_API_URL is server-only, so the browser reaches
// core-api only through these; each forwards the httpOnly session cookie. Every write is owner-only at the
// server (authOwnerOnly) — a staff attempt collapses to `forbidden` here. A DELETE of a category still
// referenced by a product → 409 → `inUse` (reassign/archive the products first). Failures collapse to a
// small view-safe code — the raw Vietnamese error envelope never leaks (always-must #3, ADR-032). Mirrors
// ./product-actions (same WriteCode shape).

type CategoryInput = components['schemas']['CategoryInput'];
type CategoryUpdate = components['schemas']['CategoryUpdate'];

export type CategoryWriteCode = 'forbidden' | 'validation' | 'notFound' | 'inUse' | 'error';
export type CategoryWriteResult = { ok: true } | { ok: false; code: CategoryWriteCode };

function codeFor(status: number): CategoryWriteCode {
  if (status === 403) return 'forbidden';
  if (status === 404) return 'notFound';
  if (status === 409) return 'inUse'; // DELETE of a category still referenced by a product → reassign/archive first
  if (status === 400 || status === 422) return 'validation';
  return 'error';
}

async function authedClient() {
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  return createApiClient({
    baseUrl: coreApiBaseUrl(),
    headers: session ? { cookie: `${SESSION_COOKIE}=${session}` } : {},
  });
}

/** Create a category (POST /admin/categories). A duplicate slug → `validation`. */
export async function createCategory(body: CategoryInput): Promise<CategoryWriteResult> {
  try {
    const client = await authedClient();
    const { data, response } = await client.POST('/admin/categories', { body });
    return data ? { ok: true } : { ok: false, code: codeFor(response.status) };
  } catch {
    return { ok: false, code: 'error' };
  }
}

/**
 * Edit a category (PATCH /admin/categories/{id}) — name/slug plus the o-2 menu metadata (description, cover
 * imageUrl, visible). Unknown id → `notFound`; dup slug → `validation`. Used both by the edit panel (full
 * save) and by the list's inline visibility toggle (re-sends the row with `visible` flipped).
 */
export async function updateCategory(
  id: string,
  body: CategoryUpdate,
): Promise<CategoryWriteResult> {
  try {
    const client = await authedClient();
    const { data, response } = await client.PATCH('/admin/categories/{id}', {
      params: { path: { id } },
      body,
    });
    return data ? { ok: true } : { ok: false, code: codeFor(response.status) };
  } catch {
    return { ok: false, code: 'error' };
  }
}

/**
 * Save the category menu order (POST /admin/categories/reorder) after a drag. `ids` is the FULL ordered list;
 * the server sets each category's displayOrder to its position. 204 → ok. Owner-only at the server.
 */
export async function reorderCategories(ids: string[]): Promise<CategoryWriteResult> {
  try {
    const client = await authedClient();
    const { response } = await client.POST('/admin/categories/reorder', { body: { ids } });
    if (response.ok) return { ok: true }; // 204 No Content
    return { ok: false, code: codeFor(response.status) };
  } catch {
    return { ok: false, code: 'error' };
  }
}

/** Delete a category (DELETE /admin/categories/{id}). 204 → ok; still-in-use → `inUse`; unknown id → `notFound`. */
export async function deleteCategory(id: string): Promise<CategoryWriteResult> {
  try {
    const client = await authedClient();
    const { response } = await client.DELETE('/admin/categories/{id}', {
      params: { path: { id } },
    });
    if (response.ok) return { ok: true }; // 204 No Content
    return { ok: false, code: codeFor(response.status) };
  } catch {
    return { ok: false, code: 'error' };
  }
}
