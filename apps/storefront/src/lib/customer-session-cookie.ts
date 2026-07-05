// Pure, dependency-free helpers for the customer BFF session cookies (P1-s). No 'server-only' and no
// next/headers here so this stays unit-testable in the node vitest env (test/customer-session-cookie.test.ts);
// the actual cookie READ/WRITE lives in customer-auth.ts (Server Action) + customer-session.ts (server-only).

/** The storefront's session cookie names. `lumin_customer` mirrors core-api's `auth.CustomerCookieName`
 *  (the JWT it reads on GET /customer/orders, middleware_auth.go) — kept as a literal with this pin so a
 *  rename on either side is caught in review, not silently dropped at runtime (mirrors admin
 *  dashboard-fetch.ts). `lumin_customer_profile` is storefront-only (no /customer/me endpoint → the
 *  login/register body is cached here for the account greeting; display-only, never an auth decision). */
export const CUSTOMER_COOKIE = 'lumin_customer';
export const CUSTOMER_PROFILE_COOKIE = 'lumin_customer_profile';

/** The signed-in identity shown on the account hub. Deliberately drops the id (not needed to render). */
export interface CustomerProfile {
  name: string;
  email: string;
  phone: string;
}

/**
 * Pull one cookie's value (+ its Max-Age) out of core-api's response `Set-Cookie` headers. Feed it
 * `response.headers.getSetCookie()` — the array form, NEVER `.get('set-cookie')` (which lossily
 * comma-joins multiple cookies). Returns null when the named cookie is absent or clearing (empty value),
 * so a logout/expiry response is never persisted as a live session.
 */
export function parseSetCookie(
  setCookieHeaders: string[],
  name: string,
): { value: string; maxAge?: number } | null {
  for (const header of setCookieHeaders) {
    const eq = header.indexOf('=');
    if (eq === -1 || header.slice(0, eq).trim() !== name) continue;
    const rest = header.slice(eq + 1);
    const semi = rest.indexOf(';');
    const value = (semi === -1 ? rest : rest.slice(0, semi)).trim();
    if (!value) return null; // a clearing cookie (Value="") is not a session to persist
    // core-api is the single source of truth for the TTL — read it back rather than duplicating it, so
    // the browser cookie expires with the JWT and a dead cookie is never forwarded. Negative (clearing) → drop.
    const m = /(?:^|;)\s*max-age=(-?\d+)/i.exec(header);
    if (m) {
      const maxAge = Number(m[1]);
      if (maxAge >= 0) return { value, maxAge };
    }
    return { value };
  }
  return null;
}

/** Serialize the identity for the profile cookie. */
export function serializeProfile(p: CustomerProfile): string {
  return JSON.stringify({ name: p.name, email: p.email, phone: p.phone });
}

/** Safe-parse the profile cookie. A corrupt/tampered value just drops the greeting (the JWT, not this,
 *  gates the orders) — never throws into a page render. */
export function parseProfile(raw: string | undefined): CustomerProfile | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (typeof o.name === 'string' && typeof o.email === 'string' && typeof o.phone === 'string') {
      return { name: o.name, email: o.email, phone: o.phone };
    }
  } catch {
    // corrupt JSON → no greeting
  }
  return null;
}
