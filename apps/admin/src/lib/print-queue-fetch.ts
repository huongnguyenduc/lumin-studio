import { cookies } from 'next/headers';
import { createApiClient, type components } from '@lumin/api-client';
import { SESSION_COOKIE, coreApiBaseUrl } from './session';

// Server-side fetch of the print board (GET /admin/print-queue, P3-f), forwarding the admin session
// cookie. Importing `next/headers` makes this module server-only: the httpOnly + SameSite=Strict JWT
// (ADR-030) never reaches client JS — the page reads it on the server and forwards it. Mirrors
// ./orders-fetch. `no-store` so the first paint is live (spec §03); the client then keeps it live via
// SSE (use-print-stream) with a poll fallback.

export async function fetchPrintQueue(): Promise<components['schemas']['PrintQueueJob'][]> {
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  const client = createApiClient({
    baseUrl: coreApiBaseUrl(),
    headers: session ? { cookie: `${SESSION_COOKIE}=${session}` } : {},
  });

  const { data, error, response } = await client.GET('/admin/print-queue', { cache: 'no-store' });
  if (error || !data) {
    // As with the orders list, the unauthenticated path is handled earlier by `middleware` (redirect
    // to /dang-nhap); a present-but-invalid cookie lands here as a non-2xx → the route error boundary
    // ((app)/error.tsx) renders the retry state.
    throw new Error(`print queue fetch failed (${response.status})`);
  }
  return data;
}
