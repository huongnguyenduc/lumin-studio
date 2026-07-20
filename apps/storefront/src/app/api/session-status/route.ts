import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { CUSTOMER_COOKIE } from '@/lib/customer-session-cookie';

// A tiny, dependency-free "am I logged in" probe for client components (SiteHeader). Reading the
// session cookie in the root layout would flip EVERY route to dynamic rendering and break the
// catalog/home SSG+ISR caching (storefront.md "Catalog: SSG/ISR + cache mạnh") — this route isolates
// the one dynamic read to its own request instead. Presence-only (no JWT verify): worst case a stale
// cookie shows the bell one extra page load, and the bell reveals no data, so that's a cosmetic
// no-op, not an auth decision.

export async function GET(): Promise<NextResponse> {
  const loggedIn = Boolean((await cookies()).get(CUSTOMER_COOKIE)?.value);
  return NextResponse.json({ loggedIn }, { headers: { 'Cache-Control': 'no-store' } });
}
