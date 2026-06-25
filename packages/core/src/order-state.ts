// OrderStatus state machine + transition guard + RBAC + statusHistory.
// Source of truth: spec.md §04 · conventions.md §statusHistory · ADR-010. SERVER is authoritative;
// clients never self-transition.
//
// MUTATION-GATE ANCHORS (load-bearing for tests/harness/osm-mutation.test.sh): the single-line
//   ALLOWED_EDGES string plus the hash-prefixed end-of-line markers EDGES / GUARDMATCH / GUARDCALL /
//   REASON / HISTORY, each on its own code line below. Do NOT split those lines across multiple
//   lines, rename the markers, or repeat the hash-prefixed form anywhere else — the kill-gate
//   sed-targets the hash-prefixed comment and must match ONLY the code line, not this header.

export type OrderStatus =
  | 'PENDING_CONFIRM'
  | 'PAID'
  | 'PRINTING'
  | 'SHIPPING'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'REFUNDED';

export type Role = 'owner' | 'staff' | 'system';
export type Channel = 'web' | 'inbox';

export const ORDER_STATUSES: readonly OrderStatus[] = [
  'PENDING_CONFIRM',
  'PAID',
  'PRINTING',
  'SHIPPING',
  'COMPLETED',
  'CANCELLED',
  'REFUNDED',
];

// Terminal — no outgoing edge (spec §04).
export const TERMINAL_STATUSES: ReadonlySet<OrderStatus> = new Set<OrderStatus>([
  'COMPLETED',
  'CANCELLED',
  'REFUNDED',
]);

// prettier-ignore
const ALLOWED_EDGES = 'PENDING_CONFIRM>PAID PENDING_CONFIRM>CANCELLED PAID>PRINTING PAID>CANCELLED PAID>REFUNDED PRINTING>SHIPPING PRINTING>CANCELLED PRINTING>REFUNDED SHIPPING>COMPLETED SHIPPING>CANCELLED SHIPPING>REFUNDED'; // #EDGES

// Owner-only edges — money in (reconcile → PAID) and money out (→ REFUNDED). ADR-010.
const OWNER_ONLY_EDGES: ReadonlySet<string> = new Set<string>([
  'PENDING_CONFIRM>PAID',
  'PAID>REFUNDED',
  'PRINTING>REFUNDED',
  'SHIPPING>REFUNDED',
]);

// Destinations that require a non-empty reason (REFUNDED additionally needs refundProofUrl).
const REASON_REQUIRED: ReadonlySet<OrderStatus> = new Set<OrderStatus>(['CANCELLED', 'REFUNDED']);

export interface StatusEvent {
  from: OrderStatus | null;
  to: OrderStatus;
  at: string; // ISO-8601 UTC
  byUser: string;
  reason?: string;
  refundProofUrl?: string;
}

export interface OrderLike {
  status: OrderStatus;
  statusHistory: StatusEvent[];
}

export interface TransitionContext {
  role: Role;
  byUser: string;
  at: string; // ISO-8601 UTC
  reason?: string;
  refundProofUrl?: string;
}

export type TransitionErrorCode =
  | 'INVALID_EDGE'
  | 'RBAC'
  | 'REASON_REQUIRED'
  | 'REFUND_PROOF_REQUIRED'
  | 'PROOF_REQUIRED'
  | 'INVALID_ACTOR'
  | 'INVALID_TIMESTAMP';

export class TransitionError extends Error {
  constructor(
    public readonly code: TransitionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'TransitionError';
  }
}

/**
 * ISO-8601 UTC instant — must carry an explicit `Z` and parse. conventions §Tiền (store UTC).
 * Z-only on purpose: this mirrors StatusEventSchema.at (`z.string().datetime()`, whose default also
 * rejects numeric offsets), so the guard and the schema accept exactly the same set of timestamps.
 */
function isIsoUtc(s: unknown): boolean {
  if (typeof s !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(s)) return false;
  return !Number.isNaN(Date.parse(s));
}

/** Non-empty http/https URL (mirrors StatusEventSchema.refundProofUrl.url() at the guard layer). */
function isHttpUrl(s: unknown): boolean {
  if (typeof s !== 'string' || !s.trim()) return false;
  try {
    const u = new URL(s.trim());
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Is `from → to` a structurally valid edge (ignores role/reason)? */
export function isAllowedEdge(from: OrderStatus, to: OrderStatus): boolean {
  return ALLOWED_EDGES.split(' ').includes(`${from}>${to}`); // #GUARDMATCH
}

export function isOwnerOnly(from: OrderStatus, to: OrderStatus): boolean {
  return OWNER_ONLY_EDGES.has(`${from}>${to}`);
}

/** RBAC for an edge. Owner-only edges need `owner`; `system` may only confirm delivery. */
export function roleAllowed(from: OrderStatus, to: OrderStatus, role: Role): boolean {
  if (isOwnerOnly(from, to)) return role === 'owner';
  if (role === 'owner' || role === 'staff') return true;
  return role === 'system' && to === 'COMPLETED';
}

export function canTransition(from: OrderStatus, to: OrderStatus, role: Role): boolean {
  return isAllowedEdge(from, to) && roleAllowed(from, to, role);
}

/** Entry point per channel (spec §04): web→PENDING_CONFIRM (needs proof), inbox→PAID. */
export function initialStatusForChannel(
  channel: Channel,
  opts: { hasPaymentProof: boolean },
): OrderStatus {
  if (channel === 'web') {
    if (!opts.hasPaymentProof) {
      throw new TransitionError(
        'PROOF_REQUIRED',
        'Đơn web chỉ tạo sau khi khách đính ảnh biên lai chuyển khoản.',
      );
    }
    return 'PENDING_CONFIRM';
  }
  return 'PAID';
}

/**
 * Apply a transition. Validates edge + RBAC + reason rules, then appends exactly one statusHistory
 * record. Returns a new order object (does not mutate the input). Throws TransitionError on any
 * violation.
 */
export function transition<T extends OrderLike>(
  order: T,
  to: OrderStatus,
  ctx: TransitionContext,
): T {
  const from = order.status;
  // prettier-ignore
  if (!isAllowedEdge(from, to)) throw new TransitionError('INVALID_EDGE', `Không thể chuyển ${from} → ${to}.`); // #GUARDCALL
  if (!roleAllowed(from, to, ctx.role)) {
    throw new TransitionError(
      'RBAC',
      `Vai trò ${ctx.role} không được phép chuyển ${from} → ${to}.`,
    );
  }
  if (!ctx.byUser?.trim()) {
    throw new TransitionError(
      'INVALID_ACTOR',
      'statusHistory cần byUser (người thực hiện) không rỗng.',
    );
  }
  if (!isIsoUtc(ctx.at)) {
    throw new TransitionError(
      'INVALID_TIMESTAMP',
      'statusHistory.at phải là ISO-8601 UTC (vd 2026-06-25T00:00:00.000Z).',
    );
  }
  // prettier-ignore
  if (REASON_REQUIRED.has(to) && !ctx.reason?.trim()) throw new TransitionError('REASON_REQUIRED', `Chuyển sang ${to} cần lý do.`); // #REASON
  if (to === 'REFUNDED' && !isHttpUrl(ctx.refundProofUrl)) {
    throw new TransitionError(
      'REFUND_PROOF_REQUIRED',
      'REFUNDED cần refundProofUrl hợp lệ (ảnh chuyển hoàn, http/https).',
    );
  }
  const event: StatusEvent = {
    from,
    to,
    at: ctx.at,
    byUser: ctx.byUser,
    ...(ctx.reason?.trim() ? { reason: ctx.reason.trim() } : {}),
    ...(ctx.refundProofUrl?.trim() ? { refundProofUrl: ctx.refundProofUrl.trim() } : {}),
  };
  const statusHistory = [...order.statusHistory, event]; // #HISTORY
  return { ...order, status: to, statusHistory } as T;
}

/** Replay a statusHistory chain back to a status, asserting every hop is a valid edge. */
export function replayStatus(history: readonly StatusEvent[]): OrderStatus {
  if (history.length === 0) throw new TransitionError('INVALID_EDGE', 'statusHistory rỗng.');
  let prev: StatusEvent | null = null;
  for (const ev of history) {
    if (prev && ev.from !== prev.to) {
      throw new TransitionError('INVALID_EDGE', `statusHistory đứt đoạn tại ${ev.from ?? 'null'}.`);
    }
    if (ev.from !== null && !isAllowedEdge(ev.from, ev.to)) {
      throw new TransitionError(
        'INVALID_EDGE',
        `Cạnh không hợp lệ trong lịch sử: ${ev.from} → ${ev.to}.`,
      );
    }
    prev = ev;
  }
  return history[history.length - 1].to;
}
