import { describe, it, expect } from 'vitest';
import {
  groupByStage,
  nextStage,
  mergeCard,
  PRINT_STAGES,
  type PrintCard,
} from '../src/lib/print-queue';

const card = (id: string, stage: PrintCard['stage'], over: Partial<PrintCard> = {}): PrintCard => ({
  id,
  stage,
  orderCode: '#LMN-1000',
  productName: 'Đèn Mochi',
  quantity: 1,
  ...over,
});

describe('groupByStage', () => {
  it('buckets every stage, keeps list order within a column, and always has all four columns', () => {
    const grouped = groupByStage([
      card('a', 'NEED_PRINT'),
      card('b', 'PRINTING'),
      card('c', 'NEED_PRINT'),
    ]);
    expect(PRINT_STAGES.every((s) => Array.isArray(grouped[s]))).toBe(true);
    expect(grouped.NEED_PRINT.map((c) => c.id)).toEqual(['a', 'c']); // FIFO order preserved
    expect(grouped.PRINTING.map((c) => c.id)).toEqual(['b']);
    expect(grouped.PACKING).toEqual([]);
    expect(grouped.SHIPPED).toEqual([]);
  });
});

describe('nextStage', () => {
  it('walks the board order and terminates at SHIPPED', () => {
    expect(nextStage('NEED_PRINT')).toBe('PRINTING');
    expect(nextStage('PRINTING')).toBe('PACKING');
    expect(nextStage('PACKING')).toBe('SHIPPED');
    expect(nextStage('SHIPPED')).toBeNull();
  });
});

describe('mergeCard', () => {
  it('replaces a card in place by id (idempotent for the PATCH + SSE double)', () => {
    const before = [card('a', 'NEED_PRINT'), card('b', 'NEED_PRINT')];
    const after = mergeCard(before, card('a', 'PRINTING'));
    expect(after).toHaveLength(2);
    expect(after[0].stage).toBe('PRINTING'); // same slot, new stage
    expect(after[1]).toBe(before[1]); // the other card's reference is untouched
  });

  it('appends an unseen card', () => {
    const after = mergeCard([card('a', 'NEED_PRINT')], card('z', 'PACKING'));
    expect(after.map((c) => c.id)).toEqual(['a', 'z']);
  });
});
