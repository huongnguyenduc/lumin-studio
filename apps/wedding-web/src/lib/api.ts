import 'server-only';

// Server-side calls to wedding-api (the browser talks to the same paths via the
// next.config rewrite). SSR of /i/<slug> uses no-store so the label renders
// without flicker (§6); open tracking is a client POST (MarkOpened), not here.
const base = process.env.WEDDING_API_URL ?? 'http://localhost:8081';

import type { EventSummary, Invite, Wish } from './types';

export type { Invite, Wish, EventSummary };

export async function getInvite(slug: string): Promise<Invite | null> {
  try {
    const res = await fetch(`${base}/api/invite/${encodeURIComponent(slug)}`, {
      cache: 'no-store',
    });
    if (!res.ok) return null; // 404 → anonymous card
    return (await res.json()) as Invite;
  } catch {
    return null; // API down → the page still renders, anonymous
  }
}

// hostQS forwards the page's Host to the API, which resolves it to ONE
// wedding (multi-couple) — the rewrite proxy doesn't reliably keep the
// original Host header, so it travels as an explicit query param.
const hostQS = (host?: string) => (host ? `?host=${encodeURIComponent(host)}` : '');

// Host-configurable site settings (HANDOFF §3.5): heroUrl, mapUrl, mapsUrl,
// gallery (string[]), musicUrl, siteTitle, siteDesc, ogUrl, iconUrl. Missing/
// down API → {} and the page falls back to the built-in assets.
export async function getSettings(host?: string): Promise<Record<string, unknown>> {
  try {
    const res = await fetch(`${base}/api/settings${hostQS(host)}`, { cache: 'no-store' });
    if (!res.ok) return {};
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

// The host's wedding's events (venue/timeline/ceremony data). getActiveEvent()
// resolves which one this deployment serves: WEDDING_EVENT_SLUG if set, else
// the first by sortOrder — so a single-wedding deployment needs no env change.
export async function getEvents(host?: string): Promise<EventSummary[]> {
  try {
    const res = await fetch(`${base}/api/events${hostQS(host)}`, { cache: 'no-store' });
    if (!res.ok) return [];
    const data = (await res.json()) as { items: EventSummary[] };
    return data.items;
  } catch {
    return [];
  }
}

// Resolves by the request's Host header first (admin-set `subdomain`, live
// with no redeploy via the wildcard Ingress) — falls back to
// WEDDING_EVENT_SLUG then the first event, so local dev (host = localhost)
// and a not-yet-configured event both still work.
export async function getActiveEvent(host?: string): Promise<EventSummary | null> {
  const events = await getEvents(host);
  if (events.length === 0) return null;
  const hostname = host?.split(':')[0].toLowerCase();
  const byHost = hostname && events.find((e) => e.subdomain?.toLowerCase() === hostname);
  if (byHost) return byHost;
  const wanted = process.env.WEDDING_EVENT_SLUG;
  return (wanted && events.find((e) => e.slug === wanted)) || events[0];
}

export async function getWishes(
  limit = 100,
  host?: string,
): Promise<{ items: Wish[]; total: number }> {
  try {
    const res = await fetch(
      `${base}/api/wishes?limit=${limit}${host ? `&host=${encodeURIComponent(host)}` : ''}`,
      { cache: 'no-store' },
    );
    if (!res.ok) return { items: [], total: 0 };
    return (await res.json()) as { items: Wish[]; total: number };
  } catch {
    return { items: [], total: 0 };
  }
}
