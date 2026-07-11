import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { fetchAdminProducts } from '@/lib/products-fetch';
import { toProductCards } from '@/lib/products';
import { ProductsView } from '@/components/products-view';

/**
 * Admin product list (Sản phẩm, P3-k). An async server component: it fetches the whole catalog from
 * core-api forwarding the session cookie (no-store → always live), maps it with the pure adapters,
 * and renders the header (title + total + add button) plus the interactive grid. Tab/search live in
 * the client <ProductsView> (the catalog is unpaginated by design). Loading is ./loading.tsx; a fetch
 * failure is caught by (app)/error.tsx (retry); an empty catalog renders the view's empty state.
 */
export default async function ProductsPage() {
  const t = await getTranslations('products');
  const summaries = await fetchAdminProducts();
  const rows = toProductCards(summaries);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="flex items-baseline gap-2 text-2xl font-bold text-text-strong">
          {t('title')}
          <span className="text-sm font-normal text-text-muted">
            {t('count', { count: rows.length })}
          </span>
        </h1>
        <Link
          href="/san-pham/moi"
          className="inline-flex min-h-[44px] items-center rounded-lg bg-primary px-4 py-2 font-semibold text-on-primary shadow-pop focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky focus-visible:ring-offset-2"
        >
          + {t('addProduct')}
        </Link>
      </header>

      <ProductsView rows={rows} />
    </div>
  );
}
