'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Input } from '@lumin/ui';
import { lookupOrder } from '@/lib/order-lookup';
import {
  buildTimeline,
  isPollableStatus,
  normalizeLookupInput,
  type TimelineData,
} from '@/lib/order-lookup-view';
import { CtaLink } from './cta-link';
import { SearchIcon } from './icons';
import { OrderStatusBadge, OrderTimeline } from './order-timeline';

// Auto-poll cadence (open-question #6, bounded by the P1-n per-code token bucket: 0.5 req/s sustained,
// burst 15 — a 15s interval is ~0.07 req/s, comfortably inside budget). Polling runs ONLY while the
// order is non-terminal, PAUSES while the tab is hidden (don't burn the budget on an unseen page),
// backs off exponentially on transient failure, and stops after a hard ceiling so a stuck order can't
// poll forever. prefers-reduced-motion only affects the spinner animation, not the polling itself.
const POLL_INTERVAL_MS = 15_000;
const MAX_POLL_MS = 10 * 60_000; // stop auto-updating after 10 minutes; offer a manual refresh
const MAX_BACKOFF_MS = 60_000;
const HIDDEN_RECHECK_MS = 3_000; // while hidden, re-check visibility this often (no network)

type ViewState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'found'; order: TimelineData; live: boolean }
  | { kind: 'not_found' }
  | { kind: 'rate_limited' }
  | { kind: 'error' };

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
  // The submitted query. A fresh object identity (re)starts the poll effect — resubmitting the same
  // code/phone (retry / manual refresh) still re-runs because we always allocate a new object.
  const [query, setQuery] = useState<{ code: string; phone: string } | null>(null);
  const [state, setState] = useState<ViewState>({ kind: 'idle' });

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

  useEffect(() => {
    if (!query) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const deadline = Date.now() + MAX_POLL_MS;
    let backoff = POLL_INTERVAL_MS;
    let shownOrder = false; // once an order has been rendered, transient failures keep it on screen

    const run = async () => {
      if (cancelled) return;
      // Pause polling while the tab is hidden — cheap visibility re-check, no request spent. Honor the
      // deadline even here: without this, the 3s re-check would reschedule past MAX_POLL_MS and leave a
      // stale "live" indicator showing on return (the ceiling is otherwise only checked on a fetch).
      if (typeof document !== 'undefined' && document.hidden) {
        if (Date.now() >= deadline) {
          setState((prev) =>
            prev.kind === 'found' ? { kind: 'found', order: prev.order, live: false } : prev,
          );
          return;
        }
        timer = setTimeout(run, HIDDEN_RECHECK_MS);
        return;
      }

      const res = await lookupOrder(query.code, query.phone);
      if (cancelled) return;

      if (res.ok) {
        shownOrder = true;
        backoff = POLL_INTERVAL_MS;
        const keepPolling = isPollableStatus(res.order.status) && Date.now() < deadline;
        setState({ kind: 'found', order: res.order, live: keepPolling });
        if (keepPolling) timer = setTimeout(run, POLL_INTERVAL_MS);
        return;
      }

      if (!shownOrder) {
        // First lookup failed — surface why. `not_found` is terminal (nothing to poll); `rate_limited`
        // / `error` are recoverable by resubmitting the form.
        setState(
          res.code === 'not_found'
            ? { kind: 'not_found' }
            : res.code === 'rate_limited'
              ? { kind: 'rate_limited' }
              : { kind: 'error' },
        );
        return;
      }

      // A transient failure DURING polling: keep the last order on screen, back off, keep trying until
      // the deadline. When we give up, the last render already carries live=false (deadline passed) or
      // flips to a paused state on the next successful poll.
      if (Date.now() < deadline) {
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
        timer = setTimeout(run, backoff);
      } else {
        setState((prev) =>
          prev.kind === 'found' ? { kind: 'found', order: prev.order, live: false } : prev,
        );
      }
    };

    setState({ kind: 'loading' });
    void run();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [query]);

  const retry = () => {
    if (query) setQuery({ ...query });
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
