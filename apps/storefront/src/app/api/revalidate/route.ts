import { revalidateTag } from 'next/cache';
import { NextResponse } from 'next/server';
import { verifyRevalidateSecret } from '@/lib/revalidate-auth';

// On-write catalog cache purge (Q1 decision, user 2026-07-04). A caller that presents the shared
// secret (the `x-revalidate-secret` header) triggers revalidateTag('catalog'), instantly busting the
// home grid's cached fetch (lib/catalog.ts, tagged `catalog`). The intended caller is a FUTURE
// core-api webhook fired on a product price/status/stock change — that emit-side lands with the admin
// product-CRUD surface (no product-write path exists yet), so today this endpoint is dormant but ready.
//
// The 300s backstop `revalidate` on the tagged fetch keeps the cache from freezing until then. Auth +
// fail-safe live in the pure verifyRevalidateSecret (unit-tested); this handler is the thin wrapper.

export async function POST(request: Request): Promise<NextResponse> {
  const provided = request.headers.get('x-revalidate-secret');
  const { ok, status } = verifyRevalidateSecret(provided, process.env.REVALIDATE_SECRET);
  if (!ok) {
    return NextResponse.json({ revalidated: false }, { status });
  }

  revalidateTag('catalog');
  return NextResponse.json({ revalidated: true, tag: 'catalog' });
}
