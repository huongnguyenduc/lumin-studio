'use server';

import { fetchProductBySlug } from './catalog';
import type { ProductDetailView } from './product-view';

// Server Action wrapper around the server-only fetchProductBySlug (lib/catalog.ts — CORE_API_URL never
// reaches the browser) for the cart edit dialog (PR D): the cart page has no product data of its own
// (CartItem stores only ids + frozen display labels), so "sửa tại chỗ" needs a fresh read of the
// product's current colours/parts/options before it can seed the shared configurator (product-configurator.tsx).
// Collapses every failure to a small view-safe result — never throws into a client component.

export type ProductForEditResult =
  | { ok: true; product: ProductDetailView }
  | { ok: false; code: 'not_found' | 'error' };

export async function fetchProductForEdit(slug: string): Promise<ProductForEditResult> {
  try {
    const product = await fetchProductBySlug(slug);
    if (!product) return { ok: false, code: 'not_found' };
    return { ok: true, product };
  } catch {
    return { ok: false, code: 'error' };
  }
}
