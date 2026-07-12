import { fetchCategories } from '@/lib/categories-fetch';
import { ProductEditor } from '@/components/product-editor';

/**
 * Admin product editor — create route (Sản phẩm → + Thêm, P3-l l-1). Async server component: fetches the
 * category list (for the picker) and renders <ProductEditor> with no product = create mode. On save it
 * POSTs and redirects to /san-pham/{id} (the aggregate-root grain: colors/options/model need an id). A
 * category-fetch failure is caught by (app)/error.tsx.
 */
export default async function ProductCreatePage() {
  const categories = await fetchCategories();
  return <ProductEditor categories={categories} />;
}
