import 'server-only';

import { fetchStaff } from './settings-fetch';
import { weddingApi, weddingConfigured } from './wedding-admin';

// Server-side reads for the "Đám cưới" surface (couple management). Owner-only:
// wedding-api can't see lumin roles, so the gate is a probe of an owner-only
// core-api endpoint (fetchStaff 403s for staff). `unavailable` = the wedding
// bridge isn't configured / wedding-api is down.

export type Wedding = {
  slug: string;
  name: string;
  sortOrder: number;
  hasPassword: boolean;
  createdAt: string;
};

export type WeddingEvent = {
  slug: string;
  name: string;
  sortOrder: number;
  subdomain: string | null;
  requestedSubdomain: string | null;
  weddingSlug: string;
  data: Record<string, unknown>;
};

export type WeddingsData =
  | { status: 'ok'; weddings: Wedding[]; events: WeddingEvent[] }
  | { status: 'forbidden' }
  | { status: 'unavailable' };

/** List couples + their events (for pending subdomain requests). Owner-only. */
export async function fetchWeddings(): Promise<WeddingsData> {
  // Reuse an existing owner-only core-api edge as the role gate: staff → 403.
  const staff = await fetchStaff();
  if (staff.forbidden) return { status: 'forbidden' };

  if (!weddingConfigured()) return { status: 'unavailable' };

  const [weddings, events] = await Promise.all([
    weddingApi<{ items: Wedding[] }>('GET', '/api/admin/weddings'),
    weddingApi<{ items: WeddingEvent[] }>('GET', '/api/admin/events'),
  ]);
  if (weddings.status !== 'ok' || events.status !== 'ok') return { status: 'unavailable' };
  return { status: 'ok', weddings: weddings.data.items, events: events.data.items };
}
