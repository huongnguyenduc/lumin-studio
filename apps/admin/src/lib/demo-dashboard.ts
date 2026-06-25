import type { OrderStatus } from '@lumin/core';

// PLACEHOLDER dashboard data for the Phase-0 shell — these become Core API aggregates in Phase 1.
// Order `code` and customer `name` are DATA (not translatable UI chrome), so they live here rather
// than in the i18n catalog. `total` is int VND (conventions §Tiền) — formatted by formatVnd at
// render time, never baked into a string. `status` is a real OrderStatus → the OrderStatusBadge map.

export interface DemoStat {
  /** i18n key under `dashboard.*` for the card label. */
  labelKey: 'newOrdersToday' | 'revenueToday' | 'printing' | 'reviewsWaiting';
  /** Numeric value — count OR an int-VND amount (see `kind`). */
  value: number;
  /** `count` → formatVnNumber · `money` → formatVnd. */
  kind: 'count' | 'money';
  /** Highlight the card with a coral outline (the "needs attention" stat). */
  highlight?: boolean;
}

export const demoStats: DemoStat[] = [
  { labelKey: 'newOrdersToday', value: 5, kind: 'count' },
  { labelKey: 'revenueToday', value: 2_400_000, kind: 'money' },
  { labelKey: 'printing', value: 8, kind: 'count' },
  { labelKey: 'reviewsWaiting', value: 3, kind: 'count', highlight: true },
];

export interface DemoOrderRow {
  id: string;
  code: string;
  customer: string;
  total: number;
  status: OrderStatus;
}

export const demoRecentOrders: DemoOrderRow[] = [
  { id: 'lm2048', code: '#LM2048', customer: 'Nguyễn An', total: 445_000, status: 'PRINTING' },
  {
    id: 'lm2047',
    code: '#LM2047',
    customer: 'Trần Bình',
    total: 120_000,
    status: 'PENDING_CONFIRM',
  },
  { id: 'lm2046', code: '#LM2046', customer: 'Lê Cúc', total: 315_000, status: 'SHIPPING' },
  { id: 'lm2045', code: '#LM2045', customer: 'Phạm Dung', total: 180_000, status: 'COMPLETED' },
];

export interface DemoTodoItem {
  /** i18n key under `dashboard.*` for the action label. */
  labelKey: 'todoPendingConfirm' | 'todoReviews' | 'todoPaidWaitingPrint';
  count: number;
  href: string;
}

export const demoTodos: DemoTodoItem[] = [
  { labelKey: 'todoPendingConfirm', count: 2, href: '/don-hang' },
  { labelKey: 'todoReviews', count: 3, href: '/danh-gia' },
  { labelKey: 'todoPaidWaitingPrint', count: 1, href: '/hang-doi-in' },
];
