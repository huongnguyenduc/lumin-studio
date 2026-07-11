import { describe, expect, it } from 'vitest';
import type { components } from '@lumin/api-client';
import {
  filamentRows,
  filamentStatus,
  filamentStockGrams,
  lowStockCount,
  primaryMachine,
  splitAuxCosts,
  sumAmountVnd,
  unitSymbol,
  wastePercent,
} from '../src/lib/materials';

type FilamentMaterial = components['schemas']['FilamentMaterial'];
type Machine = components['schemas']['Machine'];
type AuxCost = components['schemas']['AuxCost'];

function material(over: Partial<FilamentMaterial>): FilamentMaterial {
  return {
    id: 'm1',
    name: 'Cam Lumin',
    material: 'PLA',
    unit: 'gram',
    hex: '#FF6B4A',
    lowStockThreshold: 500,
    archived: false,
    stockQty: 1180,
    avgCostPerUnit: 412,
    createdAt: '2026-05-02T00:00:00Z',
    updatedAt: '2026-05-28T00:00:00Z',
    ...over,
  };
}

function machine(over: Partial<Machine>): Machine {
  return {
    id: 'k1',
    name: 'Bambu X1C',
    purchasePriceVnd: 24_000_000,
    depreciationMonths: 36,
    expectedHoursPerMonth: 280,
    isPrimary: true,
    active: true,
    costPerHour: 2380,
    ...over,
  };
}

function aux(over: Partial<AuxCost>): AuxCost {
  return { id: 'a1', label: 'Đóng gói', kind: 'per_order', amountVnd: 18_000, ...over };
}

describe('filamentStatus', () => {
  it('below/at the threshold is low, above is ok', () => {
    expect(filamentStatus({ stockQty: 640, lowStockThreshold: 800 })).toBe('low');
    expect(filamentStatus({ stockQty: 800, lowStockThreshold: 800 })).toBe('low'); // at the line
    expect(filamentStatus({ stockQty: 1180, lowStockThreshold: 500 })).toBe('ok');
  });

  it('no threshold set (0) → theo dõi, never a false low warning', () => {
    expect(filamentStatus({ stockQty: 0, lowStockThreshold: 0 })).toBe('track');
    expect(filamentStatus({ stockQty: 5000, lowStockThreshold: 0 })).toBe('track');
  });
});

describe('filamentRows', () => {
  it('maps wire → row and folds in the derived status; empty → []', () => {
    expect(filamentRows([])).toEqual([]);
    const [row] = filamentRows([material({ stockQty: 640, lowStockThreshold: 800 })]);
    expect(row).toMatchObject({ id: 'm1', name: 'Cam Lumin', avgCostPerUnit: 412, status: 'low' });
  });
});

describe('filamentStockGrams', () => {
  it('sums only gram-unit stock (ml materials excluded — units do not add)', () => {
    const list = [
      material({ unit: 'gram', stockQty: 2340 }),
      material({ unit: 'gram', stockQty: 1180 }),
      material({ unit: 'ml', stockQty: 320 }), // resin — must not join the gram total
    ];
    expect(filamentStockGrams(list)).toBe(3520);
    expect(filamentStockGrams([])).toBe(0);
  });
});

describe('lowStockCount', () => {
  it('counts only materials at/below a set threshold', () => {
    const list = [
      material({ stockQty: 640, lowStockThreshold: 800 }), // low
      material({ stockQty: 1180, lowStockThreshold: 500 }), // ok
      material({ stockQty: 10, lowStockThreshold: 0 }), // track — no line, not counted
    ];
    expect(lowStockCount(list)).toBe(1);
  });
});

describe('primaryMachine', () => {
  it('picks the active primary; null when none / inactive primary', () => {
    const active = machine({ id: 'k1', isPrimary: true, active: true });
    const other = machine({ id: 'k2', isPrimary: false, active: true });
    expect(primaryMachine([other, active])?.id).toBe('k1');
    expect(primaryMachine([other])).toBeNull();
    expect(primaryMachine([machine({ isPrimary: true, active: false })])).toBeNull();
  });
});

describe('splitAuxCosts + sumAmountVnd', () => {
  it('splits by kind and subtotals each side', () => {
    const list = [
      aux({ kind: 'per_order', amountVnd: 18_000 }),
      aux({ kind: 'per_order', amountVnd: 6_000 }),
      aux({ kind: 'per_month', amountVnd: 450_000 }),
      aux({ kind: 'weird', amountVnd: 999 }), // unknown kind dropped from both sides
    ];
    const split = splitAuxCosts(list);
    expect(split.perOrder).toHaveLength(2);
    expect(split.perMonth).toHaveLength(1);
    expect(sumAmountVnd(split.perOrder)).toBe(24_000);
    expect(sumAmountVnd(split.perMonth)).toBe(450_000);
    expect(sumAmountVnd([])).toBe(0);
  });
});

describe('wastePercent', () => {
  it('scales the factor to a percent (0.084 → 8.4)', () => {
    expect(wastePercent(0.084)).toBeCloseTo(8.4, 9);
    expect(wastePercent(0)).toBe(0);
  });
});

describe('unitSymbol', () => {
  it('shortens gram to g, leaves ml as-is', () => {
    expect(unitSymbol('gram')).toBe('g');
    expect(unitSymbol('ml')).toBe('ml');
  });
});
