import type { components } from '@lumin/api-client';
import { api } from './client';

export type ProductCard = components['schemas']['ProductCard'];
export type Product = components['schemas']['Product'];

// GET /products — active-only card list. pageSize is capped at 48 server-side; a made-to-order shop's
// catalog is small, so one page feeds the picker. ponytail: add the `q` search param if it ever grows
// past 48 products.
export async function listProducts(): Promise<ProductCard[]> {
  const { data, error } = await api.GET('/products', { params: { query: { pageSize: 48 } } });
  if (error || !data) throw new Error('products');
  return data.items;
}

// GET /products/{slug} — full detail (colors/options/parts) the variant picker renders.
export async function getProduct(slug: string): Promise<Product> {
  const { data, error } = await api.GET('/products/{slug}', { params: { path: { slug } } });
  if (error || !data) throw new Error('product');
  return data;
}

// GET /checkout/config — shippableProvinces feeds the address province <select>, so the quote prices
// shipping correctly and submit never 422s NO_SHIPPING_RULE on an unshippable province.
export async function listShippableProvinces(): Promise<string[]> {
  const { data, error } = await api.GET('/checkout/config');
  if (error || !data) throw new Error('config');
  return data.shippableProvinces;
}
