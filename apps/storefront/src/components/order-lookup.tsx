'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Input } from '@lumin/ui';
import { lookupOrder } from '@/lib/order-lookup';
import { buildTimeline, isPollableStatus, normalizeLookupInput } from '@/lib/order-lookup-view';
import { useOrderPoll } from '@/lib/use-order-poll';
import { CtaLink } from './cta-link';
import { SearchIcon } from './icons';
import { OrderStatusBadge, OrderTimeline } from './order-timeline';

/**
 * Guest order tracker (/tra-cuu-don, P1-o). A code + phone form → a live status timeline. The lookup
 * runs server-side via a Server Action (CORE_API_URL never reaches the client); the result auto-polls
 * while the order is still moving. Renders the full state set (idle · loading · found · not-found ·
 * rate-limited · error) — the storefront rule requires each screen carry empty/loading/error, not just
 * the happy path. Reads/polls ONLY: it never creates an order or transitions status (Phase-1/2 boundary).
 */
export function OrderLookup() {
  const t = useTranslations('lookup');

  const [code, setCode] = useState('');
  const [phone, setPhone] = useState('');
  const [formError, setFormError] = useState(false);
  // The submitted query; a fresh object identity (re)starts the shared poll loop. Null until the form is
  // submitted → the loop stays idle.
  const [query, setQuery] = useState<{ code: string; phone: string } | null>(null);
  // The poll loop is shared with the P2-g wait-screen (lib/use-order-poll); here the fetcher is the
  // phone lookup. `retry` re-runs it (the paused-refresh + error-state buttons).
  const { state, retry } = useOrderPoll(
    query ? () => lookupOrder(query.code, query.phone) : null,
    query,
  );

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const normalized = normalizeLookupInput(code, phone);
    if (!normalized) {
      setFormError(true);
      return;
    }
    setFormError(false);
    setQuery({ ...normalized });
  };

  return (
    <section className="mx-auto w-full max-w-[560px] px-4 py-6 md:px-6 md:py-10">
      <h1 className="font-display text-2xl font-bold text-text-strong md:text-3xl">
        {t('heading')}
      </h1>
      <p className="mt-1 text-sm text-text-muted">{t('intro')}</p>

      <form onSubmit={submit} noValidate className="mt-6 flex flex-col gap-4">
        <Input
          label={t('codeLabel')}
          placeholder={t('codePlaceholder')}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
        />
        <Input
          label={t('phoneLabel')}
          placeholder={t('phonePlaceholder')}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
        />
        {/* "Enter both" is a FORM-level message (either field can be the blank one) — a standalone
            role=alert, not an error bound to one Input, so a filled field is never marked aria-invalid
            and the empty one is never left unflagged (WCAG 3.3.1; conventions §A11y lỗi-gắn-với-field). */}
        {formError ? (
          <p role="alert" className="text-sm text-danger">
            {t('formError')}
          </p>
        ) : null}
        <Button type="submit" variant="pop" className="w-full">
          {t('submit')}
        </Button>
      </form>

      {/* Result region — announced politely so assistive tech reads status flips as the tracker polls. */}
      <div className="mt-8" aria-live="polite" aria-busy={state.kind === 'loading'}>
        {state.kind === 'loading' ? <Searching label={t('searching')} /> : null}

        {state.kind === 'found' ? (
          <div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-display text-lg font-bold text-text-strong">
                {t('resultHeading', { code: state.order.code })}
              </h2>
              <OrderStatusBadge status={state.order.status} />
            </div>

            <div className="mt-6">
              <OrderTimeline model={buildTimeline(state.order)} />
            </div>

            <div className="mt-6">
              {state.live ? (
                <p className="text-xs text-text-subtle">{t('live')}</p>
              ) : isPollableStatus(state.order.status) ? (
                <div className="flex flex-col items-start gap-2">
                  <p className="text-xs text-text-subtle">{t('paused')}</p>
                  <Button type="button" variant="outline" onClick={retry}>
                    {t('refresh')}
                  </Button>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {state.kind === 'not_found' ? (
          <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
            <span
              className="flex h-20 w-20 items-center justify-center rounded-full border-2 border-dashed border-border-default bg-surface-sunken text-text-subtle"
              aria-hidden="true"
            >
              <SearchIcon className="h-9 w-9" />
            </span>
            <h2 className="font-display text-lg font-bold text-text-strong">
              {t('notFoundTitle')}
            </h2>
            <p className="max-w-sm text-sm text-text-muted">{t('notFoundBody')}</p>
            <CtaLink href="/lien-he" variant="outline" className="mt-2">
              {t('contactCta')}
            </CtaLink>
          </div>
        ) : null}

        {state.kind === 'rate_limited' ? (
          <div role="alert" className="flex flex-col items-center gap-3 px-4 py-10 text-center">
            <h2 className="font-display text-lg font-bold text-text-strong">
              {t('rateLimitedTitle')}
            </h2>
            <p className="max-w-sm text-sm text-text-muted">{t('rateLimitedBody')}</p>
          </div>
        ) : null}

        {state.kind === 'error' ? (
          <div role="alert" className="flex flex-col items-center gap-3 px-4 py-10 text-center">
            <h2 className="font-display text-lg font-bold text-text-strong">{t('errorTitle')}</h2>
            <p className="max-w-sm text-sm text-text-muted">{t('errorBody')}</p>
            <Button type="button" onClick={retry}>
              {t('retry')}
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

/** Loading affordance while the first lookup is in flight. The spinner is stilled by reduced-motion;
 *  the text carries the meaning regardless. */
function Searching({ label }: { label: string }) {
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
