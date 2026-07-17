// Relative time for the wishes wall (HANDOFF §2.8): <1h "vừa xong", <24h giờ,
// <7d ngày, else d.m.yyyy. Pure so it's testable; strings live here (not the
// i18n catalog) deliberately — they interpolate numbers and this exact format
// is a locked design decision, vi-only like the rest of the site.
const HOUR = 3600_000;
const DAY = 24 * HOUR;

export function timeAgo(iso: string, now = Date.now()): string {
  const t = new Date(iso).getTime();
  const d = now - t;
  if (d < HOUR) return 'vừa xong';
  if (d < DAY) return `${Math.round(d / HOUR)} giờ trước`;
  if (d < 7 * DAY) return `${Math.round(d / DAY)} ngày trước`;
  const dt = new Date(t);
  return `${dt.getDate()}.${dt.getMonth() + 1}.${dt.getFullYear()}`;
}
