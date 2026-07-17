import { vi } from './vi';

export const locale = 'vi' as const;
export const messages = vi;

export type Messages = typeof messages;
