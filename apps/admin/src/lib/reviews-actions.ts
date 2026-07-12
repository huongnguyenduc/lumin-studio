'use server';

import { cookies } from 'next/headers';
import { createApiClient, type components } from '@lumin/api-client';
import { SESSION_COOKIE, coreApiBaseUrl } from './session';

// Server Action for review moderation (P3-n). CORE_API_URL is server-only, so the browser reaches core-api
// only through here, forwarding the httpOnly session cookie. Unlike the catalog writes, moderating a review
// is owner AND staff (spec §08 — staff kiểm duyệt đánh giá), so there's normally no 403. Failures collapse to
// a small view-safe code — the raw Vietnamese error envelope never leaks (always-must #3, ADR-032). Mirrors
// ./categories-actions (same WriteCode shape, minus the 409 that only DELETEs raise).

type ReviewModeration = components['schemas']['ReviewModeration'];

export type ReviewWriteCode = 'forbidden' | 'validation' | 'notFound' | 'error';
export type ReviewWriteResult = { ok: true } | { ok: false; code: ReviewWriteCode };

function codeFor(status: number): ReviewWriteCode {
  if (status === 403) return 'forbidden';
  if (status === 404) return 'notFound';
  if (status === 400 || status === 422) return 'validation'; // empty body / bad status / reply too long
  return 'error';
}

async function authedClient() {
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  return createApiClient({
    baseUrl: coreApiBaseUrl(),
    headers: session ? { cookie: `${SESSION_COOKIE}=${session}` } : {},
  });
}

/**
 * Moderate one review (PATCH /admin/reviews/{id}) — post/replace the shop reply and/or flip published↔hidden.
 * The reply composer sends `{ status: 'published', reply }` so a reply also (re)publishes the review; the
 * hide/show buttons send just `{ status }`. An empty body → `validation` (400); unknown id → `notFound`. 204
 * on success. Owner and staff both allowed.
 */
export async function moderateReview(
  id: string,
  body: ReviewModeration,
): Promise<ReviewWriteResult> {
  try {
    const client = await authedClient();
    const { response } = await client.PATCH('/admin/reviews/{id}', {
      params: { path: { id } },
      body,
    });
    if (response.ok) return { ok: true }; // 204 No Content
    return { ok: false, code: codeFor(response.status) };
  } catch {
    return { ok: false, code: 'error' };
  }
}
