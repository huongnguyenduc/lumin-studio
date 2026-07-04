import { TERMINAL_STATUSES, type OrderStatus } from '@lumin/core';

// Pure, client-safe view logic for the guest order tracker (/tra-cuu-don, P1-o). No 'server-only' and
// no network here — the Server Action (lib/order-lookup.ts) fetches, this shapes the render model, and
// the timeline component draws it. Everything below is unit-tested (test/order-lookup-view.test.ts).

/**
 * The guest-facing timeline payload — mirrors the backend `PublicOrderTimeline` (code, current status,
 * reached milestones oldest-first, optional carrier code, created instant). Owned by the storefront so
 * the client never depends on the generated API types; the Server Action maps the wire DTO into this.
 * Deliberately carries NO money/PII (the contract omits it — ADR-032).
 */
export interface TimelineData {
  code: string;
  status: OrderStatus;
  milestones: { status: OrderStatus; at: string }[];
  trackingCode?: string;
  createdAt: string;
}

/**
 * Result of the lookup Server Action — a small closed union. The `not_found`/`rate_limited`/`error`
 * arms carry NO backend prose or messageKey (always-must #3): the screen owns the copy for each. A
 * uniform 404 (unknown code OR phone mismatch) collapses to `not_found` with no enumeration signal.
 */
export type LookupResult =
  | { ok: true; order: TimelineData }
  | { ok: false; code: 'not_found' | 'rate_limited' | 'error' };

/**
 * The 5 happy-path progress milestones, in order (spec §04). CANCELLED/REFUNDED are close states — they
 * leave this track and render as a separate banner, never as a 6th/7th step.
 */
export const PROGRESS_STATUSES: readonly OrderStatus[] = [
  'PENDING_CONFIRM',
  'PAID',
  'PRINTING',
  'SHIPPING',
  'COMPLETED',
];

export type StepState = 'done' | 'current' | 'upcoming';

export interface TimelineStep {
  status: OrderStatus;
  state: StepState;
  /** ISO instant the step was reached, or null if not yet reached (upcoming). */
  at: string | null;
}

export interface TimelineModel {
  steps: TimelineStep[];
  /** Present only when the order left the happy path — the close banner (spec §04). */
  closeState: { status: 'CANCELLED' | 'REFUNDED'; at: string | null } | null;
  /** Carrier waybill — surfaces from SHIPPING onward (contract); null before then / if blank. */
  trackingCode: string | null;
}

const CLOSE_STATUSES = new Set<OrderStatus>(['CANCELLED', 'REFUNDED']);

/**
 * Build the render model for the vertical stepper from a timeline payload. On the happy path the
 * frontier is the current status (earlier steps done, this one current, later ones upcoming). Once the
 * order is closed (CANCELLED/REFUNDED) there is no "current" step — the track freezes at whatever
 * progress was actually reached (from the milestones), and the close state renders apart. Pure.
 */
export function buildTimeline(data: TimelineData): TimelineModel {
  const reachedAt = new Map<OrderStatus, string>();
  for (const m of data.milestones) reachedAt.set(m.status, m.at);

  const isClosed = CLOSE_STATUSES.has(data.status);
  const currentIndex = isClosed ? -1 : PROGRESS_STATUSES.indexOf(data.status);

  const steps: TimelineStep[] = PROGRESS_STATUSES.map((status, i) => {
    const at = reachedAt.get(status) ?? null;
    let state: StepState;
    if (isClosed) {
      // A closed order shows only what it actually reached — never a fake "current".
      state = at !== null ? 'done' : 'upcoming';
    } else if (i < currentIndex) {
      // Past the frontier → done, even if this exact milestone has no timestamp. An inbox order is born
      // at PAID (spec §04, skipping PENDING_CONFIRM), so PENDING_CONFIRM renders done-without-a-time —
      // honest (the order IS past it), not a fake event. `at` stays null so no invented timestamp shows.
      state = 'done';
    } else if (i === currentIndex) {
      state = 'current';
    } else {
      state = 'upcoming';
    }
    return { status, state, at };
  });

  const closeState =
    data.status === 'CANCELLED' || data.status === 'REFUNDED'
      ? { status: data.status, at: reachedAt.get(data.status) ?? null }
      : null;

  const trackingCode = data.trackingCode?.trim() ? data.trackingCode.trim() : null;

  return { steps, closeState, trackingCode };
}

/** Should the tracker keep polling? Only while the order is NOT terminal (spec §04) — a delivered,
 *  cancelled, or refunded order will never change again, so polling stops (saves the rate budget). */
export function isPollableStatus(status: OrderStatus): boolean {
  return !TERMINAL_STATUSES.has(status);
}

/**
 * Trim + normalize the lookup form inputs. Returns null when either field is blank (nothing to look
 * up → skip the round-trip and the rate budget). The order code is upper-cased to match the server's
 * case-folding (lookup.go normalizes code to upper); the phone is passed through verbatim (the server
 * extracts the national significant number, so spacing/`+84`/leading-0 all resolve there).
 */
export function normalizeLookupInput(
  codeRaw: string,
  phoneRaw: string,
): { code: string; phone: string } | null {
  const code = codeRaw.trim().toUpperCase();
  const phone = phoneRaw.trim();
  if (!code || !phone) return null;
  return { code, phone };
}
