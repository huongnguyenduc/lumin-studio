import { describe, expect, it } from 'vitest';
import type { components } from '@lumin/api-client';
import { sortChoices } from '../src/lib/product-options';

type OptionChoice = components['schemas']['OptionChoice'];

const choice = (label: string, displayOrder: number): OptionChoice => ({
  id: label,
  label,
  description: '',
  priceDelta: 0,
  displayOrder,
});

describe('sortChoices', () => {
  it('orders by displayOrder', () => {
    const sorted = sortChoices([choice('L', 2), choice('S', 0), choice('M', 1)]);
    expect(sorted.map((c) => c.label)).toEqual(['S', 'M', 'L']);
  });

  it('breaks a displayOrder tie by label for a stable order', () => {
    const sorted = sortChoices([choice('B', 0), choice('A', 0)]);
    expect(sorted.map((c) => c.label)).toEqual(['A', 'B']);
  });

  it('does not mutate the input and handles empty', () => {
    const input = [choice('M', 1), choice('S', 0)];
    sortChoices(input);
    expect(input.map((c) => c.label)).toEqual(['M', 'S']); // original untouched
    expect(sortChoices([])).toEqual([]);
  });
});
