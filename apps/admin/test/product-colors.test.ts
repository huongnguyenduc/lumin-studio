import { describe, expect, it } from 'vitest';
import type { components } from '@lumin/api-client';
import { groupColorsByPart } from '../src/lib/product-colors';

type Color = components['schemas']['Color'];
type Part = components['schemas']['Part'];

const part = (id: string, name: string, displayOrder: number): Part => ({ id, name, displayOrder });
const color = (id: string, partId?: string | null): Color => ({
  id,
  name: id,
  hex: '#000000',
  available: true,
  priceDelta: 0,
  partId: partId ?? null,
});

describe('groupColorsByPart', () => {
  it('groups colours under their part, parts ordered by displayOrder, flat group last', () => {
    const parts = [part('p2', 'Đế', 2), part('p1', 'Chao', 1)];
    const colors = [color('c1', 'p1'), color('c2', null), color('c3', 'p2'), color('c4', 'p1')];
    const groups = groupColorsByPart(parts, colors);

    expect(groups.map((g) => g.part?.id ?? 'flat')).toEqual(['p1', 'p2', 'flat']);
    expect(groups[0].colors.map((c) => c.id)).toEqual(['c1', 'c4']); // insertion order within a part
    expect(groups[1].colors.map((c) => c.id)).toEqual(['c3']);
    expect(groups[2].colors.map((c) => c.id)).toEqual(['c2']); // no partId → flat
  });

  it('no parts → one flat group holding every colour', () => {
    const groups = groupColorsByPart([], [color('a'), color('b')]);
    expect(groups).toHaveLength(1);
    expect(groups[0].part).toBeNull();
    expect(groups[0].colors.map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('a part with no colours still gets an (empty) group; no empty flat group when parts exist', () => {
    const groups = groupColorsByPart([part('p1', 'Chao', 1)], []);
    expect(groups).toHaveLength(1);
    expect(groups[0].part?.id).toBe('p1');
    expect(groups[0].colors).toEqual([]);
  });

  it('a dangling partId (part deleted) falls into the flat group, never hidden', () => {
    const groups = groupColorsByPart([part('p1', 'Chao', 1)], [color('c1', 'gone')]);
    expect(groups.map((g) => g.part?.id ?? 'flat')).toEqual(['p1', 'flat']);
    expect(groups[1].colors.map((c) => c.id)).toEqual(['c1']);
  });
});
