'use client';

import { useEffect, useRef, useState } from 'react';
import { isPollableStatus, type LookupResult, type TimelineData } from './order-lookup-view';

// Auto-poll cadence (P2-g open-Q1 → kept at the P1-o value, no Phase-2 override: bounded by the per-code
// token bucket, 0.5 req/s sustained / burst 15 — a 15s interval is ~0.07 req/s, comfortably inside
// budget). Polling runs ONLY while the order is non-terminal, PAUSES while the tab is hidden (don't burn
// the budget on an unseen page), backs off exponentially on transient failure, and stops after a hard
// ceiling so a stuck order can't poll forever. prefers-reduced-motion only affects the spinner the
// consumers render, not the polling itself.
const POLL_INTERVAL_MS = 15_000;
const MAX_POLL_MS = 10 * 60_000; // stop auto-updating after 10 minutes; consumers offer a manual refresh
const MAX_BACKOFF_MS = 60_000;
const HIDDEN_RECHECK_MS = 3_000; // while hidden, re-check visibility this often (no network)

export type PollState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'found'; order: TimelineData; live: boolean }
  | { kind: 'not_found' }
  | { kind: 'rate_limited' }
  | { kind: 'error' };

/**
 * The shared order-status poll loop behind BOTH the guest tracker (/tra-cuu-don, P1-o — a code+phone
 * form polling GET /orders/lookup) and the post-checkout wait-screen (P2-g — a token polling
 * GET /orders/track). The ONLY difference between the two is the `fetcher`; the cadence, terminal-stop,
 * visibility-pause, back-off and 10-minute ceiling are identical and subtle, so they live here once
 * instead of being copied (plan §5 "reuse P1-o verbatim").
 *
 * `fetcher` null → idle (nothing to poll yet — the tracker before its form is submitted). A non-null
 * fetcher starts the loop; the LATEST fetcher is always read (via a ref) so a re-render with fresh args
 * doesn't restart it. `restartKey` (re)starts on demand — a new value re-runs from a fresh lookup (the
 * tracker feeds the submitted query object; the wait-screen a stable code). `retry()` re-runs too
 * (manual refresh / error retry).
 */
export function useOrderPoll(
  fetcher: (() => Promise<LookupResult>) | null,
  restartKey: unknown,
): { state: PollState; retry: () => void } {
  // Seed `loading` when a fetcher is present at first render so a poll-only screen (the P2-g wait-screen,
  // which has no server-rendered form) paints a loading affordance server-side instead of a blank frame
  // until hydration; the tracker (fetcher null until its form is submitted) seeds `idle`. Same value on
  // SSR and the hydration render → no mismatch; the effect then drives it.
  const [state, setState] = useState<PollState>(fetcher ? { kind: 'loading' } : { kind: 'idle' });
  const [retryNonce, setRetryNonce] = useState(0);
  // The fetcher closes over changing args (code/phone/token) and is re-created each render; read it from
  // a ref so its identity churn doesn't restart the loop — only `active`/`restartKey`/`retryNonce` do.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const active = fetcher !== null;

  useEffect(() => {
    if (!active) {
      setState({ kind: 'idle' });
      return;
    }

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

      const res = await fetcherRef.current!();
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
        // First fetch failed — surface why. `not_found` is terminal (nothing to poll); `rate_limited`
        // / `error` are recoverable by retrying.
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
  }, [active, restartKey, retryNonce]);

  return { state, retry: () => setRetryNonce((n) => n + 1) };
}
