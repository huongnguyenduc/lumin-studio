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

// Host-configurable site settings (HANDOFF §3.5): heroUrl, mapUrl, mapsUrl,
// gallery (string[]), musicUrl, siteTitle, siteDesc, ogUrl, iconUrl. Missing/
// down API → {} and the page falls back to the built-in assets.
export async function getSettings(): Promise<Record<string, unknown>> {
  try {
    const res = await fetch(`${base}/api/settings`, { cache: 'no-store' });
    if (!res.ok) return {};
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

// Every event (venue/timeline/ceremony data per wedding). getActiveEvent()
// resolves which one this deployment serves: WEDDING_EVENT_SLUG if set, else
// the first by sortOrder — so a single-wedding deployment needs no env change.
export async function getEvents(): Promise<EventSummary[]> {
  try {
    const res = await fetch(`${base}/api/events`, { cache: 'no-store' });
    if (!res.ok) return [];
    const data = (await res.json()) as { items: EventSummary[] };
    return data.items;
  } catch {
    return [];
  }
}

export async function getActiveEvent(): Promise<EventSummary | null> {
  const events = await getEvents();
  if (events.length === 0) return null;
  const wanted = process.env.WEDDING_EVENT_SLUG;
  return (wanted && events.find((e) => e.slug === wanted)) || events[0];
}

export async function getWishes(limit = 100): Promise<{ items: Wish[]; total: number }> {
  try {
    const res = await fetch(`${base}/api/wishes?limit=${limit}`, { cache: 'no-store' });
    if (!res.ok) return { items: [], total: 0 };
    return (await res.json()) as { items: Wish[]; total: number };
  } catch {
    return { items: [], total: 0 };
  }
}
