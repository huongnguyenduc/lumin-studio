import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { OrderLookup } from '@/components/order-lookup';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('lookup');
  // Guest lookup is a private, per-order page with no canonical content — keep it out of search
  // indexes (storefront rule §SEO: chặn index order-lookup).
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

// Server shell only — the tracker is fully interactive (a form + auto-poll via a Server Action), so all
// the work lives in the <OrderLookup> client component. Nothing to read until the guest submits a code.
export default function OrderLookupPage() {
  return <OrderLookup />;
}
