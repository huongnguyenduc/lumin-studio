import { describe, it, expect } from 'vitest';
import { verifyRevalidateSecret } from '../src/lib/revalidate-auth';

const SECRET = 'a-long-high-entropy-shared-secret-value';

describe('verifyRevalidateSecret', () => {
  it('closes the endpoint (500) when REVALIDATE_SECRET is unset — never an open purge', () => {
    expect(verifyRevalidateSecret(SECRET, undefined)).toEqual({ ok: false, status: 500 });
    expect(verifyRevalidateSecret(SECRET, '')).toEqual({ ok: false, status: 500 });
  });

  it('rejects a missing header (401)', () => {
    expect(verifyRevalidateSecret(null, SECRET)).toEqual({ ok: false, status: 401 });
  });

  it('rejects a wrong secret of equal length (401)', () => {
    const wrong = 'X'.repeat(SECRET.length);
    expect(wrong.length).toBe(SECRET.length);
    expect(verifyRevalidateSecret(wrong, SECRET)).toEqual({ ok: false, status: 401 });
  });

  it('rejects a wrong secret of different length (401, no timingSafeEqual throw)', () => {
    expect(verifyRevalidateSecret('short', SECRET)).toEqual({ ok: false, status: 401 });
    expect(verifyRevalidateSecret(SECRET + 'extra', SECRET)).toEqual({ ok: false, status: 401 });
  });

  it('accepts the exact secret (200)', () => {
    expect(verifyRevalidateSecret(SECRET, SECRET)).toEqual({ ok: true, status: 200 });
  });
});
