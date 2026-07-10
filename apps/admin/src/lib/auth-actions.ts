'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createApiClient } from '@lumin/api-client';
import { SESSION_COOKIE, coreApiBaseUrl, parseSessionCookie } from './session';

/** Result of a login attempt. `invalid` = wrong email/password (uniform, no enumeration —
 *  mirrors core-api's single 401); `error` = transient/config fault (retry may help). */
export type LoginResult = { ok: true } | { ok: false; reason: 'invalid' | 'error' };

/**
 * Log an admin in (P3-a, ADR-030). A BFF hop: the browser posts to this Server Action, which calls
 * core-api `POST /auth/login`; on success core-api returns a signed JWT in a Set-Cookie for its OWN
 * host, so we lift the token value out and re-issue it as an httpOnly cookie on the ADMIN host —
 * that is where dashboard-fetch reads it back to forward on every server-side call. The token never
 * touches client JS (out of XSS reach). We re-assert the security attributes here (httpOnly, strict,
 * secure in prod) rather than trust the upstream cookie's flags.
 */
export async function login(input: { email: string; password: string }): Promise<LoginResult> {
  let response: Response;
  let data: unknown;
  let error: unknown;
  try {
    const client = createApiClient({ baseUrl: coreApiBaseUrl() });
    const res = await client.POST('/auth/login', {
      body: { email: input.email, password: input.password },
    });
    ({ data, error, response } = res);
  } catch {
    // Network failure / CORE_API_URL unset → treat as transient so the form offers a retry
    // (never a stack trace to the user).
    return { ok: false, reason: 'error' };
  }

  if (error || !data) {
    // 400 (bad/missing field) and 401 (unknown email OR wrong password) both read as "invalid" —
    // core-api already returns a uniform 401 for the two credential paths (no enumeration).
    const status = response.status;
    return { ok: false, reason: status === 401 || status === 400 ? 'invalid' : 'error' };
  }

  const session = parseSessionCookie(response.headers.getSetCookie());
  if (!session) {
    // 200 with no session cookie should be impossible; fail closed rather than pretend logged-in.
    return { ok: false, reason: 'error' };
  }

  (await cookies()).set(SESSION_COOKIE, session.value, {
    httpOnly: true,
    // ponytail: Secure keyed on NODE_ENV — correct for `next start` (sets production) but the admin
    // container has no Dockerfile yet (operations.md, deferred). When it lands, pin
    // NODE_ENV=production OR switch to an explicit COOKIE_SECURE env like core-api's issuer, so a
    // `next dev`/custom-server deploy behind the HTTPS edge can't ship the session cookie insecure.
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: session.maxAge,
  });
  return { ok: true };
}

/**
 * Log out: drop the admin-host session cookie and bounce to /dang-nhap. The JWT is stateless (no
 * server session to revoke — ADR-030), so clearing the cookie IS the logout; the next request has
 * no cookie and middleware routes it to login. `redirect` throws, so this never returns.
 */
export async function logout(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
  redirect('/dang-nhap');
}
