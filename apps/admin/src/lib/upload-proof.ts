import type { components } from '@lumin/api-client';
import { presignProofUpload } from './order-actions';

// Client-side helper for the refund-proof / QC-photo uploads (P3-e). It does the two-step presigned-POST
// dance the storefront checkout also uses: ask the Server Action for a signed form, then POST the bytes
// STRAIGHT to Garage (core-api never proxies the file). Returns the host-pinned finalUrl to send on the
// transition. Kept as a plain client util (no 'use server') so the file <input> stays in the browser.

type ProofUpload = components['schemas']['PaymentProofUpload'];
type ProofContentType = components['schemas']['PaymentProofUploadInput']['contentType'];

// The three MIME types the presigned-POST policy accepts (P2-c). A file outside this set is rejected
// before we even ask for a form, so the browser never uploads bytes Garage would refuse.
const ALLOWED: readonly ProofContentType[] = ['image/jpeg', 'image/png', 'image/webp'];

function allowedContentType(type: string): ProofContentType | null {
  return (ALLOWED as readonly string[]).includes(type) ? (type as ProofContentType) : null;
}

/** `type` = the picked file is not a JP/PNG/WebP image; `size` = larger than the signed policy's max;
 *  `error` = presign miss or the Garage POST failed. The dialog maps each to friendly copy. */
export type UploadError = 'type' | 'size' | 'error';

/**
 * Upload one image and resolve to its final object URL, or an UploadError. Steps: validate MIME →
 * presign (Server Action) → size-check against the signed maxBytes → POST FormData (policy fields
 * FIRST, the file LAST) to Garage → return finalUrl. Garage answers 201 on success (per the policy).
 */
export async function uploadProofFile(
  file: File,
): Promise<{ ok: true; url: string } | { ok: false; error: UploadError }> {
  const contentType = allowedContentType(file.type);
  if (!contentType) return { ok: false, error: 'type' };

  const presigned = await presignProofUpload(contentType);
  if (!presigned.ok) return { ok: false, error: 'error' };
  const upload: ProofUpload = presigned.upload;

  if (file.size > upload.maxBytes) return { ok: false, error: 'size' };

  const form = new FormData();
  for (const [key, value] of Object.entries(upload.fields)) form.append(key, value);
  form.append('file', file); // the file part MUST come last (S3/Garage POST policy)

  try {
    const res = await fetch(upload.uploadUrl, { method: 'POST', body: form });
    if (!res.ok) return { ok: false, error: 'error' };
  } catch {
    return { ok: false, error: 'error' };
  }
  return { ok: true, url: upload.finalUrl };
}
