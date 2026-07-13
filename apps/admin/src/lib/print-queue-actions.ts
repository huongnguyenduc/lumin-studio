'use server';

import { cookies } from 'next/headers';
import { createApiClient, type components } from '@lumin/api-client';
import { SESSION_COOKIE, coreApiBaseUrl } from './session';

// Server Actions the print board (P3-h) needs at runtime — the browser's ONLY way to reach core-api
// for the board mutate + the poll fallback (CORE_API_URL is server-only, never in the client bundle).
// The live PUSH is separate: the SSE stream is reverse-proxied by app/api/print-stream/route.ts. Both
// forward the httpOnly session cookie; failures collapse to a small view-safe code — the raw
// Vietnamese envelope never leaks (always-must #3, ADR-032).

type PrintCard = components['schemas']['PrintQueueJob'];
type PrintStage = components['schemas']['PrintStage'];
type EncodeResult = components['schemas']['PrintTagEncodeResult'];

/**
 * Move ONE print job to a new stage (PATCH /admin/print-jobs/{id}) — the drag drop / advance button.
 * Stage-only: this does NOT transition the customer's OrderStatus (D6) — an order-status change goes
 * through the transition flow (P3-e) that enforces the QC/tracking gate a board drag must never bypass.
 * The server is authoritative and re-reads the enriched card, which we return so the board reconciles
 * (idempotent with the SSE broadcast of the same PATCH). `conflict` = the job vanished under us (404);
 * `validation` = a stage the server rejected (shouldn't happen from a fixed column drop, mapped anyway).
 */
export async function advancePrintStage(
  id: string,
  stage: PrintStage,
): Promise<
  { ok: true; card: PrintCard } | { ok: false; code: 'conflict' | 'validation' | 'error' }
> {
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  try {
    const client = createApiClient({
      baseUrl: coreApiBaseUrl(),
      headers: session ? { cookie: `${SESSION_COOKIE}=${session}` } : {},
    });
    const { data, response } = await client.PATCH('/admin/print-jobs/{id}', {
      params: { path: { id } },
      body: { stage },
    });
    if (data) return { ok: true, card: data };
    const s = response.status;
    if (s === 404) return { ok: false, code: 'conflict' };
    if (s === 400 || s === 422) return { ok: false, code: 'validation' };
    return { ok: false, code: 'error' };
  } catch {
    return { ok: false, code: 'error' };
  }
}

/**
 * NFC-encode a Pet Tag print job (POST /admin/print-jobs/{id}/encode, P3-t t-2). TWO-PHASE, one call
 * either way: OMIT chipUid to PREPARE — mint/return the pet tag + the URL to burn, board stage untouched
 * (the encode-sheet open); PASS chipUid to CONFIRM — record the chip UID, flip the tag to ENCODED, and
 * advance the card to PACKING (the write-done submit). Returns `result.tag` (URL + status) and
 * `result.card` (folded back into the board). `conflict` = the job vanished (404); `validation` = a
 * non-nfc_tag job or a blank chipUid (400) — shouldn't happen from the guarded encode button.
 */
export async function encodePrintTag(
  id: string,
  chipUid?: string,
): Promise<
  { ok: true; result: EncodeResult } | { ok: false; code: 'conflict' | 'validation' | 'error' }
> {
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  try {
    const client = createApiClient({
      baseUrl: coreApiBaseUrl(),
      headers: session ? { cookie: `${SESSION_COOKIE}=${session}` } : {},
    });
    const { data, response } = await client.POST('/admin/print-jobs/{id}/encode', {
      params: { path: { id } },
      body: chipUid ? { chipUid } : {},
    });
    if (data) return { ok: true, result: data };
    const s = response.status;
    if (s === 404) return { ok: false, code: 'conflict' };
    if (s === 400 || s === 422) return { ok: false, code: 'validation' };
    return { ok: false, code: 'error' };
  } catch {
    return { ok: false, code: 'error' };
  }
}

/**
 * Re-read the whole board (GET /admin/print-queue) — the SSE fallback poll (use-print-stream calls
 * this on an interval only while the stream is down, BLOCKER-B / plan open-q #4). Also the only path
 * that surfaces NEWLY-created jobs, which SSE never emits (it broadcasts stage advances of known
 * cards). Returns null on any failure so the hook keeps the last-known board instead of blanking it.
 */
export async function refetchPrintQueue(): Promise<PrintCard[] | null> {
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  try {
    const client = createApiClient({
      baseUrl: coreApiBaseUrl(),
      headers: session ? { cookie: `${SESSION_COOKIE}=${session}` } : {},
    });
    const { data } = await client.GET('/admin/print-queue', { cache: 'no-store' });
    return data ?? null;
  } catch {
    return null;
  }
}
