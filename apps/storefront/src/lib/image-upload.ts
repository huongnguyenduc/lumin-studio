'use server';

import { createApiClient } from '@lumin/api-client';
import type { components } from '@lumin/api-client';
import { coreApiBaseUrl } from './core-api';

// Server-side bridge for uploading ONE permanent public image — a pet-page photo (P3-t) — to the world-
// readable lumin-assets bucket via a presigned POST. The browser then POSTs the bytes STRAIGHT to Garage
// (core-api never proxies the file). Mirrors createPaymentProofUpload (lib/order-submit.ts) but hits
// POST /uploads/image, whose object has NO retention sweeper — so a lost pet's photo never expires (t-6),
// unlike a receipt on the 90-day proof bucket. Runs as a Server Action (CORE_API_URL is server-only) and
// persists nothing.

export type ImageUploadContentType = components['schemas']['ImageUploadInput']['contentType'];
export type ImageUpload = components['schemas']['ImageUpload'];

/** Ask core-api for a short-lived presigned POST form for ONE image of the given MIME type. On success the
 *  browser POSTs the file to `upload.uploadUrl` and keeps `upload.finalUrl`. Any failure collapses to a
 *  generic retryable `error`. */
export async function createImageUpload(
  contentType: ImageUploadContentType,
): Promise<{ ok: true; upload: ImageUpload } | { ok: false; code: 'error' }> {
  try {
    const client = createApiClient({ baseUrl: coreApiBaseUrl() });
    const { data } = await client.POST('/uploads/image', {
      body: { contentType },
    });
    if (data) return { ok: true, upload: data };
    return { ok: false, code: 'error' };
  } catch {
    return { ok: false, code: 'error' };
  }
}
