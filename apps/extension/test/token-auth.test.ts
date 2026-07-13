import { beforeEach, describe, expect, it, vi } from 'vitest';

// login() talks to core-api through ../src/lib/client's `api`. Mock that module so these tests
// exercise auth.ts's own logic — token extraction, error mapping, session persistence — without
// openapi-fetch/network. The server side (issueToken body + Bearer accept) is covered by the Go tests.
vi.mock('../src/lib/client', () => ({ api: { POST: vi.fn() } }));

import { api } from '../src/lib/client';
import { clearSession, getToken, getUser, setSession } from '../src/lib/token';
import { login, LoginError } from '../src/lib/auth';

const post = api.POST as unknown as ReturnType<typeof vi.fn>;
const owner = { id: 'u1', name: 'Chủ shop', email: 'owner@lumin.vn', role: 'owner' as const };

// In-memory chrome.storage.local so the extension's session storage is testable under node.
function installChromeMock(): void {
  const store = new Map<string, unknown>();
  (globalThis as { chrome?: unknown }).chrome = {
    storage: {
      local: {
        get: async (keys: string | string[]) => {
          const out: Record<string, unknown> = {};
          for (const k of Array.isArray(keys) ? keys : [keys]) {
            if (store.has(k)) out[k] = store.get(k);
          }
          return out;
        },
        set: async (items: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(items)) store.set(k, v);
        },
        remove: async (keys: string | string[]) => {
          for (const k of Array.isArray(keys) ? keys : [keys]) store.delete(k);
        },
      },
    },
  };
}

beforeEach(() => {
  installChromeMock();
  post.mockReset();
});

describe('session storage', () => {
  it('round-trips token + user, and clearSession wipes both', async () => {
    expect(await getToken()).toBeNull();
    expect(await getUser()).toBeNull();
    await setSession(owner, 'jwt.abc');
    expect(await getToken()).toBe('jwt.abc');
    expect(await getUser()).toEqual(owner);
    await clearSession();
    expect(await getToken()).toBeNull();
    expect(await getUser()).toBeNull();
  });
});

describe('login (ADR-043 token handling)', () => {
  it('sends issueToken, stores the body token, returns the user', async () => {
    post.mockResolvedValueOnce({
      data: { ...owner, token: 'jwt.body' },
      error: undefined,
      response: { status: 200 },
    });
    const user = await login('owner@lumin.vn', 'secret123');
    expect(user).toEqual(owner);
    expect(await getToken()).toBe('jwt.body'); // persisted for Bearer auth
    expect(post).toHaveBeenCalledWith('/auth/login', {
      body: { email: 'owner@lumin.vn', password: 'secret123', issueToken: true },
    });
  });

  it('maps a 401 to invalid and stores nothing', async () => {
    post.mockResolvedValueOnce({
      data: undefined,
      error: { code: 'UNAUTHORIZED' },
      response: { status: 401 },
    });
    await expect(login('owner@lumin.vn', 'wrong')).rejects.toMatchObject({ reason: 'invalid' });
    expect(await getToken()).toBeNull();
  });

  it('throws notoken when a 200 body omits the token', async () => {
    post.mockResolvedValueOnce({ data: { ...owner }, error: undefined, response: { status: 200 } });
    await expect(login('owner@lumin.vn', 'secret123')).rejects.toBeInstanceOf(LoginError);
    expect(await getToken()).toBeNull();
  });

  it('maps a thrown fetch (offline) to network', async () => {
    post.mockRejectedValueOnce(new Error('offline'));
    await expect(login('owner@lumin.vn', 'secret123')).rejects.toMatchObject({ reason: 'network' });
  });
});
