// Shared admin-session helpers, imported by the server-only fetchers/actions (dashboard-fetch,
// auth-actions) and the edge middleware. No `next/headers` import here so it stays runtime-agnostic
// (middleware runs on the edge). Pure string/env logic only.

/** Name of the session cookie core-api sets on login (ADR-030; mirrors core-api
 *  `auth.SessionCookieName`). Kept as a literal with this pin so a rename on either side is caught
 *  in review rather than silently dropping auth. */
export const SESSION_COOKIE = 'lumin_session';

/** Base URL of core-api, injected server-side only (never a NEXT_PUBLIC_ var, so it is not exposed
 *  to the client bundle). Thrown-not-defaulted: a silent `localhost` fallback in production would
 *  fail confusingly far from here. */
export function coreApiBaseUrl(): string {
  const url = process.env.CORE_API_URL;
  if (!url) {
    throw new Error('CORE_API_URL is not set — the admin app cannot reach core-api.');
  }
  return url;
}

/**
 * Pull the session cookie's value + Max-Age out of the Set-Cookie header(s) core-api returned on
 * login. core-api sets the cookie for ITS host; the admin BFF re-issues it for the admin host (so
 * the server-side forwarder in dashboard-fetch can read it back), which means the login action has
 * to lift the token value out of the upstream Set-Cookie. We take only value + maxAge — the security
 * attributes (httpOnly/SameSite/Secure) are re-asserted by the admin side, not trusted from upstream.
 *
 * Returns null when no non-empty `lumin_session` cookie is present (an empty value = a Clear/logout
 * cookie, which must NOT be treated as a login). Max-Age is dropped unless it is a positive integer.
 */
export function parseSessionCookie(
  setCookies: readonly string[],
): { value: string; maxAge?: number } | null {
  for (const raw of setCookies) {
    const [nameValue, ...attrs] = raw.split(';');
    const eq = nameValue.indexOf('=');
    if (eq < 0) continue;
    if (nameValue.slice(0, eq).trim() !== SESSION_COOKIE) continue;
    const value = nameValue.slice(eq + 1).trim();
    if (!value) continue; // empty value = a Clear cookie, not a real session
    const maxAgeAttr = attrs.find((a) => a.trim().toLowerCase().startsWith('max-age='));
    const maxAge = maxAgeAttr ? Number(maxAgeAttr.split('=')[1]) : NaN;
    return { value, maxAge: Number.isInteger(maxAge) && maxAge > 0 ? maxAge : undefined };
  }
  return null;
}
