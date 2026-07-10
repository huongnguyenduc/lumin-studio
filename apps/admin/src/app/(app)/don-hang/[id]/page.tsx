import { getTranslations } from 'next-intl/server';
import { Card } from '@lumin/ui';
import { fetchAdminOrderDetail } from '@/lib/orders-fetch';
import { OrderDetailView } from '@/components/order-detail-view';

/**
 * Admin order-detail route (Đơn hàng → chi tiết, P3-e). An async server component: it reads the id from
 * the path, fetches the full internal order (GET /admin/orders/{id}, P3-d) forwarding the session
 * cookie, and hands it to the client OrderDetailView (which owns the transition flow). A 404 (unknown id
 * or a uniform not-found) renders the friendly empty state here; any other fetch failure is caught by
 * (app)/error.tsx (retry). Loading is ./loading.tsx (skeleton). Reading the path makes the route dynamic.
 */
export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const order = await fetchAdminOrderDetail(id);

  if (!order) {
    const t = await getTranslations('orderDetail');
    return (
      <Card elevation="md" className="px-5 py-16 text-center">
        <p className="text-text-muted">{t('notFound')}</p>
      </Card>
    );
  }

  return <OrderDetailView order={order} />;
}
