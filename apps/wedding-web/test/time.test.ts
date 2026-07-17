import { describe, expect, it } from 'vitest';
import { timeAgo } from '../src/lib/time';

// Relative time rules are locked design (HANDOFF §2.8).
describe('timeAgo', () => {
  const now = new Date('2026-09-12T18:00:00Z').getTime();
  const at = (msAgo: number) => new Date(now - msAgo).toISOString();

  it('under an hour → vừa xong', () => {
    expect(timeAgo(at(59 * 60_000), now)).toBe('vừa xong');
  });
  it('under a day → N giờ trước', () => {
    expect(timeAgo(at(5 * 3600_000), now)).toBe('5 giờ trước');
  });
  it('under a week → N ngày trước', () => {
    expect(timeAgo(at(3 * 24 * 3600_000), now)).toBe('3 ngày trước');
  });
  it('older → d.m.yyyy', () => {
    expect(timeAgo('2026-08-01T12:00:00Z', now)).toBe('1.8.2026');
  });
});
