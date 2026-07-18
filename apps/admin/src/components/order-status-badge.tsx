import { useTranslations } from 'next-intl';
import type { OrderStatus } from '@lumin/core';
import { Badge, ORDER_STATUS_TONE } from '@lumin/ui';

/**
 * Renders the @lumin/ui Badge for an OrderStatus using the shared ORDER_STATUS_TONE map + the
 * `status.*` i18n catalog. No handlers/hooks-with-state → server component. The label text comes from
 * next-intl (never a literal), the tone/solid from the map.
 */
export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const t = useTranslations('status');
  const { tone, solid } = ORDER_STATUS_TONE[status];

  return (
    <Badge tone={tone} solid={solid}>
      {t(status)}
    </Badge>
  );
}
