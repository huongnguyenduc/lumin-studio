import { timingSafeEqual } from 'node:crypto';

/**
 * Verify the shared secret an authorized caller must present to purge the catalog cache via
 * POST /api/revalidate. The intended caller is a FUTURE core-api on-write webhook (fired when a
 * product's price/status/stock changes, once the admin product-CRUD surface exists) — the receive
 * side ships now (P1-f) so the storefront is purge-ready.
 *
 * Fail-SAFE: when REVALIDATE_SECRET is unset the endpoint is CLOSED (500), never an open purge — a
 * misconfiguration must not silently expose an unauthenticated cache-buster. Constant-time compare so
 * a timing side-channel can't leak the secret. The purge is low-value (worst case: one forced cache
 * refresh), but an open/guessable purge endpoint is a cheap cache-thrash DoS, so it's gated like a
 * write. Pure + no I/O so it's fully unit-testable (test/revalidate-auth.test.ts).
 */
export function verifyRevalidateSecret(
  provided: string | null,
  expected: string | undefined,
): { ok: boolean; status: number } {
  if (!expected) {
    return { ok: false, status: 500 }; // misconfigured → closed, not open
  }
  if (!provided) {
    return { ok: false, status: 401 };
  }
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on unequal lengths; a length check first also short-circuits the mismatch.
  // The secret is high-entropy and fixed-length, so leaking its length via this branch is harmless.
  if (a.length !== b.length) {
    return { ok: false, status: 401 };
  }
  return timingSafeEqual(a, b) ? { ok: true, status: 200 } : { ok: false, status: 401 };
}
