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

/**
 * Format an ISO-8601 UTC instant as a vi-VN date + 24-hour time, e.g. `25/06/2026 · 09:20`.
 * Like formatVnDate, the timezone is PINNED to Asia/Ho_Chi_Minh so a stored UTC instant renders the
 * same wall-clock everywhere (server/SSR/client/CI) — the order-tracking timeline (P1-o) stamps each
 * milestone with this. Date and time are formatted separately and joined with a middot so the layout
 * is locale-stable (a single combined `Intl` call would interleave a comma the vi-VN locale inserts).
 */
export function formatVnDateTime(iso: string): string {
  const at = new Date(iso);
  const date = new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(at);
  const time = new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(at);
  return `${date} · ${time}`;
}

/** Format an integer count with vi-VN grouping, e.g. `1.234`. */
export function formatVnNumber(n: number): string {
  return new Intl.NumberFormat('vi-VN').format(n);
}

/**
 * Format a star-rating AVERAGE (0–5) for display, e.g. `4,9`. Unlike formatVnNumber (integer counts),
 * a rating is a fraction and must be capped at ONE decimal: `ratingAvg` is a raw `AVG()` on the wire
 * (`format: float`, not rounded server-side), so an average like 4.6667 must render `4,7`, never the
 * default-3-decimal `4,667`. A whole number drops the decimal (`5`, not `5,0`) via maximumFractionDigits.
 * vi-VN uses a comma as the decimal separator. The one place rating precision is decided — surfaces call
 * this instead of `.toFixed`/Intl inline (conventions §Tiền: number formatting lives only in core).
 */
export function formatVnRating(n: number): string {
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 }).format(n);
}
