import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { CheckoutView } from '@/components/checkout-view';
import { fetchCheckoutConfig } from '@/lib/checkout-config';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('checkout');
  // Checkout is a private, per-visitor page with no canonical content — keep it out of search indexes
  // (storefront rule §SEO: chặn index checkout).
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

// Server shell: fetches the public checkout config (shippable provinces + refund policy + STK, P2-a)
// once and hands it to the client view, which owns the cart (localStorage) and the interactive form.
// The config-failure path is rendered by the view (retryable via router.refresh) rather than thrown, so
// a transient API blip degrades to a friendly error instead of crashing the route.
export default async function CheckoutPage() {
  const config = await fetchCheckoutConfig();
  return <CheckoutView config={config} />;
}
