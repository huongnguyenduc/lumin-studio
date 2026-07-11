import { cookies } from 'next/headers';
import { SESSION_COOKIE, coreApiBaseUrl } from '@/lib/session';

// Same-origin reverse-proxy for the print-board SSE stream (P3-g / P3-h). The browser cannot open an
// EventSource straight at core-api: CORE_API_URL is server-only (never NEXT_PUBLIC), and a cross-origin
// EventSource can't carry the httpOnly session cookie anyway. So the board's EventSource hits THIS
// same-origin route, which reads the cookie server-side and streams core-api's
// GET /admin/print-queue/stream back byte-for-byte. core-api already sets the anti-buffering headers
// (text/event-stream + no-transform + identity + X-Accel-Buffering:no + Flusher + heartbeat,
// conventions §Realtime); we re-assert the load-bearing ones on the leg we control and never buffer —
// returning the upstream ReadableStream directly pipes each frame straight through.

export const runtime = 'nodejs'; // needs a streaming fetch body proxied over a long-lived connection
export const dynamic = 'force-dynamic'; // never cached — it's a live stream

export async function GET(request: Request): Promise<Response> {
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!session) {
    // No credential → 401 before opening a stream. The board hook treats this as "stream down" and
    // falls back to polling; middleware handles the real re-auth on the next navigation.
    return new Response(null, { status: 401 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${coreApiBaseUrl()}/admin/print-queue/stream`, {
      headers: { cookie: `${SESSION_COOKIE}=${session}`, accept: 'text/event-stream' },
      // Propagate client disconnect: when the browser closes the EventSource, Next aborts this
      // request's signal → the upstream fetch aborts → core-api's r.Context().Done() fires and it
      // unsubscribes. Clean teardown end-to-end.
      signal: request.signal,
      cache: 'no-store',
    });
  } catch {
    return new Response(null, { status: 502 }); // core-api unreachable
  }

  if (!upstream.ok || !upstream.body) {
    // Pass core-api's auth/other failure status through (401 on an expired/rejected cookie) so the
    // hook stops trying the stream and polls instead.
    return new Response(null, { status: upstream.status || 502 });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Content-Encoding': 'identity',
      'X-Accel-Buffering': 'no',
      Connection: 'keep-alive',
    },
  });
}
