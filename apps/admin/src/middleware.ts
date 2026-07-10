import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE } from '@/lib/session';

const LOGIN_PATH = '/dang-nhap';

/**
 * Route guard (P3-a): send an unauthenticated request to /dang-nhap, and an already-authenticated
 * one away from it. This is a UX gate on cookie PRESENCE only — it does not (and cannot cheaply)
 * verify the JWT at the edge; the real gate is core-api, which re-verifies the signature/expiry and
 * returns 401 on a bad cookie. Because the cookie's Max-Age equals the JWT TTL (auth.go), an
 * ordinary expiry drops the cookie and lands here as "no session", so presence is a good-enough
 * proxy in practice.
 */
export function middleware(req: NextRequest) {
  const hasSession = Boolean(req.cookies.get(SESSION_COOKIE)?.value);
  const onLogin = req.nextUrl.pathname === LOGIN_PATH;

  if (!hasSession && !onLogin) {
    const url = req.nextUrl.clone();
    url.pathname = LOGIN_PATH;
    return NextResponse.redirect(url);
  }
  if (hasSession && onLogin) {
    const url = req.nextUrl.clone();
    url.pathname = '/';
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Run on every route except Next internals and static files (anything with a dot, e.g. .png/.ico).
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)'],
};
