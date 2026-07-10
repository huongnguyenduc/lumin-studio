import { ORDER_STATUSES, canTransition, type OrderStatus, type Role } from '@lumin/core';

// Pure adapters for the admin order-detail page (P3-e): the 5-step progress track and the set of
// transitions offered on the action bar. No I/O — the branchy bits (how far an order progressed, which
// edges a role may take) are pinned by a Docker-free unit test (test/order-detail.test.ts). The
// server-side single-order fetch lives in ./orders-fetch; the transition/upload calls in ./order-actions.

// The 5 happy-path milestones (spec §04). The two close states (CANCELLED/REFUNDED) sit OFF this
// track — the view shows them as a separate terminal banner, not a step.
export const ORDER_MILESTONES = [
  'PENDING_CONFIRM',
  'PAID',
  'PRINTING',
  'SHIPPING',
  'COMPLETED',
] as const satisfies readonly OrderStatus[];

export type MilestoneState = 'done' | 'current' | 'todo';
export interface ProgressStep {
  status: OrderStatus;
  state: MilestoneState;
}

/**
 * How far along the milestone track an order got, read from its statusHistory `to` values (robust to
 * terminal orders that left the happy path — a CANCELLED-from-PAID order still shows PAID reached).
 * Returns the highest milestone index present, or -1 if none (never happens: every order is born at a
 * milestone).
 */
export function reachedMilestoneIndex(history: readonly { to: OrderStatus }[]): number {
  let max = -1;
  const milestones: readonly OrderStatus[] = ORDER_MILESTONES;
  for (const ev of history) {
    const i = milestones.indexOf(ev.to);
    if (i > max) max = i;
  }
  return max;
}

/**
 * The 5-step progress track for the given current status. A milestone before the furthest reached is
 * `done`; the furthest is `current` while the order still sits there (but `done` once it is COMPLETED or
 * has left to a close state); everything ahead is `todo`. For CANCELLED/REFUNDED the current status is
 * not a milestone, so the furthest reached shows `done` and the terminal banner carries the close state.
 */
export function progressSteps(
  status: OrderStatus,
  history: readonly { to: OrderStatus }[],
): ProgressStep[] {
  const reached = reachedMilestoneIndex(history);
  return ORDER_MILESTONES.map((milestone, i) => {
    if (i < reached) return { status: milestone, state: 'done' };
    if (i > reached) return { status: milestone, state: 'todo' };
    // i === reached (the furthest milestone the order touched).
    const stillHere = status === milestone;
    const isFinal = milestone === 'COMPLETED';
    return { status: milestone, state: stillHere && !isFinal ? 'current' : 'done' };
  });
}

// Each offered transition needs a distinct affordance: a 1-touch confirm (money-in →PAID), a plain
// advance (→PRINTING/COMPLETED), or a dialog that collects extra fields the server requires
// (→SHIPPING needs tracking+QC, →CANCELLED needs a reason, →REFUNDED needs a reason+proof).
export type TransitionKind = 'confirm' | 'advance' | 'ship' | 'cancel' | 'refund';
export interface AvailableTransition {
  to: OrderStatus;
  kind: TransitionKind;
}

/** The affordance an edge needs, keyed on its target status (mirrors the server's per-edge rules). */
export function transitionKind(to: OrderStatus): TransitionKind {
  switch (to) {
    case 'PAID':
      return 'confirm'; // reachable only from PENDING_CONFIRM (money-in, owner-only)
    case 'SHIPPING':
      return 'ship'; // trackingCode + QC photo required
    case 'CANCELLED':
      return 'cancel'; // reason required
    case 'REFUNDED':
      return 'refund'; // reason + refundProofUrl required
    default:
      return 'advance'; // PRINTING, COMPLETED — plain 1-touch
  }
}

/**
 * The transitions to offer from `from` for `role`, derived from the shared state machine
 * (canTransition over every OrderStatus) so the UI can never offer an edge the server would reject —
 * the button set is the single source of truth's projection, not a hand-kept list.
 */
export function availableTransitions(from: OrderStatus, role: Role): AvailableTransition[] {
  return ORDER_STATUSES.filter((to) => canTransition(from, to, role)).map((to) => ({
    to,
    kind: transitionKind(to),
  }));
}
