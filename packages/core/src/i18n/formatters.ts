// Locale-aware date/number helpers (vi-VN). Like money.ts, this lives inside packages/core — the
// only place Intl usage is sanctioned. Surfaces call these instead of inlining Intl/toLocaleString.

/**
 * Format an ISO-8601 UTC instant as a vi-VN date, e.g. `25/06/2026`.
 * The timezone is PINNED to Asia/Ho_Chi_Minh — without it, Intl uses the process's ambient TZ, so a
 * UTC instant in the 17:00–23:59Z window would render the next/previous calendar day depending on
 * where the code runs (server vs SSR edge vs client vs CI). Stored instants are UTC (conventions
 * §Tiền); we render them deterministically in the shop's zone.
 */
export function formatVnDate(iso: string): string {
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(iso));
}

/** Format an integer count with vi-VN grouping, e.g. `1.234`. */
export function formatVnNumber(n: number): string {
  return new Intl.NumberFormat('vi-VN').format(n);
}
