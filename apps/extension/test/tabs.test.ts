import { describe, expect, it } from 'vitest';
import { isLaunchTab, TABS } from '../src/lib/tabs';

describe('isLaunchTab', () => {
  it('accepts every real tab id (popup deep-link → shell tab)', () => {
    for (const { id } of TABS) expect(isLaunchTab(id)).toBe(true);
  });

  it('rejects unknown or non-string values (stale / tampered storage)', () => {
    for (const value of ['', 'settings', 0, null, undefined, {}]) {
      expect(isLaunchTab(value)).toBe(false);
    }
  });
});
