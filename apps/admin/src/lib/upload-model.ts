import type { components } from '@lumin/api-client';
import { presignModelUpload } from './asset-actions';

// Client-side helper for the product editor's 3D-model upload (P3-l l-2, ADR-036). Same two-step presigned-
// POST dance as ./upload-proof, but for source models (.glb/.stl/.3mf): ask the Server Action for a signed
// form, POST the bytes STRAIGHT to Garage (core-api never proxies the model body), and also compute the
// content hash the asset-job needs as `sourceVersion` (ADR-004 — Garage has no versioning). Kept a plain
// client util (no 'use server') so the file <input> and the hashing stay in the browser.

type ModelContentType = components['schemas']['ModelUploadInput']['contentType'];

// Map the picked file's extension to the exact model MIME the presign policy will allow. The BE gate lives
// in the signed POST policy; this is the client's first bounce so we never upload bytes Garage would refuse.
const EXT_MIME: Record<string, ModelContentType> = {
  glb: 'model/gltf-binary',
  stl: 'model/stl',
  '3mf': 'model/3mf',
};

/** The model MIME for a file name, or null if the extension isn't one of .glb/.stl/.3mf. */
export function modelMimeFor(fileName: string): ModelContentType | null {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  return EXT_MIME[ext] ?? null;
}

/** Lowercase hex SHA-256 of the given bytes — the asset-job `sourceVersion` (content hash, ADR-004).
 *  Uses Web Crypto, available in every secure context (https + localhost). */
export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** `type` = not a .glb/.stl/.3mf; `size` = larger than the signed policy's max (≤100MB); `error` = presign
 *  miss or the Garage POST failed. The model section maps each to friendly copy. */
export type ModelUploadError = 'type' | 'size' | 'error';

/**
 * Upload one source model and resolve to its host-pinned finalUrl + content hash, or an error. Steps:
 * map extension → MIME → presign (Server Action, owner-only) → size-check against the signed maxBytes →
 * hash the bytes (sourceVersion) → POST FormData (policy fields FIRST, the file LAST) to Garage. The
 * caller then enqueues the asset job(s) with {finalUrl, sourceVersion}. Garage answers 2xx on success.
 */
export async function uploadModelFile(
  productId: string,
  file: File,
): Promise<
  { ok: true; finalUrl: string; sourceVersion: string } | { ok: false; error: ModelUploadError }
> {
  const contentType = modelMimeFor(file.name);
  if (!contentType) return { ok: false, error: 'type' };

  const presigned = await presignModelUpload(productId, contentType);
  if (!presigned.ok) return { ok: false, error: 'error' };
  const upload = presigned.upload;

  if (file.size > upload.maxBytes) return { ok: false, error: 'size' };

  const bytes = await file.arrayBuffer();
  const sourceVersion = await sha256Hex(bytes);

  const form = new FormData();
  for (const [key, value] of Object.entries(upload.fields)) form.append(key, value);
  form.append('file', file); // the file part MUST come last (S3/Garage POST policy)

  try {
    const res = await fetch(upload.uploadUrl, { method: 'POST', body: form });
    if (!res.ok) return { ok: false, error: 'error' };
  } catch {
    return { ok: false, error: 'error' };
  }
  return { ok: true, finalUrl: upload.finalUrl, sourceVersion };
}
