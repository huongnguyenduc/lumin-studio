import { createImageUpload, type ImageUploadContentType } from './image-upload';

// Browser-side image upload for the pet-page editor (P3-t) — the avatar + album photos. Asks core-api for a
// one-object presigned POST, then POSTs the bytes STRAIGHT to Garage (never through core-api) and keeps the
// host-pinned finalUrl. Targets POST /uploads/image → the world-readable lumin-assets bucket, which has NO
// retention sweeper (t-6): unlike a receipt on the 90-day payment-proof bucket, a lost pet's photo never
// expires. Runs only from a client component.

const PET_IMAGE_TYPES: readonly ImageUploadContentType[] = [
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
  const bootstrap = await createImageUpload(contentType);
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
