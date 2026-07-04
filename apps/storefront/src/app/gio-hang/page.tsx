import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { CartView } from '@/components/cart-view';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('cart');
  // The cart is a private, per-visitor page with no canonical content — keep it out of search indexes
  // (storefront rule §SEO: chặn index checkout/lookup; the cart is the same class of private page).
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

// Server shell only — the cart itself is client state (localStorage) priced via a Server Action, so all
// the work lives in the <CartView> client component. No server fetch here (nothing to read until the
// browser reports its cart).
export default function CartPage() {
  return <CartView />;
}
