// @lumin/core — shared domain backbone for all 4 surfaces (spec §02/§04).
export {
  type OrderStatus,
  type Role,
  type Channel,
  type StatusEvent,
  type OrderLike,
  type TransitionContext,
  type TransitionErrorCode,
  ORDER_STATUSES,
  TERMINAL_STATUSES,
  TransitionError,
  isAllowedEdge,
  isOwnerOnly,
  roleAllowed,
  canTransition,
  initialStatusForChannel,
  transition,
  replayStatus,
} from './order-state';

export {
  type PriceableItem,
  type TotalsInput,
  type Totals,
  formatVnd,
  parseVnd,
  calcTotals,
} from './money';

export * from './schemas';
export { formatVnDate, formatVnNumber, formatVnRating } from './i18n/formatters';
export { vi, messages, defaultLocale, type Messages } from './i18n/vi';
