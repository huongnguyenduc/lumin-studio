import type { components } from '@lumin/api-client';
import type { OrderStatus } from '@lumin/core';

// Maps the core-api dashboard snapshot (GET /admin/dashboard, PR-3i) onto the shapes the
// dashboard components consume. Pure functions only (no I/O) so the row→prop wiring — which count
// lands in which card/todo — is pinned by a Docker-free unit test, the TS mirror of the Go
// `buildDashboardSnapshot` test. The server-side fetch lives in ./dashboard-fetch (it imports
// next/headers and is not importable from a plain test/runtime).

type DashboardSnapshot = components['schemas']['DashboardSnapshot'];

// --- Component prop shapes --------------------------------------------------------------------

export interface StatCard {
  /** i18n key under `dashboard.*` for the card label. */
  labelKey: 'newOrdersToday' | 'revenueToday' | 'printing' | 'reviewsWaiting';
  /** Numeric value — a count OR an int-VND amount (see `kind`). */
  value: number;
  /** `count` → formatVnNumber · `money` → formatVnd (conventions §Tiền). */
  kind: 'count' | 'money';
  /** Highlight the card with a coral outline (the "needs attention" stat). */
  highlight?: boolean;
}

export interface RecentOrderRow {
  id: string;
  code: string;
  /** Display name from the wire `customerName` (data, not translatable chrome). */
  customer: string;
  /** int VND — formatted by formatVnd at render, never baked into a string. */
  total: number;
  status: OrderStatus;
}

export interface TodoItem {
  /** i18n key under `dashboard.*` for the action label. */
  labelKey: 'todoPendingConfirm' | 'todoReviews' | 'todoPaidWaitingPrint';
  count: number;
  href: string;
}

// --- Pure adapters: wire DTO → component props ------------------------------------------------

/** The four KPI cards. `reviewsWaiting` is the "needs attention" card — highlighted only when
 *  something is actually waiting, so a clean queue renders no false alarm. */
export function toStatCards(stats: DashboardSnapshot['stats']): StatCard[] {
  return [
    { labelKey: 'newOrdersToday', value: stats.newOrdersToday, kind: 'count' },
    { labelKey: 'revenueToday', value: stats.revenueToday, kind: 'money' },
    { labelKey: 'printing', value: stats.printing, kind: 'count' },
    {
      labelKey: 'reviewsWaiting',
      value: stats.reviewsWaiting,
      kind: 'count',
      highlight: stats.reviewsWaiting > 0,
    },
  ];
}

/** Recent-orders strip. Renames the wire `customerName` to `customer`; `createdAt` is on the wire
 *  but unused by the strip. A nil/empty list yields `[]` → the component's empty-state branch. */
export function toRecentOrders(rows: DashboardSnapshot['recentOrders']): RecentOrderRow[] {
  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    customer: row.customerName,
    total: row.total,
    // The OrderStatus enum is byte-parity-tested across OpenAPI/Go/Zod/PG (PR-3c-1), so the wire
    // string is a valid core OrderStatus.
    status: row.status as OrderStatus,
  }));
}

/** The "Cần xử lý" action list. The endpoint returns two todo counts; the middle "reviews" row
 *  reuses `stats.reviewsWaiting` (the same number that feeds the highlighted stat card) so the
 *  design's three-item list stays intact without a redundant endpoint field. hrefs are route
 *  constants (chrome), not data. */
export function toTodos(snapshot: DashboardSnapshot): TodoItem[] {
  return [
    { labelKey: 'todoPendingConfirm', count: snapshot.todos.pendingConfirm, href: '/don-hang' },
    { labelKey: 'todoReviews', count: snapshot.stats.reviewsWaiting, href: '/danh-gia' },
    {
      labelKey: 'todoPaidWaitingPrint',
      count: snapshot.todos.paidWaitingPrint,
      href: '/hang-doi-in',
    },
  ];
}
