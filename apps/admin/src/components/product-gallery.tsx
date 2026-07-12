'use client';

import { useRef, useState, useTransition, type ChangeEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@lumin/ui';
import { uploadProofFile, type UploadError } from '@/lib/upload-proof';

/**
 * Product gallery editor (P3-l l-2). Shop photos are the product's primary visual — images[0] is the card
 * cover (ADR-007: the worker never renders a cover). Controlled: edits go up via onChange and persist with
 * the product's main "Lưu sản phẩm" (PATCH), like the core fields — the gallery is a Product field, not its
 * own resource. Upload reuses the shared presigned-POST dance (./upload-proof) straight to Garage. Reorder
 * is minimal (set-cover + remove); drag-to-sort is a later refinement.
 */
export function ProductGallery({
  images,
  onChange,
}: {
  images: string[];
  onChange: (next: string[]) => void;
}) {
  const t = useTranslations('products.edit.gallery');
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, startUpload] = useTransition();
  const [error, setError] = useState<UploadError | null>(null);

  function onPick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    if (!file) return;
    setError(null);
    startUpload(async () => {
      const res = await uploadProofFile(file);
      if (res.ok) onChange([...images, res.url]);
      else setError(res.error);
    });
  }

  function removeAt(i: number) {
    onChange(images.filter((_, idx) => idx !== i));
  }
  // Move image i to the front — images[0] is the cover (ADR-007).
  function makeCover(i: number) {
    onChange([images[i], ...images.filter((_, idx) => idx !== i)]);
  }

  return (
    <div className="flex flex-col gap-3">
      {images.length === 0 ? (
        <p className="text-sm text-text-muted">{t('empty')}</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {images.map((url, i) => (
            <li key={url} className="flex flex-col gap-1.5">
              <div className="relative aspect-square overflow-hidden rounded-lg border border-border-default bg-surface-sunken">
                <img src={url} alt="" className="h-full w-full object-cover" />
                {i === 0 && (
                  <span className="absolute left-1.5 top-1.5 rounded-pill bg-black/60 px-2 py-0.5 text-xs font-semibold text-on-dark">
                    {t('cover')}
                  </span>
                )}
              </div>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => makeCover(i)}
                  disabled={i === 0}
                  className="min-h-[44px] flex-1 rounded-lg border border-border-default px-2 text-sm font-medium text-text-body enabled:hover:border-primary disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky focus-visible:ring-offset-2"
                >
                  {t('makeCover')}
                </button>
                <button
                  type="button"
                  onClick={() => removeAt(i)}
                  aria-label={t('remove')}
                  className="flex min-h-[44px] w-11 items-center justify-center rounded-lg border border-border-default text-lg text-text-muted hover:border-danger hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky focus-visible:ring-offset-2"
                >
                  ×
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={onPick}
        className="sr-only"
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? t('uploading') : t('add')}
        </Button>
        {error && (
          <span role="alert" className="text-sm text-danger">
            {t(`err.${error}`)}
          </span>
        )}
      </div>
    </div>
  );
}
