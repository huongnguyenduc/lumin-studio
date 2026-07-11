'use client';

import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { mergeCard, type PrintCard } from './print-queue';
import { refetchPrintQueue } from './print-queue-actions';

// Same-origin proxy path (app/api/print-stream/route.ts) — a relative URL so the httpOnly cookie rides
// along and no core-api URL is exposed to the client bundle.
const STREAM_URL = '/api/print-stream';
const POLL_INTERVAL_MS = 15_000;

/**
 * Keep the print board live (P3-h). PRIMARY channel = the SSE stream; each `stage` frame patches one
 * card in place. `live` tracks the connection. FALLBACK = poll GET /admin/print-queue every
 * POLL_INTERVAL_MS, but ONLY while the stream is down — so a healthy board never polls, and if the
 * home-box tunnel buffers SSE (BLOCKER-B / plan open-q #4) the board degrades to effectively poll-only.
 * The poll pauses while the tab is hidden. Returns the live cards, a setter the board uses for
 * optimistic drag updates, and the connection flag (for the live/reconnecting hint).
 */
export function usePrintStream(initial: PrintCard[]): {
  cards: PrintCard[];
  setCards: Dispatch<SetStateAction<PrintCard[]>>;
  live: boolean;
} {
  const [cards, setCards] = useState<PrintCard[]>(initial);
  const [live, setLive] = useState(false);

  // SSE subscription — opened once on mount. Native EventSource auto-reconnects after a dropped
  // connection, so a brief blip flips live false→true again without us managing retries; a persistent
  // failure just leaves live=false and the poll effect below takes over.
  useEffect(() => {
    const es = new EventSource(STREAM_URL);
    es.onopen = () => setLive(true);
    es.addEventListener('stage', (e) => {
      try {
        const card = JSON.parse((e as MessageEvent).data) as PrintCard;
        setCards((cs) => mergeCard(cs, card));
      } catch {
        // Ignore a malformed frame — the next poll / navigation GET reconciles the board.
      }
    });
    es.onerror = () => setLive(false);
    return () => es.close();
  }, []);

  // Fallback poll — runs only while the stream is NOT live (effect re-runs when `live` flips, clearing
  // the interval the moment SSE reconnects). A whole-board re-read also picks up newly-created jobs,
  // which SSE never emits. Visibility-paused so a hidden tab spends no requests.
  useEffect(() => {
    if (live) return;
    let cancelled = false;
    const tick = async () => {
      if (cancelled || (typeof document !== 'undefined' && document.hidden)) return;
      const fresh = await refetchPrintQueue();
      if (!cancelled && fresh) setCards(fresh);
    };
    const timer = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [live]);

  return { cards, setCards, live };
}
