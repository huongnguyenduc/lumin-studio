// Pure client-side search over the shop's reply templates — no I/O (that lives in ./templates). Unit-tested.
// Search is diacritic- AND case-insensitive so a Vietnamese staffer typing "phi ship" (no marks) still finds
// "Báo phí ship" — the primary locale types without diacritics all the time. NFD splits each accented vowel
// into base + a nonspacing mark (\p{Mn}) we drop; "đ" is precomposed (doesn't decompose) so fold it by hand.
export function foldVi(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .replace(/đ/g, 'd');
}

// Keep templates whose title OR body contains the (folded) query. Blank query → everything, in order.
export function filterTemplates<T extends { title: string; body: string }>(
  items: readonly T[],
  query: string,
): T[] {
  const q = foldVi(query.trim());
  if (!q) return [...items];
  return items.filter((it) => foldVi(it.title).includes(q) || foldVi(it.body).includes(q));
}
