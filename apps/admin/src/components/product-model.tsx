'use client';

import { useEffect, useRef, useState, useTransition, type ChangeEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Badge, Button } from '@lumin/ui';
import type { components } from '@lumin/api-client';
import { uploadModelFile, type ModelUploadError } from '@/lib/upload-model';
import { createAssetJob, getAssetJobs, type AssetJobCode } from '@/lib/asset-actions';
import { latestJobsByType } from '@/lib/product-model';

type AssetJob = components['schemas']['AssetJob'];
type JobStatus = AssetJob['status'];

// Badge hue per job status (queued=waiting, processing=in-flight, ready=done, failed=error).
const JOB_TONE = { queued: 'neutral', processing: 'sky', ready: 'teal', failed: 'danger' } as const;
const isPending = (s: JobStatus) => s === 'queued' || s === 'processing';
// Auto-poll cap: a render (sprite_render on the GPU) can take a while, so poll ~80s, then stop and offer a
// manual refresh so an open editor tab doesn't spin forever. ponytail: raise if real renders outlast it.
const POLL_CAP = 20;
const POLL_MS = 4000;

/**
 * The 3D-model section of the product editor (P3-l l-2, ADR-036 / ADR-007). Upload a source model
 * (.glb/.stl/.3mf) straight to Garage (./upload-model), then enqueue BOTH pipeline jobs from it:
 * `model_ingest` → the interactive `model3dUrl` (the l-5 viewer) and `sprite_render` → the 360° hover /
 * no-WebGL-fallback sprite. The card COVER stays a shop photo (the gallery), not the sprite (ADR-007).
 * Status is polled (no SSE for asset jobs); when the pipeline settles we router.refresh() to pull the
 * product's new model3dUrl. Edit-mode only — the endpoints are keyed by an existing product id.
 */
export function ProductModel({ productId, model3dUrl }: { productId: string; model3dUrl: string }) {
  const t = useTranslations('products.edit.model');
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, startUpload] = useTransition();
  const [jobs, setJobs] = useState<AssetJob[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [polls, setPolls] = useState(0);
  const [uploadError, setUploadError] = useState<ModelUploadError | null>(null);
  const [jobError, setJobError] = useState<AssetJobCode | null>(null);

  // Initial load.
  useEffect(() => {
    let alive = true;
    getAssetJobs(productId).then((j) => {
      if (!alive) return;
      setJobs(j);
      setLoadingJobs(false);
    });
    return () => {
      alive = false;
    };
  }, [productId]);

  // Show only the latest job per type: re-uploading fires fresh jobs and old attempts (incl. resolved
  // failures) are never pruned server-side, so render/poll off the collapsed view, not the raw pile.
  const latestJobs = latestJobsByType(jobs);
  // Poll while any current job is pending, capped. On settle, refresh the RSC to pull the new model3dUrl.
  const anyPending = latestJobs.some((j) => isPending(j.status));
  useEffect(() => {
    if (!anyPending || polls >= POLL_CAP) return;
    const id = setTimeout(async () => {
      const next = await getAssetJobs(productId);
      setJobs(next);
      setPolls((p) => p + 1);
      if (!next.some((j) => isPending(j.status))) router.refresh();
    }, POLL_MS);
    return () => clearTimeout(id);
  }, [anyPending, polls, productId, router]);

  function onPick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    if (!file) return;
    setUploadError(null);
    setJobError(null);
    startUpload(async () => {
      const up = await uploadModelFile(productId, file);
      if (!up.ok) {
        setUploadError(up.error);
        return;
      }
      const results = await Promise.all(
        (['model_ingest', 'sprite_render'] as const).map((jobType) =>
          createAssetJob(productId, {
            jobType,
            sourceModelUrl: up.finalUrl,
            sourceVersion: up.sourceVersion,
          }),
        ),
      );
      const failed = results.find((r) => !r.ok);
      if (failed && !failed.ok) setJobError(failed.code);
      setJobs(await getAssetJobs(productId));
      setPolls(0);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-text-muted">{t('current')}</span>
        {model3dUrl ? (
          <a
            href={model3dUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-accent-teal underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky focus-visible:ring-offset-2"
          >
            {t('ready')}
          </a>
        ) : (
          <span className="text-text-body">{t('none')}</span>
        )}
      </p>

      <input
        ref={inputRef}
        type="file"
        accept=".glb,.stl,.3mf,model/gltf-binary,model/stl,model/3mf"
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
          {uploading ? t('uploading') : t('upload')}
        </Button>
        <span className="text-sm text-text-muted">{t('uploadHint')}</span>
      </div>
      {uploadError && (
        <p role="alert" className="text-sm text-danger">
          {t(`err.${uploadError}`)}
        </p>
      )}
      {jobError && (
        <p role="alert" className="text-sm text-danger">
          {t(`jobErr.${jobError}`)}
        </p>
      )}

      {loadingJobs ? (
        <p className="text-sm text-text-muted">{t('loadingJobs')}</p>
      ) : latestJobs.length === 0 ? (
        <p className="text-sm text-text-muted">{t('noJobs')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {latestJobs.map((j) => (
            <li
              key={j.id}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-border-default px-3 py-2 text-sm"
            >
              <span className="font-medium text-text-strong">{t(`jobType.${j.jobType}`)}</span>
              <Badge tone={JOB_TONE[j.status]}>{t(`jobStatus.${j.status}`)}</Badge>
              {j.status === 'failed' && j.lastError && (
                <span className="text-danger">{j.lastError}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {anyPending && polls >= POLL_CAP && (
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setPolls(0);
              getAssetJobs(productId).then(setJobs);
            }}
          >
            {t('refreshJobs')}
          </Button>
        </div>
      )}
    </div>
  );
}
