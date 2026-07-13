// Session credential storage — the Bearer token (ADR-043) + the logged-in user live in
// chrome.storage.local: sandboxed to the extension, unreadable by any web page (unlike a web app's
// localStorage). Cleared on logout, never logged. Pure storage (no API client) so the client's Bearer
// middleware can import it without an import cycle.
const TOKEN_KEY = 'lumin.session.token';
const USER_KEY = 'lumin.session.user';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: 'owner' | 'staff';
}

export async function getToken(): Promise<string | null> {
  const stored = await chrome.storage.local.get(TOKEN_KEY);
  const token = stored[TOKEN_KEY];
  return typeof token === 'string' && token.length > 0 ? token : null;
}

export async function getUser(): Promise<SessionUser | null> {
  const stored = await chrome.storage.local.get(USER_KEY);
  return (stored[USER_KEY] as SessionUser | undefined) ?? null;
}

export async function setSession(user: SessionUser, token: string): Promise<void> {
  await chrome.storage.local.set({ [TOKEN_KEY]: token, [USER_KEY]: user });
}

export async function clearSession(): Promise<void> {
  await chrome.storage.local.remove([TOKEN_KEY, USER_KEY]);
}
