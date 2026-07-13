import type { components } from '@lumin/api-client';
import { presignProofUpload, presignImageUpload } from './order-actions';

// Client-side helpers for the two-step presigned-POST upload dance (ask a Server Action for a signed form,
// then POST the bytes STRAIGHT to Garage — core-api never proxies the file). `uploadProofFile` targets the
// private payment-proof bucket (refund / QC photos, P3-e); `uploadImageFile` targets the permanent, world-
// readable lumin-assets bucket (product gallery, P3-l) whose objects are never retention-swept (t-6). Kept
// as plain client utils (no 'use server') so the file <input> stays in the browser.

type ProofUpload = components['schemas']['PaymentProofUpload'];
type ProofContentType = components['schemas']['PaymentProofUploadInput']['contentType'];

// The three MIME types both presigned-POST policies accept (P2-c / t-6 share the same image set). A file
// outside this set is rejected before we even ask for a form, so the browser never uploads bytes Garage
// would refuse.
const ALLOWED: readonly ProofContentType[] = ['image/jpeg', 'image/png', 'image/webp'];

function allowedContentType(type: string): ProofContentType | null {
  return (ALLOWED as readonly string[]).includes(type) ? (type as ProofContentType) : null;
}

/** `type` = the picked file is not a JP/PNG/WebP image; `size` = larger than the signed policy's max;
 *  `error` = presign miss or the Garage POST failed. The dialog maps each to friendly copy. */
export type UploadError = 'type' | 'size' | 'error';

type UploadResult = { ok: true; url: string } | { ok: false; error: UploadError };

// postToGarage runs the shared half once a form is signed: size-check against the policy max, then POST the
// FormData (policy fields FIRST, the file LAST) to Garage, which answers 201 on success. Returns finalUrl.
// The two upload flavours differ only in which bucket the Server Action signed; the browser dance is one.
async function postToGarage(file: File, upload: ProofUpload): Promise<UploadResult> {
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

/**
 * Upload one image to the PRIVATE payment-proof bucket (refund proof / QC photo, P3-e) → its final object
 * URL, or an UploadError. Validate MIME → presign (Server Action) → POST to Garage.
 */
export async function uploadProofFile(file: File): Promise<UploadResult> {
  const contentType = allowedContentType(file.type);
  if (!contentType) return { ok: false, error: 'type' };

  const presigned = await presignProofUpload(contentType);
  if (!presigned.ok) return { ok: false, error: 'error' };
  return postToGarage(file, presigned.upload);
}

/**
 * Upload one image to the PERMANENT world-readable lumin-assets bucket (product gallery, P3-l) → its final
 * object URL, or an UploadError. Same dance as uploadProofFile but the object is never retention-swept (t-6).
 */
export async function uploadImageFile(file: File): Promise<UploadResult> {
  const contentType = allowedContentType(file.type);
  if (!contentType) return { ok: false, error: 'type' };

  const presigned = await presignImageUpload(contentType);
  if (!presigned.ok) return { ok: false, error: 'error' };
  return postToGarage(file, presigned.upload);
}
