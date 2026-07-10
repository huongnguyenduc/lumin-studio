import type { components } from '@lumin/api-client';
import { ORDER_STATUSES, type Channel, type OrderStatus } from '@lumin/core';

// Maps the core-api admin orders list (GET /admin/orders, P3-b) onto the row shape the orders table
// consumes, plus the pure URL/pagination helpers the filter + pager share. Pure functions only (no
// I/O) so the wire→prop wiring and the href/paging math are pinned by a Docker-free unit test. The
// server-side fetch lives in ./orders-fetch (it imports next/headers and is not importable here).

type AdminOrderList = components['schemas']['AdminOrderList'];

export interface AdminOrderRow {
  id: string;
  code: string;
  /** Display name from the wire `customerName` (data, not translatable chrome). */
  customer: string;
  /** "sản phẩm" column: first item name + "+N" for the remaining lines (e.g. "Đèn Mochi +1"). */
  productLabel: string;
  /** enum — rendered to an i18n label by the table (always-must #3). */
  channel: Channel;
  /** enum — rendered by OrderStatusBadge. */
  status: OrderStatus;
  /** int VND — formatted by formatVnd at render, never baked into a string. */
  total: number;
  /** ISO-8601 UTC — formatted by formatVnDate at render. */
  createdAt: string;
}

const ORDER_STATUS_SET: ReadonlySet<string> = new Set(ORDER_STATUSES);

/**
 * Narrow a raw `?status=` query value to an OrderStatus, or `undefined` ("Tất cả"). Anything not one
 * of the 7 known statuses (a stale link, a typo, junk) is treated as "no filter" rather than passed
 * through to the endpoint (which would 400) — a bad URL should show all orders, not an error page.
 */
export function parseStatusFilter(raw: string | undefined): OrderStatus | undefined {
  return raw && ORDER_STATUS_SET.has(raw) ? (raw as OrderStatus) : undefined;
}

/** The "sản phẩm" column value: first item name, plus "+N" for the other lines (design: "Đèn Mochi +1").
 *  `firstItemName` is always non-empty (every order has ≥1 item — P3-b), so this never renders a bare "+N". */
export function productLabel(firstItemName: string, itemCount: number): string {
  return itemCount > 1 ? `${firstItemName} +${itemCount - 1}` : firstItemName;
}

/** Wire summary page → table rows. Renames `customerName`→`customer`, folds first-item + count into
 *  `productLabel`; channel/status stay enums (the OrderStatus/Channel wire strings are byte-parity
 *  tested across OpenAPI/Go/Zod, so the casts are sound). A nil/empty page yields `[]`. */
export function toOrderRows(list: AdminOrderList): AdminOrderRow[] {
  return list.items.map((o) => ({
    id: o.id,
    code: o.code,
    customer: o.customerName,
    productLabel: productLabel(o.firstItemName, o.itemCount),
    channel: o.channel as Channel,
    status: o.status as OrderStatus,
    total: o.total,
    createdAt: o.createdAt,
  }));
}

/** Number of pages for `total` rows at `pageSize`, floored at 1 (an empty list is still one page). */
export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

/** Build a `/don-hang` href preserving the active filter. Defaults are omitted (page 1, no status)
 *  so the canonical URL stays clean and page-1 of any filter has a single address. */
export function buildOrdersHref(params: { status?: OrderStatus; page?: number }): string {
  const q = new URLSearchParams();
  if (params.status) q.set('status', params.status);
  if (params.page && params.page > 1) q.set('page', String(params.page));
  const s = q.toString();
  return s ? `/don-hang?${s}` : '/don-hang';
}
