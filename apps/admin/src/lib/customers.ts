import type { components } from '@lumin/api-client';

export type AdminCustomer = components['schemas']['AdminCustomer'];

// fold strips diacritics + lower-cases so an accent-free term ("an") still hits "Nguyễn An"; digits keeps
// only 0-9 so a spaced phone ("0901 234 567") matches a query of bare digits.
const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
const digits = (s: string) => s.replace(/\D/g, '');

/**
 * Client-side search over the customer roster (P3-p): a row matches when the accent-folded name contains
 * the folded query OR (the query has digits and) the digit-only phone contains them. An empty/whitespace
 * query returns the whole list unchanged. Pure so it is unit-tested without a DOM.
 */
export function filterCustomers(customers: AdminCustomer[], query: string): AdminCustomer[] {
  const q = query.trim();
  if (!q) return customers;
  const name = fold(q);
  const phone = digits(q);
  return customers.filter(
    (c) => fold(c.name).includes(name) || (phone !== '' && digits(c.phone).includes(phone)),
  );
}
