import { createApiClient } from '@lumin/api-client';
import { API_BASE_URL } from '../config';
import { getToken } from './token';

// The typed core-api client for the extension. credentials:'omit' — the extension is cross-origin and
// authenticates with a Bearer token (ADR-043), not the SameSite=Strict cookie. A request middleware
// attaches the stored token; login/logout carry none yet (those routes are public), so a missing
// token simply sends no Authorization header.
export const api = createApiClient({ baseUrl: API_BASE_URL, credentials: 'omit' });

api.use({
  async onRequest({ request }) {
    const token = await getToken();
    if (token) {
      request.headers.set('Authorization', `Bearer ${token}`);
    }
    return request;
  },
});
