'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { sharePetLocation } from '@/lib/pet-actions';
import { track } from '@/lib/analytics';

// The finder's rescue send-once on the LOST pet page (spec §10 4a→4b, P3-t t-4b). Rendered only in the lost
// view (a stranger + lostMode). The PURPOSE is stated BEFORE any permission is requested (PDPL — nêu rõ mục
// đích trước khi xin quyền); tapping the button asks the browser for geolocation, and on grant the {lat,lng}
// is POSTed ONCE (core-api records the lost_events row = the consent-point-2 artifact). States: idle → locating
// (browser prompt) → sending → sent (4b "đã gửi"); or denied (permission refused — the finder can still
// call/message via the contact card above) / error (retry) / notLost (the owner un-flagged mid-flow). Once
// sent, the control is replaced by the thank-you (send-once). ≥44px hit target, keyed copy.

const PIN = '📍';
const DONE = '🎉';

type Phase = 'idle' | 'locating' | 'sending' | 'sent' | 'denied' | 'notLost' | 'error';

export function FinderLocationShare({ shortId, petName }: { shortId: string; petName: string }) {
  const t = useTranslations('petTag.page.finder');
  const [phase, setPhase] = useState<Phase>('idle');

  const onShare = () => {
    if (phase === 'locating' || phase === 'sending' || phase === 'sent') return; // guard double-taps + send-once
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setPhase('denied'); // no geolocation support → same fallback as a refusal (call/message still works)
      return;
    }
    setPhase('locating');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPhase('sending');
        void (async () => {
          const res = await sharePetLocation(shortId, pos.coords.latitude, pos.coords.longitude);
          if (res.ok) {
            track('finder_location_shared');
            setPhase('sent');
          } else setPhase(res.code === 'notLost' ? 'notLost' : 'error');
        })();
      },
      (err) => {
        // PERMISSION_DENIED (1) → the finder declined; other codes (unavailable / timeout) → a retryable error.
        // Either way the contact card above still works, so this is never a dead end.
        setPhase(err.code === err.PERMISSION_DENIED ? 'denied' : 'error');
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  };

  // Sent (4b): the control is gone — sending once is the whole contract.
  if (phase === 'sent') {
    return (
      <div className="rounded-2xl border-2 border-accent-teal bg-accent-teal-soft px-4 py-3 text-center">
        <p className="text-sm font-semibold text-text-strong">
          {DONE} {t('sent', { name: petName })}
        </p>
      </div>
    );
  }

  const busy = phase === 'locating' || phase === 'sending';
  return (
    <div className="rounded-2xl border-2 border-border-strong bg-surface-card p-4 shadow-pop">
      <p className="text-sm text-text-body">{t('purpose')}</p>
      <button
        type="button"
        onClick={onShare}
        disabled={busy}
        className="mt-3 inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border-2 border-border-strong bg-primary px-4 font-display font-bold text-on-primary shadow-pop focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky focus-visible:ring-offset-2 disabled:opacity-70"
      >
        {PIN}{' '}
        {phase === 'locating' ? t('locating') : phase === 'sending' ? t('sending') : t('button')}
      </button>
      {(phase === 'denied' || phase === 'error' || phase === 'notLost') && (
        <div role="alert" className="mt-2">
          <p className="text-sm text-danger">
            {phase === 'denied' ? t('denied') : phase === 'notLost' ? t('notLost') : t('error')}
          </p>
          {phase === 'denied' && (
            <p className="mt-0.5 font-mono text-[11px] text-text-muted">{t('deniedHint')}</p>
          )}
          {phase === 'error' && (
            <button
              type="button"
              onClick={onShare}
              className="mt-1 min-h-[44px] text-sm font-semibold text-primary underline"
            >
              {t('retry')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
