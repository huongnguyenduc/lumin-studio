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

/** Fetch the shop's public contact channels (GET /shop/contact) — the SAME public, typed read the
 *  storefront /lien-he page + "Nhắn shop" popup use, reused here so the admin form doesn't have to parse
 *  Settings.shopInfo's loose `Record<string, unknown>` by hand. No auth needed (the endpoint is public);
 *  reusing adminClient just keeps one client-construction helper. */
export async function fetchShopContact(): Promise<components['schemas']['ShopContact']> {
  const client = await adminClient();
  // The endpoint has only a 200 response modeled (never 4xx/5xx — public, no auth, no not-found case),
  // so openapi-fetch's `error` is statically `never` here; `data` can still be undefined on a network
  // fault, which throws into the route error boundary like every other admin fetch in this file.
  const { data } = await client.GET('/shop/contact', { cache: 'no-store' });
  if (!data) {
    throw new Error('shop contact fetch failed');
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

/** Fetch the team roster (GET /admin/staff, P3-q). Owner-only: a staff caller gets 403, so we return a
 *  `forbidden` marker for the page to render the "không đủ quyền" state — the FE can't read the httpOnly
 *  role, so the server's 403 is the only signal. Any other failure throws → route error boundary. */
export async function fetchStaff(): Promise<
  { forbidden: true } | { forbidden: false; staff: components['schemas']['AdminStaff'][] }
> {
  const client = await adminClient();
  const { data, error, response } = await client.GET('/admin/staff', { cache: 'no-store' });
  if (response.status === 403) return { forbidden: true };
  if (error || !data) {
    throw new Error(`admin staff fetch failed (${response.status})`);
  }
  return { forbidden: false, staff: data };
}

/** Fetch the scoped NFC-encode Shortcuts tokens (GET /admin/encode-tokens, owner-only). Mirrors
 *  fetchStaff's `forbidden` marker for a staff caller's 403. */
export async function fetchEncodeTokens(): Promise<
  { forbidden: true } | { forbidden: false; tokens: components['schemas']['EncodeToken'][] }
> {
  const client = await adminClient();
  const { data, error, response } = await client.GET('/admin/encode-tokens', { cache: 'no-store' });
  if (response.status === 403) return { forbidden: true };
  if (error || !data) {
    throw new Error(`admin encode-tokens fetch failed (${response.status})`);
  }
  return { forbidden: false, tokens: data };
}
