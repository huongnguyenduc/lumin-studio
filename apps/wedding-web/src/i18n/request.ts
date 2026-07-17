import { getRequestConfig } from 'next-intl/server';
import { locale, messages } from '../messages';

// vi-only: no locale segment/middleware — the request config always returns the `vi` catalog.
export default getRequestConfig(async () => ({ locale, messages }));
