import { cookies } from 'next/headers';
import { createApiClient, type components } from '@lumin/api-client';
import { SESSION_COOKIE, coreApiBaseUrl } from './session';

// Server-side fetch of the admin dashboard snapshot. Importing `next/headers` makes this module
// server-only (importing it from a client component is a build error), which is what we want: the
// admin session JWT is an httpOnly + SameSite=Strict cookie (ADR-030), so it never reaches client
// JS — the dashboard reads it on the server and forwards it to core-api.

/**
 * Fetch the dashboard snapshot from core-api, forwarding the admin session cookie. `no-store` so
 * every request re-fetches (a dashboard is live, not cached — spec §03). Throws on a missing
 * session or a non-2xx response so the route error boundary ((app)/error.tsx) renders the retry
 * state; the caller maps the returned snapshot with the pure adapters in ./dashboard.
 *
 * The common unauthenticated path (no cookie) never reaches here: `middleware` redirects it to
 * /dang-nhap first (P3-a). What can still land here is a present-but-invalid cookie (tamper, or a
 * JWT-secret rotation) → core-api 401 → the retry boundary. That is rare because the cookie's
 * Max-Age equals the JWT TTL (auth.go), so an ordinary expiry drops the cookie and middleware, not
 * this fetch, handles it. We deliberately do NOT redirect from here: a render-time cookie clear is
 * illegal in a server component, so redirecting without clearing the bad cookie would ping-pong
 * against middleware — the retry boundary is the safe terminus for that edge case.
 */
export async function fetchDashboard(): Promise<components['schemas']['DashboardSnapshot']> {
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  const client = createApiClient({
    baseUrl: coreApiBaseUrl(),
    headers: session ? { cookie: `${SESSION_COOKIE}=${session}` } : {},
  });

  const { data, error, response } = await client.GET('/admin/dashboard', { cache: 'no-store' });
  if (error || !data) {
    throw new Error(`dashboard fetch failed (${response.status})`);
  }
  return data;
}
