'use server';

import { fetchStaff } from './settings-fetch';
import { weddingApi } from './wedding-admin';

// Server Actions for couple management (owner-only). Each re-checks the owner
// gate (fetchStaff 403 for staff) before touching wedding-api, then collapses
// the API result to a small view-safe code — the raw error envelope never
// reaches the client.

export type WeddingsActionResult =
  | { ok: true }
  | {
      ok: false;
      code: 'forbidden' | 'unavailable' | 'conflict' | 'validation' | 'notFound' | 'error';
    };

async function ensureOwner(): Promise<boolean> {
  const staff = await fetchStaff();
  return !staff.forbidden;
}

function codeFor(httpStatus: number, apiCode: string): WeddingsActionResult {
  if (apiCode === 'LAST_WEDDING') return { ok: false, code: 'conflict' };
  if (apiCode === 'SUBDOMAIN_TAKEN') return { ok: false, code: 'conflict' };
  if (httpStatus === 409) return { ok: false, code: 'conflict' };
  if (httpStatus === 404) return { ok: false, code: 'notFound' };
  if (httpStatus === 400) return { ok: false, code: 'validation' };
  return { ok: false, code: 'error' };
}

async function run(method: string, path: string, body?: unknown): Promise<WeddingsActionResult> {
  if (!(await ensureOwner())) return { ok: false, code: 'forbidden' };
  const res = await weddingApi<unknown>(method, path, body);
  if (res.status === 'ok') return { ok: true };
  if (res.status === 'unavailable') return { ok: false, code: 'unavailable' };
  return codeFor(res.httpStatus, res.code);
}

/** Create a new couple (POST /api/admin/weddings). */
export async function createWedding(name: string): Promise<WeddingsActionResult> {
  return run('POST', '/api/admin/weddings', { name });
}

/** Rename a couple and/or set/clear its login password (PATCH /api/admin/weddings/{slug}).
 *  password: undefined = leave unchanged; '' = disable couple login; else set. */
export async function updateWedding(
  slug: string,
  patch: { name?: string; password?: string },
): Promise<WeddingsActionResult> {
  return run('PATCH', `/api/admin/weddings/${encodeURIComponent(slug)}`, patch);
}

/** Delete a couple and everything under it (DELETE /api/admin/weddings/{slug}). */
export async function deleteWedding(slug: string): Promise<WeddingsActionResult> {
  return run('DELETE', `/api/admin/weddings/${encodeURIComponent(slug)}`);
}

/** Approve/reject a couple's pending subdomain request
 *  (POST /api/admin/events/{slug}/subdomain-review). */
export async function reviewSubdomain(
  eventSlug: string,
  approve: boolean,
): Promise<WeddingsActionResult> {
  return run('POST', `/api/admin/events/${encodeURIComponent(eventSlug)}/subdomain-review`, {
    approve,
  });
}
