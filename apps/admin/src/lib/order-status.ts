import type { OrderStatus } from '@lumin/core';
import type { BadgeTone } from '@lumin/ui';

// Maps EVERY one of the 7 ORDER_STATUSES (spec §04) to its admin-facing Badge presentation. The VN
// label is an i18n key under `status.*` (rendered by OrderStatusBadge), never baked here — this is
// pure DATA (tone/solid + key) so it can live in a .ts module. Tones are picked so the pill reads at
// a glance: the in-flight happy path is coral/primary, terminal-good is teal, ship is sky,
// cancel is danger, refund is sun (matches the Dev Handoff status table).
export interface OrderStatusBadgeMeta {
  labelKey: OrderStatus;
  tone: BadgeTone;
  solid?: boolean;
}

export const ORDER_STATUS_BADGE: Record<OrderStatus, OrderStatusBadgeMeta> = {
  PENDING_CONFIRM: { labelKey: 'PENDING_CONFIRM', tone: 'primary' },
  PAID: { labelKey: 'PAID', tone: 'primary' },
  PRINTING: { labelKey: 'PRINTING', tone: 'primary', solid: true },
  SHIPPING: { labelKey: 'SHIPPING', tone: 'sky' },
  COMPLETED: { labelKey: 'COMPLETED', tone: 'teal' },
  CANCELLED: { labelKey: 'CANCELLED', tone: 'danger' },
  REFUNDED: { labelKey: 'REFUNDED', tone: 'sun' },
};
