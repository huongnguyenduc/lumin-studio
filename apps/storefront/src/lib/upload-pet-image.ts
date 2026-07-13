import { createPaymentProofUpload, type ProofUploadContentType } from './order-submit';

// Browser-side image upload for the pet-page editor (P3-t t-4c-1) — the avatar + album photos. Reuses the P2-c
// presigned-POST flow verbatim: ask core-api for a one-object policy, then POST the bytes STRAIGHT to Garage
// (never through core-api), and keep the host-pinned finalUrl. ponytail: pet images share the payment-proof
// bucket-prefix (same as the admin product gallery, l-2) — one presign endpoint, no new upload infra. KNOWN
// CEILING: that bucket carries ADR-035's 90-day terminal retention, but pet photos are meant to be permanent —
// t-6's retention pass must exempt these keys (or move them to a permanent prefix) so a lost pet's photos don't
// silently expire (tracked in plans/pet-tag.md t-6). Runs only from a client component.

const PET_IMAGE_TYPES: readonly ProofUploadContentType[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
];

// type = the OS reported a MIME we don't accept (re-pick JPG/PNG/WebP); size = over the policy's maxBytes;
// upload = the presign or the Garage POST failed (retryable).
export type PetImageUploadResult =
  | { ok: true; url: string }
  | { ok: false; code: 'type' | 'size' | 'upload' };

export async function uploadPetImage(file: File): Promise<PetImageUploadResult> {
  const contentType = PET_IMAGE_TYPES.find((t) => t === file.type);
  if (!contentType) return { ok: false, code: 'type' };
  const bootstrap = await createPaymentProofUpload(contentType);
  if (!bootstrap.ok) return { ok: false, code: 'upload' };
  const { uploadUrl, fields, finalUrl, maxBytes } = bootstrap.upload;
  if (file.size > maxBytes) return { ok: false, code: 'size' };
  // S3/Garage presigned POST: every policy field first, the file part LAST.
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.append(key, value);
  body.append('file', file);
  try {
    const res = await fetch(uploadUrl, { method: 'POST', body });
    if (!res.ok) return { ok: false, code: 'upload' };
    return { ok: true, url: finalUrl };
  } catch {
    return { ok: false, code: 'upload' };
  }
}
