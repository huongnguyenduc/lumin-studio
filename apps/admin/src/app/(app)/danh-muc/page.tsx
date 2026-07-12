import { fetchAdminCategories } from '@/lib/categories-fetch';
import { CategoriesView } from '@/components/categories-view';

/**
 * Categories route (Danh mục, /danh-muc, P3-o slice o-1b). Async server component: fetches every category
 * with its product count (GET /admin/categories) forwarding the session cookie, and hands them to the client
 * CategoriesView (which owns the CRUD). A fetch failure is caught by (app)/error.tsx (retry); loading is
 * ./loading.tsx (skeleton). `no-store` keeps the list live after a create/rename/delete.
 */
export default async function CategoriesPage() {
  const categories = await fetchAdminCategories();
  return <CategoriesView categories={categories} />;
}
