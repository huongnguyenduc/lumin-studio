'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import QRCode from 'qrcode';
import { Button, Input } from '@lumin/ui';
import type { components } from '@lumin/api-client';
import { encodePrintTag } from '@/lib/print-queue-actions';
import type { PrintCard } from '@/lib/print-queue';

type PetTagRef = components['schemas']['PetTagRef'];

// Name of the iOS Shortcut the owner must create (Scan NFC Tag write + read UID + POST the confirm
// call, see docs handed to the owner) — fixed, not configurable this slice (ponytail: one shortcut).
const SHORTCUT_NAME = 'Lumin ghi chip NFC';

// Builds the shortcuts://run-shortcut deep link that launches SHORTCUT_NAME with the print job's id as
// its Shortcut Input — the ONLY thing Shortcuts needs that isn't already on-screen (the burn URL is).
// One tap on iOS opens Shortcuts pre-filled; scanning the same link as a QR from another device does the
// same. No dev account, no Core NFC — this is a plain Apple URL scheme (iOS 13+).
function shortcutRunURL(jobId: string): string {
  const params = new URLSearchParams({ name: SHORTCUT_NAME, input: 'text', text: jobId });
  return `shortcuts://run-shortcut?${params.toString()}`;
}

// Minimal Web NFC surface — NDEFReader is not yet in the TS DOM lib. Chrome-Android only (D2); everywhere
// else NDEFReaderCtor is undefined and the sheet falls back to manual chip-UID entry.
interface NdefReadEvent {
  serialNumber: string;
}
interface NdefWriter {
  write(message: { records: { recordType: string; data: string }[] }): Promise<void>;
  scan(): Promise<void>;
  onreading: ((event: NdefReadEvent) => void) | null;
}
const NDEFReaderCtor =
  typeof window !== 'undefined'
    ? (window as unknown as { NDEFReader?: new () => NdefWriter }).NDEFReader
    : undefined;

/**
 * The "Ghi chip NFC" sheet (P3-t t-2, spec §10). Opens for an nfc_tag card in the NFC_ENCODE column. On
 * open it PREPARES (encode with no chipUid) to mint/return the pet-tag URL to burn; staff writes the chip
 * — Web NFC if the device supports it (D2), else any external NFC tool — enters the chip UID, and
 * CONFIRMS, which flips the tag to ENCODED and advances the card to PACKING. onEncoded folds the returned
 * card back into the board. Native <dialog> so Esc/backdrop close + focus-trap come free (mirrors
 * transition-dialog); the parent keys it per card so every open starts clean.
 */
export function EncodeTagSheet({
  card,
  onClose,
  onEncoded,
}: {
  card: PrintCard;
  onClose: () => void;
  onEncoded: (card: PrintCard) => void;
}) {
  const t = useTranslations('printQueue.encode');
  const ref = useRef<HTMLDialogElement>(null);
  const [tag, setTag] = useState<PetTagRef | null>(null);
  const [phase, setPhase] = useState<'preparing' | 'ready' | 'prepareError'>('preparing');
  const [chipUid, setChipUid] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(false);
  const [nfcNote, setNfcNote] = useState<'written' | 'failed' | null>(null);
  const [shortcutQr, setShortcutQr] = useState<string | null>(null);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  // Render the Shortcuts deep link as a QR the moment the sheet is ready — for a board open on a
  // different device (iPad, print-station desktop) than the phone that will do the tap. toDataURL runs
  // client-side only (no third party sees the job id).
  useEffect(() => {
    let alive = true;
    void QRCode.toDataURL(shortcutRunURL(card.id), { margin: 1, width: 176 }).then((url) => {
      if (alive) setShortcutQr(url);
    });
    return () => {
      alive = false;
    };
  }, [card.id]);

  // Prepare: mint the tag + fetch the URL to burn (no chipUid). Re-runnable via the retry button.
  const prepare = useCallback(() => {
    let alive = true;
    setPhase('preparing');
    void encodePrintTag(card.id).then((res) => {
      if (!alive) return;
      if (res.ok) {
        setTag(res.result.tag);
        setPhase('ready');
      } else {
        setPhase('prepareError');
      }
    });
    return () => {
      alive = false;
    };
  }, [card.id]);

  useEffect(() => prepare(), [prepare]);

  async function writeChip() {
    if (!tag || !NDEFReaderCtor) return;
    setNfcNote(null);
    try {
      const reader = new NDEFReaderCtor();
      await reader.write({ records: [{ recordType: 'url', data: tag.url }] });
      setNfcNote('written');
      // Auto-fill the chip UID by scanning the tag we just wrote, instead of making staff copy it by
      // hand. Best-effort: if the tag was already lifted away, scan() rejects — the staff just falls
      // back to typing the UID manually (no note shown, since the write itself still succeeded).
      reader.onreading = (event) => setChipUid(event.serialNumber);
      reader.scan().catch(() => {});
    } catch {
      setNfcNote('failed');
    }
  }

  async function confirm() {
    const uid = chipUid.trim();
    if (!uid) return;
    setSubmitting(true);
    setError(false);
    const res = await encodePrintTag(card.id, uid);
    setSubmitting(false);
    if (res.ok) onEncoded(res.result.card);
    else setError(true);
  }

  const titleId = 'encode-tag-title';
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      className="w-[min(30rem,calc(100vw-2rem))] rounded-lg border-2 border-border-strong bg-surface-card p-0 text-text-body shadow-lg backdrop:bg-black/40"
    >
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          if (!submitting && chipUid.trim()) void confirm();
        }}
        className="flex flex-col gap-4 p-6"
      >
        <div>
          <h2 id={titleId} className="font-display text-xl font-semibold text-text-strong">
            {t('title')}
          </h2>
          <p className="mt-0.5 font-mono text-xs text-text-muted">
            {card.productName} · {card.orderCode}
          </p>
        </div>

        {phase === 'preparing' && <p className="text-sm text-text-muted">{t('preparing')}</p>}

        {phase === 'prepareError' && (
          <p role="alert" className="text-sm text-danger">
            {t('prepareError')}
          </p>
        )}

        {phase === 'ready' && tag && (
          <>
            <div className="flex flex-col gap-1.5">
              <span className="font-semibold text-text-strong">{t('urlLabel')}</span>
              <code className="break-all rounded-lg border-[1.5px] border-border-subtle bg-surface-sunken px-3 py-2 text-sm text-text-body">
                {tag.url}
              </code>
              <span className="text-xs text-text-muted">{t('urlHint')}</span>
            </div>

            {NDEFReaderCtor && (
              <div className="flex flex-col gap-1.5">
                <Button variant="outline" onClick={() => void writeChip()}>
                  {t('nfcWrite')}
                </Button>
                {nfcNote && (
                  <span
                    className={`text-xs ${nfcNote === 'written' ? 'text-accent-teal' : 'text-danger'}`}
                  >
                    {t(`nfc.${nfcNote}`)}
                  </span>
                )}
              </div>
            )}

            {!NDEFReaderCtor && (
              <div className="flex flex-col gap-2 rounded-lg border-[1.5px] border-border-subtle p-3">
                <span className="font-semibold text-text-strong">{t('shortcut.title')}</span>
                <p className="text-xs text-text-muted">{t('shortcut.hint')}</p>
                <div className="flex items-center gap-3">
                  {shortcutQr && (
                    // A runtime-generated data URL — not a static asset next/image can optimize.
                    <img
                      src={shortcutQr}
                      alt={t('shortcut.qrAlt')}
                      width={88}
                      height={88}
                      className="rounded-md border border-border-subtle"
                    />
                  )}
                  <a
                    href={shortcutRunURL(card.id)}
                    className="text-sm font-semibold text-primary underline underline-offset-2"
                  >
                    {t('shortcut.openLink')}
                  </a>
                </div>
              </div>
            )}

            <Input
              label={t('chipUidLabel')}
              value={chipUid}
              onChange={(e) => setChipUid(e.target.value)}
              placeholder="04:A1:B2:C3:D4:E5:80"
              autoComplete="off"
            />

            {error && (
              <p role="alert" className="text-sm text-danger">
                {t('error')}
              </p>
            )}
          </>
        )}

        <div className="mt-1 flex justify-end gap-3">
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            {t('back')}
          </Button>
          {phase === 'prepareError' ? (
            <Button onClick={() => prepare()}>{t('retry')}</Button>
          ) : (
            <Button type="submit" disabled={phase !== 'ready' || submitting || !chipUid.trim()}>
              {submitting ? t('submitting') : t('confirm')}
            </Button>
          )}
        </div>
      </form>
    </dialog>
  );
}
