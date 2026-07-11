import type { components } from '@lumin/api-client';
import type { BadgeTone } from '@lumin/ui';

// Maps the core-api admin catalog list (GET /admin/products, P3-j) onto the card shape the product
// grid renders, plus the pure tab/search helpers the client view shares. Pure functions only (no
// I/O) so the wire→prop mapping and the filter/count math are pinned by a Docker-free unit test. The
// server-side fetch lives in ./products-fetch (it imports next/headers and is not importable here).
// The list is NOT paginated (a made-to-order catalog is small and admin-curated — openapi note), so
// the whole set is fetched once and tab/search filtering happens client-side over the full array.

type AdminProductSummary = components['schemas']['AdminProductSummary'];
export type ProductStatus = components['schemas']['ProductStatus'];

/** The 3 product statuses (spec §02), in the order the tabs show them after "Tất cả". */
export const PRODUCT_STATUSES = ['active', 'draft', 'archived'] as const;

/** Tab identity: a status, or 'all' ("Tất cả"). */
export type ProductTab = 'all' | ProductStatus;
export const PRODUCT_TABS = ['all', ...PRODUCT_STATUSES] as const;

/** Badge tone per status: active = teal (live, matches the design's teal "Đang bán" pill), draft =
 *  neutral (grey outline), archived = sun (shelved/muted). The label is an i18n key, never baked here. */
export const PRODUCT_STATUS_TONE: Record<ProductStatus, BadgeTone> = {
  active: 'teal',
  draft: 'neutral',
  archived: 'sun',
};

export interface ProductCardRow {
  id: string;
  name: string;
  /** int VND — formatted by formatVnd at render, never baked into a string (always-must #2). */
  basePrice: number;
  status: ProductStatus;
  /** Card cover = images[0] (ADR-007); undefined → dotgrid placeholder. */
  coverImage?: string;
  /** Precomputed lowercase name + slug so the client search matches accent-free: the slug is already
   *  unaccented lowercase, so typing "den" hits "Đèn …" without pulling in a diacritic-folding lib. */
  searchKey: string;
}

/** Wire summary list → card rows. Folds images[0] into coverImage and precomputes the search key.
 *  Status stays the wire enum (byte-parity across OpenAPI/Go/Zod). A nil/empty list yields []. */
export function toProductCards(list: AdminProductSummary[]): ProductCardRow[] {
  return list.map((p) => ({
    id: p.id,
    name: p.name,
    basePrice: p.basePrice,
    status: p.status,
    coverImage: p.images[0],
    searchKey: `${p.name} ${p.slug}`.toLowerCase(),
  }));
}

/** Filter by the active tab (a status, or 'all') and a case-insensitive query. An empty query matches
 *  everything; the query is tested against name+slug so an accent-free term still hits (see searchKey). */
export function filterProducts(
  rows: ProductCardRow[],
  tab: ProductTab,
  query: string,
): ProductCardRow[] {
  const q = query.trim().toLowerCase();
  return rows.filter(
    (r) => (tab === 'all' || r.status === tab) && (q === '' || r.searchKey.includes(q)),
  );
}

/** Count per tab (all + each status) for the tab badges, in one pass over the full set. */
export function countByTab(rows: ProductCardRow[]): Record<ProductTab, number> {
  const counts: Record<ProductTab, number> = { all: rows.length, active: 0, draft: 0, archived: 0 };
  for (const r of rows) counts[r.status] += 1;
  return counts;
}
