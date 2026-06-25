import { useTranslations } from 'next-intl';
import type { OrderStatus } from '@lumin/core';
import { Badge } from '@lumin/ui';
import { ORDER_STATUS_BADGE } from '@/lib/order-status';

/**
 * Renders the @lumin/ui Badge for an OrderStatus using the shared ORDER_STATUS_BADGE map + the
 * `status.*` i18n catalog. No handlers/hooks-with-state → server component. The label text comes from
 * next-intl (never a literal), the tone/solid from the map.
 */
export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const t = useTranslations('status');
  const meta = ORDER_STATUS_BADGE[status];

  return (
    <Badge tone={meta.tone} solid={meta.solid}>
      {t(meta.labelKey)}
    </Badge>
  );
}
