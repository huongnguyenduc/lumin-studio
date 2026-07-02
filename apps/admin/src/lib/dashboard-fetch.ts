import { cookies } from 'next/headers';
import { createApiClient, type components } from '@lumin/api-client';

// Server-side fetch of the admin dashboard snapshot. Importing `next/headers` makes this module
// server-only (importing it from a client component is a build error), which is what we want: the
// admin session JWT is an httpOnly + SameSite=Strict cookie (ADR-030), so it never reaches client
// JS — the dashboard reads it on the server and forwards it to core-api.

/** Name of the session cookie core-api sets on login (ADR-030; mirrors core-api
 *  `auth.SessionCookieName`). Kept as a literal with this pin so a rename on either side is caught
 *  in review rather than silently dropping auth. */
const SESSION_COOKIE = 'lumin_session';

/** Base URL of core-api, injected server-side only (never a NEXT_PUBLIC_ var, so it is not exposed
 *  to the client bundle). Thrown-not-defaulted: a silent `localhost` fallback in production would
 *  fail confusingly far from here. */
function coreApiBaseUrl(): string {
  const url = process.env.CORE_API_URL;
  if (!url) {
    throw new Error('CORE_API_URL is not set — the admin dashboard cannot reach core-api.');
  }
  return url;
}

/**
 * Fetch the dashboard snapshot from core-api, forwarding the admin session cookie. `no-store` so
 * every request re-fetches (a dashboard is live, not cached — spec §03). Throws on a missing
 * session or a non-2xx response so the route error boundary (app/error.tsx) renders the retry
 * state; the caller maps the returned snapshot with the pure adapters in ./dashboard.
 *
 * KNOWN LIMITATION (deferred with the admin login UI): a missing/expired session yields a 401,
 * which lands on the same generic "thử lại" boundary as a transient 5xx. Retry is only meaningful
 * for the transient case; for an expired session it re-fetches the same dead cookie. Once the admin
 * login surface lands, a 401 should redirect to login rather than offer a retry — there is no login
 * page to redirect to this slice, so building half that flow now would only add a dead link.
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
