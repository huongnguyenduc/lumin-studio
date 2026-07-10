import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseSessionCookie, SESSION_COOKIE } from '../src/lib/session';

// --- next/* + api-client boundaries mocked so the 'use server' actions run in node ------------------
const setMock = vi.fn();
const deleteMock = vi.fn();
const postMock = vi.fn();
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ set: setMock, delete: deleteMock })),
}));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('@lumin/api-client', () => ({ createApiClient: vi.fn(() => ({ POST: postMock })) }));

describe('parseSessionCookie', () => {
  it('lifts value + Max-Age out of a realistic core-api Set-Cookie', () => {
    expect(
      parseSessionCookie([
        `${SESSION_COOKIE}=eyJhbGc.tok.sig; Path=/; Max-Age=86400; HttpOnly; Secure; SameSite=Strict`,
      ]),
    ).toEqual({ value: 'eyJhbGc.tok.sig', maxAge: 86400 });
  });

  it('picks the session cookie out of several Set-Cookie lines', () => {
    expect(
      parseSessionCookie(['other=1; Path=/', `${SESSION_COOKIE}=tok; Max-Age=3600`, 'trailing=2']),
    ).toEqual({ value: 'tok', maxAge: 3600 });
  });

  it('returns null when the session cookie is absent', () => {
    expect(parseSessionCookie(['other=1; Path=/'])).toBeNull();
    expect(parseSessionCookie([])).toBeNull();
  });

  it('treats an empty value (a Clear/logout cookie) as no session', () => {
    expect(parseSessionCookie([`${SESSION_COOKIE}=; Max-Age=0`])).toBeNull();
  });

  it('drops a missing / non-positive Max-Age (undefined, not 0/NaN)', () => {
    expect(parseSessionCookie([`${SESSION_COOKIE}=tok; Path=/`])).toEqual({
      value: 'tok',
      maxAge: undefined,
    });
    expect(parseSessionCookie([`${SESSION_COOKIE}=tok; Max-Age=-1`])?.maxAge).toBeUndefined();
  });
});

describe('login action', () => {
  const authUser = { id: 'u1', name: 'Chủ shop', email: 'shop@lumin.vn', role: 'owner' };

  beforeEach(() => {
    process.env.CORE_API_URL = 'http://core-api:8080';
  });
  afterEach(() => {
    setMock.mockReset();
    postMock.mockReset();
    delete process.env.CORE_API_URL;
  });

  it('on 200 re-issues the session cookie on the admin host and returns ok', async () => {
    postMock.mockResolvedValue({
      data: authUser,
      error: undefined,
      response: {
        status: 200,
        headers: { getSetCookie: () => [`${SESSION_COOKIE}=tok-abc; Max-Age=86400; HttpOnly`] },
      },
    });
    const { login } = await import('../src/lib/auth-actions');

    await expect(login({ email: 'shop@lumin.vn', password: 'pw' })).resolves.toEqual({ ok: true });
    expect(setMock).toHaveBeenCalledWith(
      SESSION_COOKIE,
      'tok-abc',
      expect.objectContaining({ httpOnly: true, sameSite: 'strict', path: '/', maxAge: 86400 }),
    );
  });

  it('maps a 401 to invalid without setting a cookie (no enumeration)', async () => {
    postMock.mockResolvedValue({
      data: undefined,
      error: { code: 'UNAUTHORIZED' },
      response: { status: 401, headers: { getSetCookie: () => [] } },
    });
    const { login } = await import('../src/lib/auth-actions');

    await expect(login({ email: 'x@y.vn', password: 'bad' })).resolves.toEqual({
      ok: false,
      reason: 'invalid',
    });
    expect(setMock).not.toHaveBeenCalled();
  });

  it('maps a 5xx to error (retry may help)', async () => {
    postMock.mockResolvedValue({
      data: undefined,
      error: { code: 'INTERNAL' },
      response: { status: 500, headers: { getSetCookie: () => [] } },
    });
    const { login } = await import('../src/lib/auth-actions');
    await expect(login({ email: 'a@b.vn', password: 'pw' })).resolves.toEqual({
      ok: false,
      reason: 'error',
    });
  });

  it('fails closed when a 200 carries no session cookie', async () => {
    postMock.mockResolvedValue({
      data: authUser,
      error: undefined,
      response: { status: 200, headers: { getSetCookie: () => [] } },
    });
    const { login } = await import('../src/lib/auth-actions');
    await expect(login({ email: 'a@b.vn', password: 'pw' })).resolves.toEqual({
      ok: false,
      reason: 'error',
    });
    expect(setMock).not.toHaveBeenCalled();
  });

  it('treats a thrown fetch (network / unset base URL) as a transient error', async () => {
    postMock.mockRejectedValue(new Error('ECONNREFUSED'));
    const { login } = await import('../src/lib/auth-actions');
    await expect(login({ email: 'a@b.vn', password: 'pw' })).resolves.toEqual({
      ok: false,
      reason: 'error',
    });
  });
});
