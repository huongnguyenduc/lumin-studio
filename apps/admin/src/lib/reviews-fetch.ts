import { cookies } from 'next/headers';
import { createApiClient, type components } from '@lumin/api-client';
import { SESSION_COOKIE, coreApiBaseUrl } from './session';

// Server-only read for the review moderation page (/danh-gia, P3-n). GET /admin/reviews returns EVERY review
// (published + hidden) as an admin moderation card, newest first, carrying the product name and the reviewer's
// name (admin-only PII, PDPL — null for a guest review). `no-store` keeps the list live after a reply/hide/show.
// The FE derives its tabs (chờ trả lời / đã trả lời / có ảnh / đã ẩn) from status + reply + images client-side,
// so no ?status filter here. Unauthenticated is handled by middleware; a present-but-invalid cookie → core-api
// 401 → thrown → (app)/error.tsx (retry).
export async function fetchAdminReviews(): Promise<components['schemas']['AdminReview'][]> {
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  const client = createApiClient({
    baseUrl: coreApiBaseUrl(),
    headers: session ? { cookie: `${SESSION_COOKIE}=${session}` } : {},
  });

  const { data, error, response } = await client.GET('/admin/reviews', { cache: 'no-store' });
  if (error || !data) {
    throw new Error(`admin reviews fetch failed (${response.status})`);
  }
  return data;
}
