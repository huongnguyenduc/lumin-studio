import 'server-only';

// Server-side calls to wedding-api (the browser talks to the same paths via the
// next.config rewrite). SSR of /i/<slug> uses no-store so the invite GET always
// fires the write-once opened_at and the label renders without flicker (§6).
const base = process.env.WEDDING_API_URL ?? 'http://localhost:8081';

import type { Invite, Wish } from './types';

export type { Invite, Wish };

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

export async function getWishes(limit = 100): Promise<{ items: Wish[]; total: number }> {
  try {
    const res = await fetch(`${base}/api/wishes?limit=${limit}`, { cache: 'no-store' });
    if (!res.ok) return { items: [], total: 0 };
    return (await res.json()) as { items: Wish[]; total: number };
  } catch {
    return { items: [], total: 0 };
  }
}
