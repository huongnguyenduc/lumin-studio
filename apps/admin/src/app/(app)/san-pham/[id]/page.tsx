import { getTranslations } from 'next-intl/server';
import { Card } from '@lumin/ui';
import { fetchAdminProductDetail, fetchFilaments } from '@/lib/product-detail-fetch';
import { fetchCategories } from '@/lib/categories-fetch';
import { ProductEditor } from '@/components/product-editor';

/**
 * Admin product editor — edit route (Sản phẩm → chi tiết, P3-l l-1). Async server component: reads the id,
 * fetches the full product (GET /admin/products/{id}) and the category list in parallel forwarding the
 * session cookie, and hands them to the client <ProductEditor>. A 404 (unknown id) renders the friendly
 * not-found here; any other fetch failure is caught by (app)/error.tsx. Loading is ./loading.tsx.
 */
export default async function ProductEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [product, categories, filaments] = await Promise.all([
    fetchAdminProductDetail(id),
    fetchCategories(),
    fetchFilaments(),
  ]);

  if (!product) {
    const t = await getTranslations('products');
    return (
      <Card elevation="md" className="px-5 py-16 text-center">
        <p className="text-text-muted">{t('edit.notFound')}</p>
      </Card>
    );
  }

  return <ProductEditor product={product} categories={categories} filaments={filaments} />;
}
