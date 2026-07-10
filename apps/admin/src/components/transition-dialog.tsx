'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Input } from '@lumin/ui';
import type { components } from '@lumin/api-client';
import { transitionOrder } from '@/lib/order-actions';
import { uploadProofFile } from '@/lib/upload-proof';
import type { AvailableTransition } from '@/lib/order-detail';

type TransitionRequest = components['schemas']['TransitionRequest'];

// The dialog-driven transitions (P3-e). `ship` needs a tracking code + a QC packing photo; `cancel`
// needs a reason; `refund` needs a reason + a refund-transfer proof image. Native <dialog> (showModal)
// so Esc/backdrop close and focus-trap come for free; mounted only while open (parent keys it per
// action, so every open starts with a clean form). The server re-validates every field — this dialog
// just keeps the UI from submitting an obviously-incomplete transition.

// Preset reasons per the design's radio list (plan §183 — reason required, submit locked until picked).
// The SELECTED radio's translated label is what we store as statusHistory.reason (free text, vi).
const REASON_KEYS = {
  cancel: ['changedMind', 'outOfMaterial', 'duplicate'],
  refund: ['customerRequest', 'damaged', 'wrongItem'],
} as const;

export function TransitionDialog({
  orderId,
  action,
  onClose,
  onDone,
}: {
  orderId: string;
  action: AvailableTransition;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations('orderDetail');
  const ref = useRef<HTMLDialogElement>(null);
  const [reasonKey, setReasonKey] = useState('');
  const [trackingCode, setTrackingCode] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const kind = action.kind; // 'ship' | 'cancel' | 'refund' (confirm/advance never open a dialog)

  // Open on mount; the DOM `close` event (Esc / our buttons) bubbles up to unmount via onClose.
  useEffect(() => {
    ref.current?.showModal();
  }, []);

  const needsReason = kind === 'cancel' || kind === 'refund';
  const needsFile = kind === 'ship' || kind === 'refund';
  const needsTracking = kind === 'ship';
  const canSubmit =
    !submitting &&
    (!needsReason || reasonKey !== '') &&
    (!needsTracking || trackingCode.trim() !== '') &&
    (!needsFile || file !== null);

  async function submit() {
    setSubmitting(true);
    setError(null);

    // The transition needs the finalUrl, so the image must upload BEFORE we call it. ponytail: if the
    // upload succeeds but the transition then fails (409/422), the Garage object is orphaned — harmless
    // unreferenced bytes (no money/state effect; the real refund is a manual bank transfer). Accepted
    // for a one-shop admin; add a cleanup sweep only if these accumulate.
    let proofUrl = '';
    if (needsFile) {
      const up = await uploadProofFile(file as File);
      if (!up.ok) {
        setSubmitting(false);
        setError(up.error === 'type' ? 'uploadType' : up.error === 'size' ? 'uploadSize' : 'error');
        return;
      }
      proofUrl = up.url;
    }

    const reason = needsReason ? t(`${kind}Reason.${reasonKey}`) : undefined;
    const body: TransitionRequest =
      kind === 'ship'
        ? { to: 'SHIPPING', trackingCode: trackingCode.trim(), qcPhotoUrl: proofUrl }
        : kind === 'cancel'
          ? { to: 'CANCELLED', reason }
          : { to: 'REFUNDED', reason, refundProofUrl: proofUrl };

    const res = await transitionOrder(orderId, body);
    setSubmitting(false);
    if (res.ok) onDone();
    else setError(res.code);
  }

  const titleId = 'transition-dialog-title';
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      className="w-[min(30rem,calc(100vw-2rem))] rounded-lg border-2 border-border-strong bg-surface p-0 text-text-body shadow-lg backdrop:bg-cocoa-900/40"
    >
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) void submit();
        }}
        className="flex flex-col gap-4 p-6"
      >
        <h2 id={titleId} className="font-display text-xl font-semibold text-text-strong">
          {t(`${kind}.title`)}
        </h2>
        <p className="text-sm text-text-muted">{t(`${kind}.body`)}</p>

        {needsReason && (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 font-semibold text-text-strong">{t('reasonLabel')}</legend>
            {REASON_KEYS[kind as 'cancel' | 'refund'].map((key) => (
              <label key={key} className="flex items-center gap-2 text-text-body">
                <input
                  type="radio"
                  name="reason"
                  value={key}
                  checked={reasonKey === key}
                  onChange={() => setReasonKey(key)}
                  className="h-4 w-4"
                />
                {t(`${kind}Reason.${key}`)}
              </label>
            ))}
          </fieldset>
        )}

        {needsTracking && (
          <Input
            label={t('trackingLabel')}
            value={trackingCode}
            onChange={(e) => setTrackingCode(e.target.value)}
            placeholder="VN123456789"
            autoComplete="off"
          />
        )}

        {needsFile && (
          <label className="flex flex-col gap-1.5">
            <span className="font-semibold text-text-strong">
              {kind === 'ship' ? t('qcLabel') : t('proofLabel')}
            </span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="text-sm text-text-body file:mr-3 file:min-h-[44px] file:rounded-pill file:border-2 file:border-border-strong file:bg-surface-sunken file:px-4 file:font-semibold file:text-text-strong"
            />
            <span className="text-xs text-text-muted">{t('imageHint')}</span>
          </label>
        )}

        {error && (
          <p role="alert" className="text-sm text-danger">
            {t(`error.${error}`)}
          </p>
        )}

        <div className="mt-1 flex justify-end gap-3">
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            {t('back')}
          </Button>
          <Button type="submit" disabled={!canSubmit}>
            {submitting ? t('submitting') : t(`${kind}.confirm`)}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
