import { fetchAdminCustomers } from '@/lib/customers-fetch';
import { CustomersView } from '@/components/customers-view';

/**
 * Customers route (Khách hàng, /khach-hang, P3-p). Async server component: fetches the whole customer
 * roster with order aggregates (GET /admin/customers) forwarding the session cookie, and hands it to the
 * client CustomersView (search + list + per-row link to the detail). PDPL: admin-gated (owner AND staff);
 * `no-store` keeps the roster live. A fetch failure falls to (app)/error.tsx; loading is ./loading.tsx.
 */
export default async function CustomersPage() {
  const customers = await fetchAdminCustomers();
  return <CustomersView customers={customers} />;
}
