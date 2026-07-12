import { describe, it, expect } from 'vitest';
import { filterCustomers, type AdminCustomer } from '../src/lib/customers';

// Pins the P3-p client search: an accent-free term still hits an accented name, a phone matches by digits
// regardless of spacing on either side, and a miss yields []. (admin vitest include is test/** — this
// must live here, not colocated: memory lumin-admin-vitest-test-dir.)

const roster: AdminCustomer[] = [
  { id: '1', name: 'Nguyễn An', phone: '0901 234 567', orderCount: 4, totalSpent: 1_210_000 },
  { id: '2', name: 'Lê Cúc', phone: '0907888222', orderCount: 0, totalSpent: 0 },
];

describe('filterCustomers', () => {
  it('returns the whole list for an empty or whitespace query', () => {
    expect(filterCustomers(roster, '')).toHaveLength(2);
    expect(filterCustomers(roster, '   ')).toHaveLength(2);
  });

  it('matches an accent-free name term (an → Nguyễn An)', () => {
    expect(filterCustomers(roster, 'an').map((c) => c.name)).toEqual(['Nguyễn An']);
  });

  it('matches a phone by digits, ignoring spaces in the stored value or the query', () => {
    expect(filterCustomers(roster, '234').map((c) => c.id)).toEqual(['1']); // spaced stored phone
    expect(filterCustomers(roster, '0907 888').map((c) => c.id)).toEqual(['2']); // spaced query
  });

  it('returns nothing when neither name nor phone matches', () => {
    expect(filterCustomers(roster, 'zzz')).toEqual([]);
    expect(filterCustomers(roster, '55555')).toEqual([]);
  });
});
