'use server';

import { cookies } from 'next/headers';
import { createApiClient, type components } from '@lumin/api-client';
import { SESSION_COOKIE, coreApiBaseUrl } from './session';

// Server Actions for the product editor's 3D-model pipeline (P3-l l-2, ADR-036). CORE_API_URL is
// server-only, so the browser reaches the model-upload presign / asset-job endpoints only through these.
// `presignModelUpload` + `createAssetJob` are owner-only at the server (a staff attempt → `forbidden`);
// `getAssetJobs` is admin-gated (owner+staff read) and drives the client status poll. Any failure collapses
// to a small view-safe shape — the raw VN envelope never leaks (always-must #3, ADR-032).

type ModelContentType = components['schemas']['ModelUploadInput']['contentType'];
type ModelUpload = components['schemas']['ModelUpload'];
type AssetJobInput = components['schemas']['AssetJobInput'];
type AssetJob = components['schemas']['AssetJob'];

export type AssetJobCode = 'forbidden' | 'validation' | 'notFound' | 'error';

function codeFor(status: number): AssetJobCode {
  if (status === 403) return 'forbidden';
  if (status === 404) return 'notFound';
  if (status === 400 || status === 422) return 'validation';
  return 'error';
}

async function authedClient() {
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  return createApiClient({
    baseUrl: coreApiBaseUrl(),
    headers: session ? { cookie: `${SESSION_COOKIE}=${session}` } : {},
  });
}

/** Ask core-api for a short-lived presigned POST form for ONE source model (owner-only). The browser then
 *  POSTs the bytes STRAIGHT to Garage (see ./upload-model) and sends `finalUrl` as the asset-job source. */
export async function presignModelUpload(
  productId: string,
  contentType: ModelContentType,
): Promise<{ ok: true; upload: ModelUpload } | { ok: false }> {
  try {
    const client = await authedClient();
    const { data } = await client.POST('/admin/products/{id}/model-upload', {
      params: { path: { id: productId } },
      body: { contentType },
    });
    if (data) return { ok: true, upload: data };
    return { ok: false };
  } catch {
    return { ok: false };
  }
}

/** Enqueue ONE render/ingest job from an uploaded source model (owner-only). `sourceModelUrl` must be the
 *  host-pinned finalUrl the presign minted; `sourceVersion` is the file's content hash (see ./upload-model). */
export async function createAssetJob(
  productId: string,
  input: AssetJobInput,
): Promise<{ ok: true; job: AssetJob } | { ok: false; code: AssetJobCode }> {
  try {
    const client = await authedClient();
    const { data, response } = await client.POST('/admin/products/{id}/asset-jobs', {
      params: { path: { id: productId } },
      body: input,
    });
    if (data) return { ok: true, job: data };
    return { ok: false, code: codeFor(response.status) };
  } catch {
    return { ok: false, code: 'error' };
  }
}

/** The product's asset jobs, newest first — for the initial render and the status poll. Any miss returns
 *  [] (the editor shows "no jobs yet"); the product itself is known to exist (we're on its edit page). */
export async function getAssetJobs(productId: string): Promise<AssetJob[]> {
  try {
    const client = await authedClient();
    const { data } = await client.GET('/admin/products/{id}/asset-jobs', {
      params: { path: { id: productId } },
    });
    return data ?? [];
  } catch {
    return [];
  }
}
