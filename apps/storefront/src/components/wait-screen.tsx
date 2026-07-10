'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@lumin/ui';
import { trackOrder } from '@/lib/order-track';
import { buildTimeline, buildTrackHandle, isPollableStatus } from '@/lib/order-lookup-view';
import { useOrderPoll } from '@/lib/use-order-poll';
import { CtaLink } from './cta-link';
import { OrderStatusBadge, OrderTimeline } from './order-timeline';

// Same shop-contact target the tracker (order-lookup) and the footer link to — one place to change.
const SHOP_CONTACT_HREF = '/lien-he';

/**
 * Post-checkout wait-screen + confirmation (C3, P2-g). Reached two ways with the SAME behavior: right
 * after placing an order (checkout-view passes `justPlaced`, holding the code + 201 trackingToken in
 * memory) and by returning to the phone-less deep link `/o/{code}-{token}` later. It polls
 * GET /orders/track (token, no phone) through the SHARED loop (lib/use-order-poll) so a
 * PENDING_CONFIRM→PAID flip lands without a refresh; OrderTimeline + orderStatus i18n are reused verbatim
 * from the P1-o tracker. The CANCELLED branch (the shop rejected the transfer proof, spec §04) gets its
 * own friendly, terminal copy — polling has already stopped (CANCELLED is terminal). Renders the full
 * state set (loading · found · cancelled · invalid-link · rate-limited · error).
 */
export function WaitScreen({
  code,
  token,
  justPlaced = false,
}: {
  code: string;
  token: string;
  justPlaced?: boolean;
}) {
  const t = useTranslations('track');
  const tLookup = useTranslations('lookup');
  // Stable restartKey = code → polls once on mount; the fetcher closes over the latest code/token (read
  // from a ref inside the hook), and `retry` re-runs on the paused-refresh / error buttons.
  const { state, retry } = useOrderPoll(() => trackOrder(code, token), code);
  const handle = buildTrackHandle(code, token);

  return (
    <section className="mx-auto w-full max-w-[560px] px-4 py-6 md:px-6 md:py-10">
      {justPlaced ? (
        <p className="rounded-lg border-2 border-border-strong bg-surface-card p-4 text-center font-display text-base font-semibold text-text-strong">
          {t('placedThanks')}
        </p>
      ) : null}

      {/* Announced politely so assistive tech reads status flips as the wait-screen polls. */}
      <div
        className={justPlaced ? 'mt-4' : ''}
        aria-live="polite"
        aria-busy={state.kind === 'loading'}
      >
        {state.kind === 'loading' ? <Loading label={t('loading')} /> : null}

        {state.kind === 'found' && state.order.status === 'CANCELLED' ? (
          <div
            role="alert"
            className="flex flex-col items-start gap-3 rounded-lg border-2 border-border-strong bg-surface-sunken p-6"
          >
            <OrderStatusBadge status="CANCELLED" />
            <h1 className="font-display text-lg font-bold text-text-strong">
              {t('cancelledTitle')}
            </h1>
            <p className="text-sm text-text-body">{t('cancelledBody')}</p>
            <CtaLink href={SHOP_CONTACT_HREF} variant="pop" className="mt-1">
              {t('contactShop')}
            </CtaLink>
          </div>
        ) : state.kind === 'found' ? (
          <div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h1 className="font-display text-xl font-bold text-text-strong">
                {t('heading', { code: state.order.code })}
              </h1>
              <OrderStatusBadge status={state.order.status} />
            </div>
            {state.order.status === 'PENDING_CONFIRM' ? (
              <p className="mt-2 text-sm text-text-muted">{t('pendingNote')}</p>
            ) : null}

            <TrackLink handle={handle} />

            <div className="mt-6">
              <OrderTimeline model={buildTimeline(state.order)} />
            </div>

            <div className="mt-6 flex flex-col items-start gap-3">
              {state.live ? (
                <p className="text-xs text-text-subtle">{tLookup('live')}</p>
              ) : isPollableStatus(state.order.status) ? (
                <>
                  <p className="text-xs text-text-subtle">{tLookup('paused')}</p>
                  <Button type="button" variant="outline" onClick={retry}>
                    {tLookup('refresh')}
                  </Button>
                </>
              ) : null}
              <CtaLink href={SHOP_CONTACT_HREF} variant="outline">
                {t('contactShop')}
              </CtaLink>
            </div>
          </div>
        ) : null}

        {state.kind === 'not_found' ? <TrackInvalid /> : null}

        {state.kind === 'rate_limited' ? (
          <div role="alert" className="flex flex-col items-center gap-3 px-4 py-10 text-center">
            <h1 className="font-display text-lg font-bold text-text-strong">
              {tLookup('rateLimitedTitle')}
            </h1>
            <p className="max-w-sm text-sm text-text-muted">{tLookup('rateLimitedBody')}</p>
          </div>
        ) : null}

        {state.kind === 'error' ? (
          <div role="alert" className="flex flex-col items-center gap-3 px-4 py-10 text-center">
            <h1 className="font-display text-lg font-bold text-text-strong">
              {tLookup('errorTitle')}
            </h1>
            <p className="max-w-sm text-sm text-text-muted">{tLookup('errorBody')}</p>
            <Button type="button" onClick={retry}>
              {tLookup('retry')}
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

/** The phone-less tracking deep link (`/o/{code}-{token}`) with a copy button. The absolute URL is built
 *  from the browser's own origin (same-origin by definition) — no server env needed; before mount the
 *  origin is empty, so the relative path shows and copy is disabled until it fills. */
function TrackLink({ handle }: { handle: string }) {
  const t = useTranslations('track');
  const [origin, setOrigin] = useState('');
  const [copied, setCopied] = useState(false);
  useEffect(() => setOrigin(window.location.origin), []);

  const url = `${origin}/o/${handle}`;
  const copy = async () => {
    try {
      await navigator.clipboard?.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked (insecure context / denied) — the link is shown as selectable text to copy by hand.
    }
  };

  return (
    <div className="mt-4 rounded-lg border-2 border-border-strong bg-surface-card p-4">
      <p className="font-display text-sm font-bold text-text-strong">{t('linkLabel')}</p>
      <p className="mt-1 text-xs text-text-muted">{t('linkHint')}</p>
      <div className="mt-2 flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md border border-border-subtle bg-surface-sunken px-3 py-2 font-mono text-xs text-text-body">
          {origin ? url : `/o/${handle}`}
        </code>
        <Button type="button" variant="outline" size="md" onClick={copy} disabled={!origin}>
          {copied ? t('copied') : t('copy')}
        </Button>
      </div>
      {copied ? (
        <span role="status" className="sr-only">
          {t('copied')}
        </span>
      ) : null}
    </div>
  );
}

/** "Link theo dõi sai hoặc đã hết hạn" — the invalid/expired deep-link state (hi-fi C3). Rendered inside
 *  WaitScreen (a wrong/absent token → uniform 404 → not_found) AND standalone by the /o/ route when the
 *  handle itself is malformed (no code to poll). No section wrapper — each caller provides the layout. */
export function TrackInvalid() {
  const t = useTranslations('track');
  return (
    <div role="alert" className="flex flex-col items-center gap-3 px-4 py-10 text-center">
      <h1 className="font-display text-lg font-bold text-text-strong">{t('invalidTitle')}</h1>
      <p className="max-w-sm text-sm text-text-muted">{t('invalidBody')}</p>
      <CtaLink href={SHOP_CONTACT_HREF} variant="outline" className="mt-2">
        {t('contactShop')}
      </CtaLink>
    </div>
  );
}

/** Loading affordance while the first track poll is in flight (spinner stilled by reduced-motion). */
function Loading({ label }: { label: string }) {
  return (
    <div role="status" className="flex flex-col items-center gap-3 py-10">
      <span
        aria-hidden="true"
        className="h-8 w-8 rounded-full border-[3px] border-border-default border-t-accent-flame motion-safe:animate-spin"
      />
      <span className="font-mono text-sm text-text-subtle">{label}</span>
    </div>
  );
}
