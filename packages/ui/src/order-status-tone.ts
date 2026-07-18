import type { OrderStatus } from '@lumin/core';
import type { BadgeTone } from './Badge';

/**
 * Single shared OrderStatus → Badge tone map (spec §04, Dev Handoff status table) used by
 * storefront, admin and extension. Labels stay per-app i18n — only the visual tone lives here.
 * In-flight happy path reads coral/primary, ship is sky, terminal-good is teal, cancel is danger,
 * refund is sun.
 */
export const ORDER_STATUS_TONE: Record<OrderStatus, { tone: BadgeTone; solid?: boolean }> = {
  PENDING_CONFIRM: { tone: 'primary' },
  PAID: { tone: 'primary' },
  PRINTING: { tone: 'primary', solid: true },
  SHIPPING: { tone: 'sky' },
  COMPLETED: { tone: 'teal' },
  CANCELLED: { tone: 'danger' },
  REFUNDED: { tone: 'sun' },
};
