import { cookies } from 'next/headers';
import { createApiClient, type components } from '@lumin/api-client';
import { SESSION_COOKIE, coreApiBaseUrl } from './session';

// Server-side reads for the settings surface (P3-i), forwarding the httpOnly admin session cookie.
// Importing `next/headers` makes this module server-only (the JWT never reaches client JS). `no-store`
// so the screen always reflects the latest saved config after a write. Mirrors ./orders-fetch. The
// unauthenticated path is handled earlier by `middleware` (redirect to /dang-nhap); a present-but-invalid
// cookie → core-api 401 → thrown → route error boundary ((app)/error.tsx).

async function adminClient() {
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  return createApiClient({
    baseUrl: coreApiBaseUrl(),
    headers: session ? { cookie: `${SESSION_COOKIE}=${session}` } : {},
  });
}

/** Fetch the settings singleton (GET /admin/settings). */
export async function fetchSettings(): Promise<components['schemas']['Settings']> {
  const client = await adminClient();
  const { data, error, response } = await client.GET('/admin/settings', { cache: 'no-store' });
  if (error || !data) {
    throw new Error(`admin settings fetch failed (${response.status})`);
  }
  return data;
}

/** Fetch the reply templates, ordered by title (GET /admin/reply-templates). */
export async function fetchReplyTemplates(): Promise<components['schemas']['ReplyTemplate'][]> {
  const client = await adminClient();
  const { data, error, response } = await client.GET('/admin/reply-templates', {
    cache: 'no-store',
  });
  if (error || !data) {
    throw new Error(`admin reply-templates fetch failed (${response.status})`);
  }
  return data;
}
