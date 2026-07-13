import { api } from './client';
import { clearSession, getUser, setSession, type SessionUser } from './token';

export type { SessionUser };

// Distinguishable login failures so the UI shows the right message: bad credential vs network vs a
// server that didn't honor issueToken. reason keys map to login.error.* messages.
export type LoginFailure = 'invalid' | 'network' | 'notoken';
export class LoginError extends Error {
  constructor(readonly reason: LoginFailure) {
    super(reason);
    this.name = 'LoginError';
  }
}

// Log in against core-api with issueToken=true (ADR-043): the 200 body carries the JWT, which we
// persist for Bearer auth. A bad credential is a uniform 401 (no enumeration — enforced server-side).
export async function login(email: string, password: string): Promise<SessionUser> {
  const result = await api
    .POST('/auth/login', { body: { email, password, issueToken: true } })
    .catch(() => null); // fetch threw (offline, DNS, host not permitted)
  if (result === null) {
    throw new LoginError('network');
  }
  const { data, error, response } = result;
  if (error || !data) {
    throw new LoginError(response.status === 401 ? 'invalid' : 'network');
  }
  if (!data.token) {
    throw new LoginError('notoken'); // server ignored issueToken (misconfig) — can't Bearer-auth
  }
  const user: SessionUser = { id: data.id, name: data.name, email: data.email, role: data.role };
  await setSession(user, data.token);
  return user;
}

// Best-effort server logout (clears the cookie if one exists), then always drop the local session —
// the local clear is what actually signs the extension out.
export async function logout(): Promise<void> {
  try {
    await api.POST('/auth/logout');
  } catch {
    // ignore
  }
  await clearSession();
}

export { getUser };
