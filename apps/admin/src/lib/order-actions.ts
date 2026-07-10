'use server';

import { cookies } from 'next/headers';
import { createApiClient, type components } from '@lumin/api-client';
import { SESSION_COOKIE, coreApiBaseUrl } from './session';

// Server Actions the order-detail transition flow needs (P3-e). CORE_API_URL is server-only, so the
// browser reaches core-api only through these. `transitionOrder` forwards the httpOnly session cookie
// (the endpoint is authRequired — owner/staff); `presignProofUpload` hits the public presigned-POST
// endpoint (reused from checkout P2-c) for the refund/QC images. Both collapse any failure to a small
// view-safe code — the raw Vietnamese envelope never leaks (always-must #3, ADR-032).

type TransitionRequest = components['schemas']['TransitionRequest'];
type ProofUpload = components['schemas']['PaymentProofUpload'];
type ProofContentType = components['schemas']['PaymentProofUploadInput']['contentType'];

/** `forbidden` = staff hit an owner-only edge (→PAID/→REFUNDED); `conflict` = the order moved under us
 *  (stale edge, 409 INVALID_EDGE); `validation` = a missing artifact the UI should have supplied
 *  (400/422 — tracking/QC/reason/proof); `error` = transient/5xx. The view translates each. */
export type TransitionResult =
  | { ok: true }
  | { ok: false; code: 'forbidden' | 'conflict' | 'validation' | 'error' };

/** Apply one status transition (POST /orders/{id}/transitions). The server is authoritative: it
 *  re-checks edge + RBAC + required fields, so a rejected call means re-fetch and retry, never proceed. */
export async function transitionOrder(
  id: string,
  body: TransitionRequest,
): Promise<TransitionResult> {
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  try {
    const client = createApiClient({
      baseUrl: coreApiBaseUrl(),
      headers: session ? { cookie: `${SESSION_COOKIE}=${session}` } : {},
    });
    const { data, response } = await client.POST('/orders/{id}/transitions', {
      params: { path: { id } },
      body,
    });
    if (data) return { ok: true };
    const s = response.status;
    if (s === 403) return { ok: false, code: 'forbidden' };
    if (s === 409) return { ok: false, code: 'conflict' };
    if (s === 400 || s === 422) return { ok: false, code: 'validation' };
    return { ok: false, code: 'error' };
  } catch {
    return { ok: false, code: 'error' };
  }
}

/** Ask core-api for a short-lived presigned POST form for ONE image (refund proof / QC photo). The
 *  browser then POSTs the bytes STRAIGHT to Garage (see ./upload-proof) and sends `finalUrl` on the
 *  transition. Any failure collapses to a generic retryable miss. */
export async function presignProofUpload(
  contentType: ProofContentType,
): Promise<{ ok: true; upload: ProofUpload } | { ok: false }> {
  try {
    const client = createApiClient({ baseUrl: coreApiBaseUrl() });
    const { data } = await client.POST('/checkout/payment-proof-upload', { body: { contentType } });
    if (data) return { ok: true, upload: data };
    return { ok: false };
  } catch {
    return { ok: false };
  }
}
