import { messages as coreMessages } from '@lumin/core';
import { vi } from './vi';

export const locale = 'vi' as const;

// next-intl message tree: admin chrome at the top level + the shared @lumin/core domain catalog
// (order-state/validation microcopy) under the `core` namespace, reachable as `core.cart.empty`.
export const messages = { ...vi, core: coreMessages.vi };

export type Messages = typeof messages;
