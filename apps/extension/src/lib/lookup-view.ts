import { ORDER_STATUSES, canTransition, type OrderStatus, type Role } from '@lumin/core';

// Pure order-lookup logic — code parsing, the milestone progress projection, and which transitions the
// panel offers. No I/O (that lives in ./lookup). Unit-tested. Mirrors the admin's order-detail adapters
// (apps/admin/src/lib/order-detail.ts), but the extension's action set is its OWN: it inlines only the
// transitions that need no file upload. Ship (QC photo) and refund (refund proof) are deferred to Admin.

// parseOrderCode pulls a human order code out of whatever staff paste — the bare code, a code sitting inside
// a chat line, with or without the leading "#", any case, spaces or a dash between LMN and the digits — and
// canonicalizes it to the stored form "#LMN-0042" (zero-padded to 4, matching the server's fmt "%04d").
// Returns null when no LMN-digits pattern is present (the input shows an "invalid code" hint). A pet-tag code
// ("#LMN-T0001") has a letter between LMN and the digits, so it correctly does NOT parse as an order code.
const CODE_RE = /LMN\s*-?\s*(\d+)/i;
export function parseOrderCode(input: string): string | null {
  const m = input.match(CODE_RE);
  if (!m) return null;
  const digits = m[1].replace(/^0+/, '') || '0';
  return `#LMN-${digits.padStart(4, '0')}`;
}

// The 5 happy-path milestones (spec §04). CANCELLED/REFUNDED sit OFF this track — the card shows them as a
// terminal banner, not a step. Ported from the admin adapter so the panel's progress reads identically.
export const ORDER_MILESTONES: readonly OrderStatus[] = [
  'PENDING_CONFIRM',
  'PAID',
  'PRINTING',
  'SHIPPING',
  'COMPLETED',
];

export type MilestoneState = 'done' | 'current' | 'todo';
export interface ProgressStep {
  status: OrderStatus;
  state: MilestoneState;
}

// The furthest milestone an order touched, read from its statusHistory `to` values (robust to a terminal
// order that left the happy path — a CANCELLED-from-PAID order still shows PAID reached). -1 if none.
export function reachedMilestoneIndex(history: readonly { to: OrderStatus }[]): number {
  let max = -1;
  for (const ev of history) {
    const i = ORDER_MILESTONES.indexOf(ev.to);
    if (i > max) max = i;
  }
  return max;
}

// The 5-step track for the current status: a milestone before the furthest reached is `done`; the furthest is
// `current` while the order still sits there (but `done` once COMPLETED or left to a close state); everything
// ahead is `todo`. For CANCELLED/REFUNDED the current status is not a milestone, so the furthest shows `done`
// and the card's terminal banner carries the close state.
export function progressSteps(
  status: OrderStatus,
  history: readonly { to: OrderStatus }[],
): ProgressStep[] {
  const reached = reachedMilestoneIndex(history);
  return ORDER_MILESTONES.map((milestone, i) => {
    if (i < reached) return { status: milestone, state: 'done' };
    if (i > reached) return { status: milestone, state: 'todo' };
    const stillHere = status === milestone;
    const isFinal = milestone === 'COMPLETED';
    return { status: milestone, state: stillHere && !isFinal ? 'current' : 'done' };
  });
}

// The panel's transition affordances. 'direct' is 1-touch (→PAID/PRINTING/COMPLETED — no extra input the
// extension collects); 'cancel' opens a reason picker (→CANCELLED); 'defer' (→SHIPPING needs a QC photo,
// →REFUNDED needs a refund proof) is shown but routed to Admin — the extension does not upload files (those
// compliance artifacts are captured at the packing station / bank, in the full Admin tool). ponytail: add a
// presign+Garage upload here if staff ever need to ship from the panel; today it is a deliberate scope cut.
export type ActionKind = 'direct' | 'cancel' | 'defer';
export interface OrderAction {
  to: OrderStatus;
  kind: ActionKind;
}

function actionKind(to: OrderStatus): ActionKind {
  switch (to) {
    case 'CANCELLED':
      return 'cancel';
    case 'SHIPPING':
    case 'REFUNDED':
      return 'defer';
    default:
      return 'direct'; // PAID, PRINTING, COMPLETED
  }
}

// nextActions projects the shared state machine (canTransition over every status, for the actor's role) into
// the panel's action list — so the UI can never offer an edge the server would reject, and a staff actor
// never sees the owner-only →PAID/→REFUNDED edges. The button set is the state machine's projection, not a
// hand-kept list; it stays correct if the state machine changes.
export function nextActions(status: OrderStatus, role: Role): OrderAction[] {
  return ORDER_STATUSES.filter((to) => canTransition(status, to, role)).map((to) => ({
    to,
    kind: actionKind(to),
  }));
}
