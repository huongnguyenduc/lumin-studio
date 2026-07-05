import { describe, it, expect } from 'vitest';
import { parseSetCookie, parseProfile, serializeProfile } from '../src/lib/customer-session-cookie';

// The one genuinely-new primitive in P1-s: pulling the session JWT (+ TTL) out of core-api's Set-Cookie
// so the BFF can re-mint it first-party, and round-tripping the identity profile cookie. If this breaks,
// login silently sets no session (or a broken one) — so it earns a test.

describe('parseSetCookie', () => {
  it('extracts the value and Max-Age from the matching Set-Cookie', () => {
    const headers = [
      'lumin_customer=abc.def.ghi; Path=/; Max-Age=43200; HttpOnly; Secure; SameSite=Strict',
    ];
    expect(parseSetCookie(headers, 'lumin_customer')).toEqual({
      value: 'abc.def.ghi',
      maxAge: 43200,
    });
  });

  it('returns the value without maxAge when Max-Age is absent', () => {
    expect(parseSetCookie(['lumin_customer=tok; Path=/; HttpOnly'], 'lumin_customer')).toEqual({
      value: 'tok',
    });
  });

  it('ignores a cookie whose name only prefixes the target', () => {
    // "lumin_customer_profile=" must NOT satisfy a lookup for "lumin_customer" (exact-name match).
    expect(parseSetCookie(['lumin_customer_profile=x; Path=/'], 'lumin_customer')).toBeNull();
  });

  it('returns null for a non-matching cookie name', () => {
    expect(parseSetCookie(['other=x; Path=/'], 'lumin_customer')).toBeNull();
  });

  it('treats a clearing cookie (empty value / negative Max-Age) as no session', () => {
    const clearing = ['lumin_customer=; Max-Age=-1; Expires=Thu, 01 Jan 1970 00:00:00 GMT'];
    expect(parseSetCookie(clearing, 'lumin_customer')).toBeNull();
  });

  it('picks the right cookie out of several Set-Cookie headers', () => {
    const headers = ['csrf=z; Path=/', 'lumin_customer=jwt; Max-Age=100; HttpOnly'];
    expect(parseSetCookie(headers, 'lumin_customer')).toEqual({ value: 'jwt', maxAge: 100 });
  });

  it('returns null when there are no Set-Cookie headers', () => {
    expect(parseSetCookie([], 'lumin_customer')).toBeNull();
  });
});

describe('profile cookie', () => {
  it('round-trips name/email/phone', () => {
    const p = { name: 'Nguyễn An', email: 'an@example.com', phone: '0912345678' };
    expect(parseProfile(serializeProfile(p))).toEqual(p);
  });

  it('returns null on missing, corrupt, or incomplete JSON', () => {
    expect(parseProfile(undefined)).toBeNull();
    expect(parseProfile('not json')).toBeNull();
    expect(parseProfile('{"name":"x"}')).toBeNull(); // missing email/phone
  });
});
