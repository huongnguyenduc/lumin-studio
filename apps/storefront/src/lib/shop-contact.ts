import 'server-only';

import { createApiClient } from '@lumin/api-client';
import type { components } from '@lumin/api-client';
import { coreApiBaseUrl } from './core-api';

// Server-side reader for GET /shop/contact (PR F) — the shop's configured contact channels
// (zalo/facebook/phone/email/address/hours), every field optional/omit-when-unset. Copies the
// checkout-config.ts pattern verbatim: fetched server-side (CORE_API_URL never reaches the browser),
// any failure collapses to one opaque `error` so the caller owns retryable copy (always-must #3 — no
// backend prose leaks through). Two callers: /lien-he (the full page) and the site-wide "Nhắn shop"
// popup (layout.tsx, fetched once and passed down — never a per-open client call).

export type ShopContact = components['schemas']['ShopContact'];

export type ShopContactResult = { ok: true; contact: ShopContact } | { ok: false; code: 'error' };

export async function fetchShopContact(): Promise<ShopContactResult> {
  try {
    const client = createApiClient({ baseUrl: coreApiBaseUrl() });
    const { data } = await client.GET('/shop/contact', {});
    if (data) return { ok: true, contact: data };
    return { ok: false, code: 'error' };
  } catch {
    return { ok: false, code: 'error' };
  }
}

/** Whether any channel is actually configured — callers use this to skip rendering the popup/page CTA
 *  entirely rather than showing an empty shell. */
export function hasAnyChannel(contact: ShopContact): boolean {
  return Boolean(
    contact.zalo || contact.facebook || contact.phone || contact.email || contact.address,
  );
}
