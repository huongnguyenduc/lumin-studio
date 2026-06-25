// Locale-aware date/number helpers (vi-VN). Like money.ts, this lives inside packages/core — the
// only place Intl usage is sanctioned. Surfaces call these instead of inlining Intl/toLocaleString.

/** Format an ISO-8601 UTC instant as a vi-VN date, e.g. `25/06/2026`. */
export function formatVnDate(iso: string): string {
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(iso));
}

/** Format an integer count with vi-VN grouping, e.g. `1.234`. */
export function formatVnNumber(n: number): string {
  return new Intl.NumberFormat('vi-VN').format(n);
}
