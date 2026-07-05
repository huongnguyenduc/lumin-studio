'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createApiClient } from '@lumin/api-client';
import { coreApiBaseUrl } from './core-api';
import {
  CUSTOMER_COOKIE,
  CUSTOMER_PROFILE_COOKIE,
  parseSetCookie,
  serializeProfile,
  type CustomerProfile,
} from './customer-session-cookie';

// The client bridge to POST /customer/{login,register,logout} (ADR-030 customer realm). The forms run in
// the browser, but CORE_API_URL is server-only — so the client calls THESE Server Actions, which reach
// core-api server-side. core-api returns the session JWT in an httpOnly Set-Cookie; because the storefront
// is a pure BFF (the browser never talks to core-api directly), we RE-MINT that cookie on the storefront's
// own domain — core-api's cookie has NO Domain attribute, so it is scoped to a host the browser never hits.
// A companion httpOnly profile cookie caches the identity for the account greeting (no /customer/me exists).
// Failures map to a small closed `code` — the raw Vietnamese envelope/messageKey is NEVER forwarded to the
// client (always-must #3). Mirrors lib/quote.ts (error union) + admin dashboard-fetch.ts (cookie forward).

export type LoginResult =
  | { ok: true }
  | { ok: false; code: 'invalid_credentials' | 'validation' | 'error' };

export type RegisterResult =
  | { ok: true }
  | { ok: false; code: 'email_taken' | 'validation' | 'error' };

/** Re-mint the session + profile cookies on the storefront domain from core-api's Set-Cookie + body.
 *  Returns false when no session token came back (so a broken cookie is never set). */
async function persistSession(response: Response, profile: CustomerProfile): Promise<boolean> {
  const parsed = parseSetCookie(response.headers.getSetCookie(), CUSTOMER_COOKIE);
  if (!parsed) return false;
  const jar = await cookies();
  const opts = {
    httpOnly: true,
    // mirrors core-api CookieSecure (true in prod, off for local http dev)
    secure: process.env.NODE_ENV === 'production',
    // Lax so an account link from nav/email carries the session on a top-level GET; core-api uses Strict
    // on its OWN host, independent of this browser↔storefront cookie.
    sameSite: 'lax' as const,
    path: '/',
    ...(parsed.maxAge !== undefined ? { maxAge: parsed.maxAge } : {}),
  };
  // First cookies().set() in the repo — legal ONLY because this runs in a Server Action (Next forbids
  // cookie mutation during a Server Component render).
  jar.set(CUSTOMER_COOKIE, parsed.value, opts);
  jar.set(CUSTOMER_PROFILE_COOKIE, serializeProfile(profile), opts);
  return true;
}

export async function loginCustomer(email: string, password: string): Promise<LoginResult> {
  // Skip the round-trip on empty input (a blank field can't authenticate).
  if (!email.trim() || !password) return { ok: false, code: 'validation' };
  try {
    const client = createApiClient({ baseUrl: coreApiBaseUrl() });
    const { data, response } = await client.POST('/customer/login', { body: { email, password } });
    if (data) {
      return (await persistSession(response, data)) ? { ok: true } : { ok: false, code: 'error' };
    }
    // 401 = unknown email OR wrong password (uniform, no enumeration — ADR-030). 400 = malformed. Else generic.
    if (response.status === 401) return { ok: false, code: 'invalid_credentials' };
    if (response.status === 400) return { ok: false, code: 'validation' };
    return { ok: false, code: 'error' };
  } catch {
    return { ok: false, code: 'error' };
  }
}

export async function registerCustomer(input: {
  name: string;
  email: string;
  phone: string;
  password: string;
}): Promise<RegisterResult> {
  const { name, email, phone, password } = input;
  if (!name.trim() || !email.trim() || !phone.trim() || !password) {
    return { ok: false, code: 'validation' };
  }
  try {
    const client = createApiClient({ baseUrl: coreApiBaseUrl() });
    const { data, response } = await client.POST('/customer/register', {
      body: { name, email, phone, password },
    });
    if (data) {
      return (await persistSession(response, data)) ? { ok: true } : { ok: false, code: 'error' };
    }
    // 409 = the login email is already registered (the ONE register field-error safe to surface). 400 =
    // validation (server re-checks name 2..60, password 8..72 — envelope is code-only, no per-field map). Else generic.
    if (response.status === 409) return { ok: false, code: 'email_taken' };
    if (response.status === 400) return { ok: false, code: 'validation' };
    return { ok: false, code: 'error' };
  } catch {
    return { ok: false, code: 'error' };
  }
}

/** Logout form action: best-effort core-api logout (forwarding the session), then clear BOTH storefront
 *  cookies and go home. Progressive-enhancement — a plain <form action={logoutCustomer}>, zero client JS. */
export async function logoutCustomer(): Promise<void> {
  const jar = await cookies();
  const jwt = jar.get(CUSTOMER_COOKIE)?.value;
  try {
    const client = createApiClient({
      baseUrl: coreApiBaseUrl(),
      headers: jwt ? { cookie: `${CUSTOMER_COOKIE}=${jwt}` } : {},
    });
    await client.POST('/customer/logout', {});
  } catch {
    // best-effort — even if core-api is unreachable, still clear the local session below
  }
  jar.delete(CUSTOMER_COOKIE);
  jar.delete(CUSTOMER_PROFILE_COOKIE);
  redirect('/');
}
