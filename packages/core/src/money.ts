// Money — the SINGLE formatter + server-side totals (conventions §Tiền · ADR-019).
// Store int VND (no decimals). This file is the only sanctioned place in the repo to call
// Intl.NumberFormat; everywhere else ESLint bans it (eslint.config.mjs).
//
// MUTATION-GATE ANCHORS (tests/harness/osm-mutation.test.sh money mutants): hash-prefixed markers
// GROUP / SUBTOTAL / TOTAL, each on its own code line below. Keep those single-line + intact, and
// do NOT repeat the hash-prefixed form here — the kill-gate sed must match ONLY the code lines.

function assertIntVnd(n: number, label: string): void {
  if (!Number.isInteger(n))
    throw new RangeError(`${label} phải là số nguyên VND (không thập phân).`);
  if (n < 0) throw new RangeError(`${label} không được âm.`);
}

/** Format an int VND amount → e.g. `390.000₫` (U+20AB, no space). */
export function formatVnd(amount: number): string {
  assertIntVnd(amount, 'Số tiền');
  return `${new Intl.NumberFormat('vi-VN').format(amount)}₫`; // #GROUP
}

/** Inverse of formatVnd for the round-trip property — strips grouping + the ₫ glyph. */
export function parseVnd(text: string): number {
  const digits = text.replace(/[^0-9]/g, '');
  return digits === '' ? 0 : Number.parseInt(digits, 10);
}

export interface PriceableItem {
  unitPrice: number; // int VND
  quantity: number; // positive int
  colorDelta?: number; // int VND, may be 0
  optionDeltas?: number[]; // each int VND
}

export interface TotalsInput {
  items: PriceableItem[];
  shippingFee: number; // int VND
}

export interface Totals {
  subtotal: number;
  shippingFee: number;
  total: number;
}

/**
 * Server-authoritative totals. Computes subtotal from line items + shippingFee → total.
 * NEVER trusts a client-supplied total (TotalsInput intentionally has no `total` field).
 */
export function calcTotals(input: TotalsInput): Totals {
  assertIntVnd(input.shippingFee, 'Phí vận chuyển');
  let subtotal = 0;
  for (const item of input.items) {
    assertIntVnd(item.unitPrice, 'Đơn giá');
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      throw new RangeError('Số lượng phải là số nguyên dương.');
    }
    const colorDelta = item.colorDelta ?? 0;
    assertIntVnd(colorDelta, 'Chênh lệch màu');
    let optionsTotal = 0;
    for (const delta of item.optionDeltas ?? []) {
      assertIntVnd(delta, 'Chênh lệch tuỳ chọn');
      optionsTotal += delta;
    }
    subtotal += item.quantity * (item.unitPrice + colorDelta + optionsTotal); // #SUBTOTAL
  }
  const total = subtotal + input.shippingFee; // #TOTAL
  return { subtotal, shippingFee: input.shippingFee, total };
}
